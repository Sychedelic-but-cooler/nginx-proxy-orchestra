/**
 * Ban Service
 *
 * Main service for banning/unbanning IPs
 * - Checks whitelist before banning
 * - Queues operations for rate limiting
 * - Handles automatic expiry
 */

const { db } = require('../db');
const { getBanQueue } = require('./ban-queue');
const { isWhitelisted } = require('./ip-utils');

/**
 * Check if IP is currently banned
 */
function isBanned(ip) {
  const ban = db.prepare(`
    SELECT id FROM ip_bans
    WHERE ip_address = ?
      AND unbanned_at IS NULL
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
  `).get(ip);

  return !!ban;
}

/**
 * Ban an IP address (queued for all enabled integrations)
 */
async function banIP(ip, options = {}) {
  const {
    reason = 'Manual ban',
    attack_type = null,
    event_count = 0,
    severity = 'MEDIUM',
    ban_duration = null,  // seconds, null = permanent
    auto_banned = false,
    banned_by = null,
    detection_rule_id = null,
    proxy_id = null,
    sample_events = []
  } = options;

  // CRITICAL: Check whitelist first
  if (isWhitelisted(ip)) {
    console.log(`⚠️  IP ${ip} is WHITELISTED - refusing to ban`);
    return {
      success: false,
      message: 'IP is whitelisted and cannot be banned'
    };
  }

  // Check if already banned
  if (isBanned(ip)) {
    console.log(`IP ${ip} is already banned`);
    return {
      success: false,
      message: 'IP is already banned'
    };
  }

  const expires_at = ban_duration
    ? new Date(Date.now() + ban_duration * 1000).toISOString()
    : null;

  // Insert ban record
  const result = db.prepare(`
    INSERT INTO ip_bans (
      ip_address, reason, detection_rule_id, attack_type, event_count,
      severity, expires_at, integrations_notified, auto_banned, banned_by,
      proxy_id, sample_events
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)
  `).run(
    ip, reason, detection_rule_id, attack_type, event_count,
    severity, expires_at, auto_banned ? 1 : 0, banned_by,
    proxy_id, JSON.stringify(sample_events)
  );

  const banId = result.lastInsertRowid;

  // Get enabled integrations
  const integrations = db.prepare(`
    SELECT id FROM ban_integrations
    WHERE enabled = 1
  `).all();

  if (integrations.length === 0) {
    console.log(`⚠️  No enabled ban integrations found. Ban recorded but not sent to any upstream firewalls.`);
    return {
      success: true,
      ban_id: banId,
      integrations_queued: 0,
      message: 'Ban recorded locally (no integrations configured)'
    };
  }

  // Add to queue for each integration
  const banQueue = getBanQueue();

  for (const integration of integrations) {
    banQueue.enqueue(integration.id, {
      action: 'ban',
      ip,
      reason,
      duration: ban_duration,
      severity,
      ban_id: banId
    });
  }

  console.log(`✓ Banned IP ${ip}: ${reason} (queued for ${integrations.length} integration(s))`);

  // Broadcast ban event for real-time updates
  try {
    const { broadcastBanEvent } = require('../routes/api');
    if (broadcastBanEvent) {
      broadcastBanEvent('ban_created', {
        ip_address: ip,
        reason,
        severity,
        ban_id: banId,
        auto_banned
      });
    }
  } catch (error) {
    // Ignore circular dependency errors during startup
  }

  // Send notification
  try {
    const { notifyBanIssued } = require('./notification-service');

    // Get detection rule name if applicable
    let detection_rule = null;
    if (detection_rule_id) {
      const rule = db.prepare('SELECT name FROM ips_detection_rules WHERE id = ?').get(detection_rule_id);
      detection_rule = rule?.name;
    }

    // Get username if manually banned
    let banned_by_username = null;
    if (banned_by) {
      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(banned_by);
      banned_by_username = user?.username;
    }

    notifyBanIssued({
      ip_address: ip,
      reason,
      attack_type,
      event_count,
      severity,
      ban_duration,
      detection_rule,
      auto_banned,
      banned_by_username
    }).catch(err => {
      console.error('Failed to send ban notification:', err.message);
    });
  } catch (error) {
    // Ignore errors during notification
    console.error('Error sending ban notification:', error.message);
  }

  return {
    success: true,
    ban_id: banId,
    integrations_queued: integrations.length,
    message: `Ban queued for ${integrations.length} integration(s)`,
    expires_at: expires_at || 'permanent'
  };
}

