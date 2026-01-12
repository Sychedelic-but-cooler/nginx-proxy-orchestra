/**
 * Ban Synchronization Service
 *
 * Ensures firewall bans stay synchronized with database state
 * - Monitors for expired bans and removes them from firewall
 * - Syncs database ban state with actual firewall rules
 * - Re-applies missing firewall rules
 * - Handles permanent ban updates
 */

const { db } = require('../db');
const { getProvider } = require('./ban-providers');

class BanSyncService {
  constructor() {
    this.syncInterval = null;
    this.syncFrequency = 60 * 1000; // Check every 60 seconds
    this.isSyncing = false;
  }

  /**
   * Start the synchronization service
   */
  start() {
    if (this.syncInterval) {
      console.log('Ban sync service already running');
      return;
    }

    console.log('🔄 Starting ban synchronization service...');

    // Run initial sync
    this.syncAllBans().catch(error => {
      console.error('Initial ban sync failed:', error);
    });

    // Schedule periodic syncs
    this.syncInterval = setInterval(async () => {
      if (!this.isSyncing) {
        await this.syncAllBans().catch(error => {
          console.error('Periodic ban sync failed:', error);
        });
      }
    }, this.syncFrequency);

    console.log('✓ Ban sync service started (checking every 60 seconds)');
  }

