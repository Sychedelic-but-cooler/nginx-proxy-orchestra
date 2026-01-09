/**
 * Ban Queue System
 *
 * Rate-limited queue for ban/unban operations
 * - Maximum 1 request per 5 seconds per integration
 * - Batches multiple operations into single requests
 * - Automatic retry on failure (max 3 attempts)
 */

const { db } = require('../db');
const { getProvider } = require('./ban-providers');

class BanQueue {
  constructor() {
    this.queue = new Map();  // integrationId -> array of pending operations
    this.processing = new Set();  // Track which integrations are being processed
    this.rateLimitWindow = 5 * 1000;  // 5 seconds in milliseconds
    this.processorInterval = null;
  }

  /**
   * Start the queue processor (runs every 5 seconds)
   */
  start() {
    if (this.processorInterval) {
      console.log('Ban queue processor already running');
      return;
    }

    this.processorInterval = setInterval(async () => {
      await this.processAllIntegrations();
    }, this.rateLimitWindow);

    console.log('✓ Ban queue processor started (1 request per 5 seconds per integration)');
  }

  /**
   * Stop the queue processor
   */
  stop() {
    if (this.processorInterval) {
      clearInterval(this.processorInterval);
      this.processorInterval = null;
      console.log('Ban queue processor stopped');
    }
  }

  /**
   * Add a ban/unban operation to the queue
   */
  enqueue(integrationId, operation) {
    if (!this.queue.has(integrationId)) {
      this.queue.set(integrationId, []);
    }

    const queue = this.queue.get(integrationId);

    // Check for duplicates
    const isDuplicate = queue.some(item =>
      item.ip === operation.ip && item.action === operation.action
    );

    if (isDuplicate) {
      console.log(`Operation already queued: ${operation.action} ${operation.ip} on integration ${integrationId}`);
      return;
    }

    // Add to queue with priority
    queue.push({
      ...operation,
      queued_at: Date.now(),
      retry_count: 0,
      priority: this.calculatePriority(operation)
    });

    console.log(`✓ Queued ${operation.action} for ${operation.ip} on integration ${integrationId} (queue size: ${queue.length})`);
  }

  /**
   * Calculate operation priority (lower = higher priority)
   */
  calculatePriority(operation) {
    const severityPriority = {
      'CRITICAL': 1,
      'HIGH': 2,
      'MEDIUM': 3,
      'LOW': 4
    };

    return severityPriority[operation.severity] || 5;
  }

  /**
   * Process queues for all integrations
   */
  async processAllIntegrations() {
    const integrations = db.prepare(`
      SELECT * FROM ban_integrations WHERE enabled = 1
    `).all();

    for (const integration of integrations) {
      // Skip if already processing this integration
      if (this.processing.has(integration.id)) {
        console.log(`Skipping integration ${integration.name} - still processing previous batch`);
        continue;
      }

      const queue = this.queue.get(integration.id);
      if (!queue || queue.length === 0) {
        continue;  // Nothing to process
      }

      await this.processIntegration(integration);
    }
  }

