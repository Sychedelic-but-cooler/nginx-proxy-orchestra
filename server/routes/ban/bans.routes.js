/**
 * IP bans routes
 * Manages IP ban operations and statistics
 */

const { db, logAudit } = require('../../db');
const { parseBody, sendJSON, getClientIP } = require('../shared/utils');
const {
  banIP,
  unbanIP,
  makeBanPermanent: makeBanPermanentService,
  getActiveBans,
  getBanStatistics
} = require('../../utils/ban-service');
const { getDetectionStats, getTrackedIPs } = require('../../utils/detection-engine');
const { broadcastBanEvent } = require('../shared/sse');

/**
 * Handle IP bans routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleBansRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/ban/bans' && method === 'GET') {
    return handleGetBans(req, res, parsedUrl);
  }

  if (pathname === '/api/ban/bans' && method === 'POST') {
    return handleCreateBan(req, res);
  }

  if (pathname.match(/^\/api\/ban\/bans\/\d+$/) && method === 'DELETE') {
    return handleUnban(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/ban\/bans\/\d+\/permanent$/) && method === 'POST') {
    return handleMakeBanPermanent(req, res, parsedUrl);
  }

  if (pathname === '/api/ban/bans/stats' && method === 'GET') {
    return handleGetBanStats(req, res);
  }

  if (pathname === '/api/ban/bans/sync' && method === 'POST') {
    return handleSyncAllBans(req, res);
  }

  if (pathname.match(/^\/api\/ban\/bans\/sync\/(.+)$/) && method === 'POST') {
    return handleSyncSingleIP(req, res, parsedUrl);
  }

  if (pathname === '/api/ban/bans/sync-status' && method === 'GET') {
    return handleGetSyncStatus(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get bans
 * Returns list of active IP bans
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 */
function handleGetBans(req, res, parsedUrl) {
  try {
    const limit = parseInt(parsedUrl.searchParams.get('limit')) || 100;
    const bans = getActiveBans(limit);

    sendJSON(res, { bans });
  } catch (error) {
    console.error('Get bans error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Create ban
 * Manually bans an IP address
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleCreateBan(req, res) {
  try {
    const body = await parseBody(req);
    const { ip_address, reason, duration, severity } = body;

    if (!ip_address) {
      return sendJSON(res, { error: 'IP address is required' }, 400);
    }

    if (!reason) {
      return sendJSON(res, { error: 'Reason is required' }, 400);
    }

    const result = await banIP(ip_address, {
      reason,
      severity: severity || 'MEDIUM',
      ban_duration: duration || null,  // null = permanent
      auto_banned: false,
      banned_by: req.user.userId
    });

    if (!result.success) {
      return sendJSON(res, { error: result.message }, 400);
    }

    logAudit(
      req.user.userId,
      'manual_ban',
      'ip_ban',
      result.ban_id,
      JSON.stringify({ ip_address, reason }),
      getClientIP(req)
    );

    // Broadcast ban event for real-time updates
    broadcastBanEvent('ban_created', {
      ip_address,
      reason,
      severity: severity || 'MEDIUM',
      ban_id: result.ban_id
    });

    sendJSON(res, {
      success: true,
      ban_id: result.ban_id,
      message: result.message,
      integrations_queued: result.integrations_queued
    }, 201);
  } catch (error) {
    console.error('Create ban error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Unban IP
 * Removes an IP ban
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with ban ID
 */
async function handleUnban(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const ban = db.prepare('SELECT ip_address FROM ip_bans WHERE id = ?').get(id);
    if (!ban) {
      return sendJSON(res, { error: 'Ban not found' }, 404);
    }

    const result = await unbanIP(ban.ip_address, req.user.userId);

    if (!result.success) {
      return sendJSON(res, { error: result.message }, 400);
    }

    logAudit(
      req.user.userId,
      'manual_unban',
      'ip_ban',
      id,
      JSON.stringify({ ip_address: ban.ip_address }),
      getClientIP(req)
    );

    // Broadcast ban event for real-time updates
    broadcastBanEvent('ban_removed', {
      ip_address: ban.ip_address,
      ban_id: id
    });

    sendJSON(res, {
      success: true,
      message: result.message,
      integrations_queued: result.integrations_queued || 0
    });
  } catch (error) {
    console.error('Unban error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Make ban permanent
 * Converts a temporary ban to permanent
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with ban ID
 */
async function handleMakeBanPermanent(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const ban = db.prepare('SELECT ip_address FROM ip_bans WHERE id = ?').get(id);
    if (!ban) {
      return sendJSON(res, { error: 'Ban not found' }, 404);
    }

    const result = await makeBanPermanentService(ban.ip_address);

    if (!result.success) {
      return sendJSON(res, { error: result.message }, 400);
    }

    logAudit(
      req.user.userId,
      'make_ban_permanent',
      'ip_ban',
      id,
      JSON.stringify({ ip_address: ban.ip_address }),
      getClientIP(req)
    );

    // Broadcast ban event for real-time updates
    broadcastBanEvent('ban_updated', {
      ip_address: ban.ip_address,
      ban_id: id,
      permanent: true
    });

    sendJSON(res, { success: true, message: result.message });
  } catch (error) {
    console.error('Make ban permanent error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get ban statistics
 * Returns statistics about bans and detection
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetBanStats(req, res) {
  try {
    const stats = getBanStatistics();
    const detectionStats = getDetectionStats();
    const trackedIPs = getTrackedIPs(20);  // Top 20 tracked IPs

    sendJSON(res, {
      ...stats,
      detection: detectionStats,
      tracked_ips: trackedIPs
    });
  } catch (error) {
    console.error('Get ban stats error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Sync all bans
 * Triggers synchronization of all bans to integrations
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleSyncAllBans(req, res) {
  try {
    const { getBanSyncService } = require('../../utils/ban-sync-service');
    const syncService = getBanSyncService();

    console.log(`Manual ban sync triggered by user ${req.user.userId}`);

    // Trigger full sync
    await syncService.syncAllBans();

    logAudit(req.user.userId, 'sync_all_bans', 'ban_system', null, null, getClientIP(req));

    sendJSON(res, {
      success: true,
      message: 'Ban synchronization completed successfully'
    });
  } catch (error) {
    console.error('Sync all bans error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Sync single IP
 * Triggers synchronization of a single IP to integrations
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with IP address
 */
async function handleSyncSingleIP(req, res, parsedUrl) {
  try {
    const ip = decodeURIComponent(parsedUrl.pathname.split('/')[5]);

    if (!ip) {
      return sendJSON(res, { error: 'IP address is required' }, 400);
    }

    const { getBanSyncService } = require('../../utils/ban-sync-service');
    const syncService = getBanSyncService();

    console.log(`Manual sync for IP ${ip} triggered by user ${req.user.userId}`);

    const result = await syncService.syncIP(ip);

    logAudit(req.user.userId, 'sync_single_ip', 'ban_system', null, JSON.stringify({ ip }), getClientIP(req));

    sendJSON(res, result);
  } catch (error) {
    console.error('Sync single IP error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get sync status
 * Returns current status of ban synchronization
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetSyncStatus(req, res) {
  try {
    const { getBanSyncService } = require('../../utils/ban-sync-service');
    const syncService = getBanSyncService();

    const status = syncService.getStatus();

    sendJSON(res, status);
  } catch (error) {
    console.error('Get sync status error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

module.exports = handleBansRoutes;