  /**
   * Stop the synchronization service
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('Ban sync service stopped');
    }
  }

  /**
   * Perform full synchronization of all bans
   */
  async syncAllBans() {
    if (this.isSyncing) {
      console.log('Sync already in progress, skipping...');
      return;
    }

    this.isSyncing = true;

    try {
      // 1. Process expired bans
      await this.processExpiredBans();

      // 2. Sync active bans with firewall
      await this.syncActiveBans();

    } catch (error) {
      console.error('Error during ban synchronization:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Process expired bans and remove from firewall
   */
  async processExpiredBans() {
    // Find bans that have expired but not been unbanned
    const expiredBans = db.prepare(`
      SELECT id, ip_address, integrations_notified, reason, banned_at, expires_at, auto_banned
      FROM ip_bans
      WHERE unbanned_at IS NULL
        AND expires_at IS NOT NULL
        AND expires_at <= datetime('now')
    `).all();

    if (expiredBans.length === 0) {
      return;
    }

    console.log(`\n🕐 Processing ${expiredBans.length} expired bans...`);

    for (const ban of expiredBans) {
      try {
        console.log(`  Removing expired ban for ${ban.ip_address}`);

        // Mark as unbanned in database
        db.prepare(`
          UPDATE ip_bans
          SET unbanned_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(ban.id);

        // Remove from all integrations
        const integrations = JSON.parse(ban.integrations_notified || '[]');
        for (const integration of integrations) {
          await this.removeFromIntegration(integration.id, ban.ip_address, integration.ban_id);
        }

        console.log(`  ✓ Expired ban removed for ${ban.ip_address}`);

        // Send notification
        try {
          const { notifyBanCleared } = require('./notification-service');

          notifyBanCleared({
            ip_address: ban.ip_address,
            reason: ban.reason,
            banned_at: ban.banned_at,
            expires_at: ban.expires_at,
            manual: false,  // Auto-expired
            unbanned_by_username: null,
            auto_banned: ban.auto_banned
          }).catch(err => {
            console.error(`  ⚠️  Failed to send ban cleared notification for ${ban.ip_address}:`, err.message);
          });
        } catch (error) {
          console.error(`  ⚠️  Error sending ban cleared notification:`, error.message);
        }

      } catch (error) {
        console.error(`  ✗ Failed to process expired ban for ${ban.ip_address}:`, error.message);
      }
    }
  }

  /**
   * Sync active bans with firewall state
   */
  async syncActiveBans() {
    const integrations = db.prepare(`
      SELECT * FROM ban_integrations WHERE enabled = 1
    `).all();

    if (integrations.length === 0) {
      return;
    }

    for (const integration of integrations) {
      try {
        await this.syncIntegration(integration);
      } catch (error) {
        console.error(`Error syncing integration ${integration.name}:`, error.message);
      }
    }
  }

  /**
   * Sync a specific integration
   */
  async syncIntegration(integration) {
    try {
      const provider = getProvider(integration);

      // Get currently banned IPs from provider
      const providerBans = await provider.getBannedIPs();
      const providerIPs = new Set(providerBans.map(b => b.ip));

      // Get active bans from database that should be in this integration
      const dbBans = db.prepare(`
        SELECT
          ib.id,
          ib.ip_address,
          ib.integrations_notified,
          ib.expires_at,
          ib.reason,
          ib.severity
        FROM ip_bans ib
        WHERE ib.unbanned_at IS NULL
          AND (ib.expires_at IS NULL OR ib.expires_at > datetime('now'))
      `).all();

      let missingCount = 0;
      let extraCount = 0;

      // Find bans that should be in firewall but aren't
      for (const ban of dbBans) {
        const notified = JSON.parse(ban.integrations_notified || '[]');
        const isNotified = notified.some(n => n.id === integration.id);

        // Should be in firewall but isn't
        if (isNotified && !providerIPs.has(ban.ip_address)) {
          console.log(`  ⚠️  Missing ban for ${ban.ip_address} - re-applying...`);

          const duration = ban.expires_at
            ? Math.max(0, Math.floor((new Date(ban.expires_at) - new Date()) / 1000))
            : null;

          const result = await provider.banIP(ban.ip_address, {
            reason: ban.reason,
            duration: duration
          });

          if (result.success) {
            missingCount++;
            console.log(`  ✓ Re-applied ban for ${ban.ip_address}`);
          } else {
            console.error(`  ✗ Failed to re-apply ban for ${ban.ip_address}: ${result.message}`);
          }
        }
      }

      // Find bans in firewall that shouldn't be there
      const dbIPs = new Set(dbBans.map(b => b.ip_address));
      for (const providerBan of providerBans) {
        if (!dbIPs.has(providerBan.ip)) {
          console.log(`  ⚠️  Extra ban for ${providerBan.ip} in firewall but not in database - removing...`);

          const result = await provider.unbanIP(providerBan.ip, providerBan.ban_id);
          if (result.success) {
            extraCount++;
            console.log(`  ✓ Removed extra ban for ${providerBan.ip}`);
          } else {
            console.error(`  ✗ Failed to remove extra ban for ${providerBan.ip}: ${result.message}`);
          }
        }
      }

      if (missingCount > 0 || extraCount > 0) {
        console.log(`✓ Synced ${integration.name}: Re-applied ${missingCount} missing bans, removed ${extraCount} extra bans`);
      }

    } catch (error) {
      console.error(`Failed to sync integration ${integration.name}:`, error.message);
    }
  }

  /**
   * Remove IP from a specific integration
   */
  async removeFromIntegration(integrationId, ip, banId) {
    try {
      const integration = db.prepare('SELECT * FROM ban_integrations WHERE id = ?').get(integrationId);
      if (!integration || !integration.enabled) {
        return;
      }

      const provider = getProvider(integration);
      const result = await provider.unbanIP(ip, banId);

      if (result.success) {
        console.log(`  ✓ Removed ${ip} from ${integration.name}`);
      } else {
        console.error(`  ✗ Failed to remove ${ip} from ${integration.name}: ${result.message}`);
      }
    } catch (error) {
      console.error(`Error removing ${ip} from integration ${integrationId}:`, error.message);
    }
  }

  /**
   * Manually sync a specific IP across all integrations
   */
  async syncIP(ip) {
    console.log(`\n🔄 Manually syncing ban for IP: ${ip}`);

    const ban = db.prepare(`
      SELECT * FROM ip_bans
      WHERE ip_address = ?
        AND unbanned_at IS NULL
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get(ip);

    if (!ban) {
      console.log(`  No active ban found for ${ip}`);
      return { success: false, message: 'No active ban found' };
    }

    const integrations = db.prepare(`
      SELECT * FROM ban_integrations WHERE enabled = 1
    `).all();

    let successCount = 0;
    let failCount = 0;

    for (const integration of integrations) {
      try {
        const provider = getProvider(integration);

        const duration = ban.expires_at
          ? Math.max(0, Math.floor((new Date(ban.expires_at) - new Date()) / 1000))
          : null;

        const result = await provider.banIP(ip, {
          reason: ban.reason,
          duration: duration
        });

        if (result.success) {
          successCount++;
          console.log(`  ✓ Applied to ${integration.name}`);

          // Update integrations_notified
          const notified = JSON.parse(ban.integrations_notified || '[]');
          const existing = notified.findIndex(n => n.id === integration.id);

          if (existing >= 0) {
            notified[existing].ban_id = result.ban_id;
            notified[existing].notified_at = new Date().toISOString();
          } else {
            notified.push({
              id: integration.id,
              name: integration.name,
              ban_id: result.ban_id,
              notified_at: new Date().toISOString()
            });
          }

          db.prepare(`
            UPDATE ip_bans
            SET integrations_notified = ?
            WHERE id = ?
          `).run(JSON.stringify(notified), ban.id);

        } else {
          failCount++;
          console.error(`  ✗ Failed on ${integration.name}: ${result.message}`);
        }
      } catch (error) {
        failCount++;
        console.error(`  ✗ Error with ${integration.name}:`, error.message);
      }
    }

    console.log(`✓ Sync complete: ${successCount} success, ${failCount} failed`);

    return {
      success: successCount > 0,
      message: `Synced to ${successCount}/${integrations.length} integrations`,
      successCount,
      failCount
    };
  }

  /**
   * Update ban expiry and re-sync with firewall
   */
  async updateBanExpiry(banId, newExpiresAt) {
    const ban = db.prepare('SELECT * FROM ip_bans WHERE id = ?').get(banId);
    if (!ban) {
      return { success: false, message: 'Ban not found' };
    }

    console.log(`\n🔄 Updating ban expiry for ${ban.ip_address}`);

    // Update database
    db.prepare(`
      UPDATE ip_bans
      SET expires_at = ?
      WHERE id = ?
    `).run(newExpiresAt, banId);

    // Calculate new duration
    const duration = newExpiresAt
      ? Math.max(0, Math.floor((new Date(newExpiresAt) - new Date()) / 1000))
      : null;

    // Re-apply to all integrations with new duration
    const integrations = JSON.parse(ban.integrations_notified || '[]');

    for (const integration of integrations) {
      try {
        const integrationData = db.prepare('SELECT * FROM ban_integrations WHERE id = ?').get(integration.id);
        if (!integrationData || !integrationData.enabled) continue;

        const provider = getProvider(integrationData);

        // Remove old ban
        await provider.unbanIP(ban.ip_address, integration.ban_id);

        // Re-apply with new duration
        const result = await provider.banIP(ban.ip_address, {
          reason: ban.reason,
          duration: duration
        });

        if (result.success) {
          console.log(`  ✓ Updated ${integrationData.name}`);
        }
      } catch (error) {
        console.error(`  ✗ Failed to update integration ${integration.id}:`, error.message);
      }
    }

    return { success: true, message: 'Ban expiry updated and synced' };
  }

  /**
   * Get sync status and statistics
   */
  getStatus() {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_bans,
        COUNT(CASE WHEN expires_at IS NULL THEN 1 END) as permanent_bans,
        COUNT(CASE WHEN expires_at > datetime('now') THEN 1 END) as temporary_bans,
        COUNT(CASE WHEN expires_at IS NOT NULL AND expires_at <= datetime('now') THEN 1 END) as expired_bans
      FROM ip_bans
      WHERE unbanned_at IS NULL
    `).get();

    return {
      is_syncing: this.isSyncing,
      sync_frequency: this.syncFrequency / 1000 + ' seconds',
      ...stats
    };
  }
}

// Singleton instance
let banSyncInstance = null;

function getBanSyncService() {
  if (!banSyncInstance) {
    banSyncInstance = new BanSyncService();
  }
  return banSyncInstance;
}

module.exports = { getBanSyncService, BanSyncService };