  /**
   * Process queued operations for a specific integration
   */
  async processIntegration(integration) {
    const queue = this.queue.get(integration.id);

    if (!queue || queue.length === 0) {
      return;
    }

    this.processing.add(integration.id);

    try {
      console.log(`\n📤 Processing ban queue for ${integration.name} (${queue.length} operations)`);

      // Sort by priority (highest first)
      queue.sort((a, b) => a.priority - b.priority);

      // Get provider
      const { getProvider } = require('./ban-providers');
      const provider = getProvider(integration);

      // Check if provider supports batch operations
      if (provider.batchBanIPs) {
        await this.processBatch(provider, integration, queue);
      } else {
        await this.processSingle(provider, integration, queue);
      }

      // Clear the queue for this integration after successful processing
      this.queue.set(integration.id, []);

    } catch (error) {
      console.error(`❌ Error processing queue for ${integration.name}:`, error);

      // Update last error in database
      db.prepare(`
        UPDATE ban_integrations
        SET last_error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(error.message, integration.id);

      // Keep items in queue for retry (but limit retries)
      const queue = this.queue.get(integration.id);
      const retryableItems = queue.filter(item => {
        item.retry_count = (item.retry_count || 0) + 1;
        if (item.retry_count > 3) {
          console.log(`❌ Max retries exceeded for ${item.action} ${item.ip}, dropping from queue`);
          return false;
        }
        return true;
      });
      this.queue.set(integration.id, retryableItems);

    } finally {
      this.processing.delete(integration.id);
    }
  }

  /**
   * Process operations using batch API (if supported)
   */
  async processBatch(provider, integration, queue) {
    const bans = queue.filter(item => item.action === 'ban');
    const unbans = queue.filter(item => item.action === 'unban');

    // Process bans
    if (bans.length > 0) {
      console.log(`  Sending ${bans.length} bans in single batch request...`);

      const result = await provider.batchBanIPs(bans.map(ban => ({
        ip: ban.ip,
        reason: ban.reason,
        duration: ban.duration
      })));

      if (result.success) {
        console.log(`  ✓ Successfully banned ${result.banned_count || bans.length} IPs`);

        // Update database for each ban
        for (const ban of bans) {
          if (ban.ban_id) {
            this.updateBanRecord(ban.ban_id, integration.id, integration.name, result.ban_ids?.[ban.ip]);
          }
        }

        // Update integration stats
        db.prepare(`
          UPDATE ban_integrations
          SET total_bans_sent = total_bans_sent + ?,
              last_success = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(bans.length, integration.id);
      } else {
        console.error(`  ✗ Batch ban failed: ${result.message}`);
        throw new Error(result.message);
      }
    }

    // Process unbans
    if (unbans.length > 0) {
      console.log(`  Sending ${unbans.length} unbans in single batch request...`);

      const result = await provider.batchUnbanIPs(unbans.map(unban => ({
        ip: unban.ip,
        ban_id: unban.provider_ban_id
      })));

      if (result.success) {
        console.log(`  ✓ Successfully unbanned ${result.unbanned_count || unbans.length} IPs`);

        db.prepare(`
          UPDATE ban_integrations
          SET total_unbans_sent = total_unbans_sent + ?,
              last_success = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(unbans.length, integration.id);
      } else {
        console.error(`  ✗ Batch unban failed: ${result.message}`);
      }
    }
  }

  /**
   * Process operations one-by-one (fallback for providers without batch support)
   */
  async processSingle(provider, integration, queue) {
    console.log(`  Provider doesn't support batching, processing individually...`);

    let successCount = 0;
    let failCount = 0;

    for (const item of queue) {
      try {
        let result;

        if (item.action === 'ban') {
          result = await provider.banIP(item.ip, {
            reason: item.reason,
            duration: item.duration
          });

          if (result.success) {
            if (item.ban_id) {
              this.updateBanRecord(item.ban_id, integration.id, integration.name, result.ban_id);
            }
            successCount++;
          } else {
            failCount++;
            console.error(`  ✗ Failed to ban ${item.ip}: ${result.message}`);
          }
        } else if (item.action === 'unban') {
          result = await provider.unbanIP(item.ip, item.provider_ban_id);

          if (result.success) {
            successCount++;
          } else {
            failCount++;
            console.error(`  ✗ Failed to unban ${item.ip}: ${result.message}`);
          }
        }

        // Small delay between requests to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        failCount++;
        console.error(`  ✗ Error processing ${item.action} for ${item.ip}:`, error.message);
      }
    }

    console.log(`  Completed: ${successCount} success, ${failCount} failed`);

    // Update integration stats
    if (successCount > 0) {
      db.prepare(`
        UPDATE ban_integrations
        SET total_bans_sent = total_bans_sent + ?,
            last_success = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(successCount, integration.id);
    }
  }

  /**
   * Update ban record with provider ban ID
   */
  updateBanRecord(banId, integrationId, integrationName, providerBanId) {
    try {
      // Get current integrations_notified
      const ban = db.prepare('SELECT integrations_notified FROM ip_bans WHERE id = ?').get(banId);
      if (!ban) return;

      const notified = JSON.parse(ban.integrations_notified || '[]');

      // Update or add this integration
      const existing = notified.findIndex(n => n.id === integrationId);
      if (existing >= 0) {
        notified[existing].ban_id = providerBanId;
        notified[existing].notified_at = new Date().toISOString();
      } else {
        notified.push({
          id: integrationId,
          name: integrationName,
          ban_id: providerBanId,
          notified_at: new Date().toISOString()
        });
      }

      db.prepare(`
        UPDATE ip_bans
        SET integrations_notified = ?
        WHERE id = ?
      `).run(JSON.stringify(notified), banId);

    } catch (error) {
      console.error('Failed to update ban record:', error);
    }
  }

  /**
   * Get queue status for monitoring
   */
  getStatus() {
    const status = {};

    for (const [integrationId, queue] of this.queue.entries()) {
      const integration = db.prepare('SELECT name FROM ban_integrations WHERE id = ?')
        .get(integrationId);

      status[integration?.name || `Integration ${integrationId}`] = {
        pending: queue.length,
        processing: this.processing.has(integrationId),
        items: queue.map(item => ({
          ip: item.ip,
          action: item.action,
          priority: item.priority,
          severity: item.severity,
          retry_count: item.retry_count,
          queued_for: Math.floor((Date.now() - item.queued_at) / 1000) + 's'
        }))
      };
    }

    return status;
  }

  /**
   * Get queue size for a specific integration
   */
  getQueueSize(integrationId) {
    const queue = this.queue.get(integrationId);
    return queue ? queue.length : 0;
  }

  /**
   * Clear queue for a specific integration
   */
  clearQueue(integrationId) {
    this.queue.delete(integrationId);
    console.log(`Cleared queue for integration ${integrationId}`);
  }
}

// Singleton instance
let banQueueInstance = null;

function getBanQueue() {
  if (!banQueueInstance) {
    banQueueInstance = new BanQueue();
  }
  return banQueueInstance;
}

module.exports = { getBanQueue, BanQueue };