/**
 * Unban an IP address (queued for all notified integrations)
 */
async function unbanIP(ip, unbanned_by = null) {
  // Get the active ban
  const ban = db.prepare(`
    SELECT * FROM ip_bans
    WHERE ip_address = ?
      AND unbanned_at IS NULL
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    ORDER BY banned_at DESC
    LIMIT 1
  `).get(ip);

  if (!ban) {
    return {
      success: false,
      message: 'IP is not currently banned'
    };
  }

  // Get integrations that were notified
  const integrationsNotified = JSON.parse(ban.integrations_notified || '[]');

  if (integrationsNotified.length === 0) {
    // No integrations were notified, just mark as unbanned locally
    db.prepare(`
      UPDATE ip_bans
      SET unbanned_at = CURRENT_TIMESTAMP,
          unbanned_by = ?
      WHERE id = ?
    `).run(unbanned_by, ban.id);

    // Broadcast unban event for real-time updates
    try {
      const { broadcastBanEvent } = require('../routes/api');
      if (broadcastBanEvent) {
        broadcastBanEvent('ban_removed', {
          ip_address: ip,
          ban_id: ban.id
        });
      }
    } catch (error) {
      // Ignore circular dependency errors during startup
    }

    // Send notification
    try {
      const { notifyBanCleared } = require('./notification-service');

      let unbanned_by_username = null;
      if (unbanned_by) {
        const user = db.prepare('SELECT username FROM users WHERE id = ?').get(unbanned_by);
        unbanned_by_username = user?.username;
      }

      notifyBanCleared({
        ip_address: ip,
        reason: ban.reason,
        banned_at: ban.banned_at,
        expires_at: ban.expires_at,
        manual: !!unbanned_by,
        unbanned_by_username,
        auto_banned: ban.auto_banned
      }).catch(err => {
        console.error('Failed to send ban cleared notification:', err.message);
      });
    } catch (error) {
      console.error('Error sending ban cleared notification:', error.message);
    }

    return {
      success: true,
      message: 'Ban removed (no upstream integrations to notify)'
    };
  }

  // Add to queue for each integration that was notified
  const banQueue = getBanQueue();

  for (const notified of integrationsNotified) {
    banQueue.enqueue(notified.id, {
      action: 'unban',
      ip,
      provider_ban_id: notified.ban_id
    });
  }

  // Mark as unbanned immediately (don't wait for queue)
  db.prepare(`
    UPDATE ip_bans
    SET unbanned_at = CURRENT_TIMESTAMP,
        unbanned_by = ?
    WHERE id = ?
  `).run(unbanned_by, ban.id);

  console.log(`✓ Unbanned IP ${ip} (queued for ${integrationsNotified.length} integration(s))`);

  // Broadcast unban event for real-time updates
  try {
    const { broadcastBanEvent } = require('../routes/api');
    if (broadcastBanEvent) {
      broadcastBanEvent('ban_removed', {
        ip_address: ip,
        ban_id: ban.id
      });
    }
  } catch (error) {
    // Ignore circular dependency errors during startup
  }

  // Send notification
  try {
    const { notifyBanCleared } = require('./notification-service');

    let unbanned_by_username = null;
    if (unbanned_by) {
      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(unbanned_by);
      unbanned_by_username = user?.username;
    }

    notifyBanCleared({
      ip_address: ip,
      reason: ban.reason,
      banned_at: ban.banned_at,
      expires_at: ban.expires_at,
      manual: !!unbanned_by,
      unbanned_by_username,
      auto_banned: ban.auto_banned
    }).catch(err => {
      console.error('Failed to send ban cleared notification:', err.message);
    });
  } catch (error) {
    console.error('Error sending ban cleared notification:', error.message);
  }

  return {
    success: true,
    integrations_queued: integrationsNotified.length,
    message: `Unban queued for ${integrationsNotified.length} integration(s)`
  };
}

/**
 * Make a ban permanent
 */
async function makeBanPermanent(ip) {
  // Get the ban ID before updating
  const ban = db.prepare(`
    SELECT id FROM ip_bans
    WHERE ip_address = ?
      AND unbanned_at IS NULL
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
  `).get(ip);

  if (!ban) {
    return {
      success: false,
      message: 'No active ban found for this IP'
    };
  }

  // Update database to make ban permanent
  db.prepare(`
    UPDATE ip_bans
    SET expires_at = NULL
    WHERE id = ?
  `).run(ban.id);

  console.log(`✓ Made ban permanent for IP ${ip}`);

  // Sync with firewall to update from temporary to permanent
  try {
    const { getBanSyncService } = require('./ban-sync-service');
    const syncService = getBanSyncService();
    await syncService.updateBanExpiry(ban.id, null);
    console.log(`✓ Synced permanent ban to firewall for ${ip}`);
  } catch (error) {
    console.error(`⚠️  Failed to sync permanent ban to firewall for ${ip}:`, error.message);
    // Don't fail the operation, just log the error
  }

  return {
    success: true,
    message: 'Ban is now permanent and synced to firewall'
  };
}

/**
 * Get ban details for an IP
 */
function getBanDetails(ip) {
  const ban = db.prepare(`
    SELECT
      b.*,
      u1.username as banned_by_username,
      u2.username as unbanned_by_username,
      p.domain_names as proxy_domain,
      r.name as rule_name
    FROM ip_bans b
    LEFT JOIN users u1 ON b.banned_by = u1.id
    LEFT JOIN users u2 ON b.unbanned_by = u2.id
    LEFT JOIN proxy_hosts p ON b.proxy_id = p.id
    LEFT JOIN ips_detection_rules r ON b.detection_rule_id = r.id
    WHERE b.ip_address = ?
      AND b.unbanned_at IS NULL
      AND (b.expires_at IS NULL OR b.expires_at > CURRENT_TIMESTAMP)
    ORDER BY b.banned_at DESC
    LIMIT 1
  `).get(ip);

  return ban;
}

/**
 * Get all active bans
 */
function getActiveBans(limit = 1000) {
  return db.prepare(`
    SELECT
      b.*,
      u1.username as banned_by_username,
      p.domain_names as proxy_domain,
      r.name as rule_name
    FROM ip_bans b
    LEFT JOIN users u1 ON b.banned_by = u1.id
    LEFT JOIN proxy_hosts p ON b.proxy_id = p.id
    LEFT JOIN ips_detection_rules r ON b.detection_rule_id = r.id
    WHERE b.unbanned_at IS NULL
      AND (b.expires_at IS NULL OR b.expires_at > CURRENT_TIMESTAMP)
    ORDER BY b.banned_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Clean up expired bans
 */
async function cleanupExpiredBans() {
  const expired = db.prepare(`
    SELECT DISTINCT ip_address FROM ip_bans
    WHERE unbanned_at IS NULL
      AND expires_at IS NOT NULL
      AND expires_at <= CURRENT_TIMESTAMP
  `).all();

  let cleaned = 0;

  for (const { ip_address } of expired) {
    const result = await unbanIP(ip_address, null);
    if (result.success) {
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`✓ Cleaned up ${cleaned} expired bans`);
  }

  return cleaned;
}

/**
 * Get ban statistics
 */
function getBanStatistics() {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_bans,
      COUNT(CASE WHEN auto_banned = 1 THEN 1 END) as auto_bans,
      COUNT(CASE WHEN auto_banned = 0 THEN 1 END) as manual_bans,
      COUNT(CASE WHEN expires_at IS NULL THEN 1 END) as permanent_bans,
      COUNT(CASE WHEN expires_at IS NOT NULL THEN 1 END) as temporary_bans,
      COUNT(DISTINCT ip_address) as unique_ips
    FROM ip_bans
    WHERE unbanned_at IS NULL
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
  `).get();

  const recentBans = db.prepare(`
    SELECT COUNT(*) as count
    FROM ip_bans
    WHERE banned_at > datetime('now', '-24 hours')
  `).get();

  const topAttackTypes = db.prepare(`
    SELECT attack_type, COUNT(*) as count
    FROM ip_bans
    WHERE unbanned_at IS NULL
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      AND attack_type IS NOT NULL
    GROUP BY attack_type
    ORDER BY count DESC
    LIMIT 5
  `).all();

  return {
    ...stats,
    bans_last_24h: recentBans.count,
    top_attack_types: topAttackTypes
  };
}

module.exports = {
  banIP,
  unbanIP,
  makeBanPermanent,
  isBanned,
  getBanDetails,
  getActiveBans,
  cleanupExpiredBans,
  getBanStatistics
};
