/**
 * Security stats and settings routes
 * Manages security statistics, settings, and recent blocks
 */

const { db, logAudit, getSetting, setSetting } = require('../../db');
const { parseBody, sendJSON, getClientIP } = require('../shared/utils');
const { updateGlobalSecurityConfig } = require('../../utils/security-config-generator');
const { reloadManager } = require('../../utils/nginx-reload-manager');
const { getCachedSecurityStats } = require('../../utils/stats-cache-service');

/**
 * Handle security stats and settings routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleSecurityStatsRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/security/settings' && method === 'GET') {
    return handleGetSecuritySettings(req, res);
  }

  if (pathname === '/api/security/settings' && method === 'PUT') {
    return handleUpdateSecuritySettings(req, res);
  }

  if (pathname === '/api/security/stats' && method === 'GET') {
    return handleGetSecurityStats(req, res, parsedUrl);
  }

  if (pathname === '/api/security/recent-blocks' && method === 'GET') {
    return handleGetRecentBlocks(req, res, parsedUrl);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get security settings
 * Returns all security-related configuration settings
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetSecuritySettings(req, res) {
  try {
    const settingKeys = [
      'security_ip_blacklist_enabled',
      'security_geo_blocking_enabled',
      'security_user_agent_filtering_enabled',
      'security_default_deny_countries',
      'security_geoip_database_path',
      'waf_enabled',
      'waf_mode',
      'waf_default_profile_id'
    ];

    const settings = {};
    for (const key of settingKeys) {
      const value = getSetting(key);
      // Convert '0'/'1' to boolean for enabled fields
      if (key.endsWith('_enabled')) {
        settings[key] = value === '1';
      } else {
        settings[key] = value || '';
      }
    }

    sendJSON(res, settings);
  } catch (error) {
    console.error('Get security settings error:', error);
    sendJSON(res, { error: error.message || 'Failed to get security settings' }, 500);
  }
}

/**
 * Update security settings
 * Updates security configuration and regenerates nginx config
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleUpdateSecuritySettings(req, res) {
  try {
    const body = await parseBody(req);

    const allowedKeys = [
      'security_ip_blacklist_enabled',
      'security_geo_blocking_enabled',
      'security_user_agent_filtering_enabled',
      'security_default_deny_countries',
      'security_geoip_database_path',
      'waf_enabled',
      'waf_mode',
      'waf_default_profile_id'
    ];

    for (const key of allowedKeys) {
      if (body.hasOwnProperty(key)) {
        let value = body[key];
        // Convert boolean to '0'/'1' for enabled fields
        if (key.endsWith('_enabled')) {
          value = value ? '1' : '0';
        }
        setSetting(key, String(value));
      }
    }

    // Update global security config
    updateGlobalSecurityConfig(db);

    // Log audit
    logAudit(
      req.user.userId,
      'update',
      'security_settings',
      null,
      'Updated security settings',
      getClientIP(req)
    );

    // Trigger nginx reload
    await reloadManager.queueReload();

    sendJSON(res, { success: true, message: 'Security settings updated successfully' });
  } catch (error) {
    console.error('Update security settings error:', error);
    sendJSON(res, { error: error.message || 'Failed to update security settings' }, 500);
  }
}

/**
 * Get security statistics
 * Returns security effectiveness metrics and rule statistics
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 */
function handleGetSecurityStats(req, res, parsedUrl) {
  try {
    const params = new URLSearchParams(parsedUrl.search);
    const timeRange = params.get('range') || '24h';

    // Get cached stats
    const stats = getCachedSecurityStats(timeRange);

    if (!stats) {
      // Cache not ready yet, return basic rule counts
      const ipBlacklistCount = db.prepare(
        "SELECT COUNT(*) as count FROM security_rules WHERE rule_type = 'ip_blacklist' AND enabled = 1"
      ).get().count;

      const geoBlockCount = db.prepare(
        "SELECT COUNT(*) as count FROM security_rules WHERE rule_type = 'geo_block' AND enabled = 1"
      ).get().count;

      const uaFilterCount = db.prepare(
        "SELECT COUNT(*) as count FROM security_rules WHERE rule_type = 'user_agent_filter' AND enabled = 1"
      ).get().count;

      const rateLimitCount = db.prepare(
        "SELECT COUNT(*) as count FROM rate_limits WHERE enabled = 1"
      ).get().count;

      return sendJSON(res, {
        timeRange,
        blocked: {
          total: 0,
          byRule: {
            ip_blacklist: 0,
            geo_block: 0,
            user_agent_filter: 0,
            rate_limit: 0
          }
        },
        topBlockedIPs: [],
        topBlockedCountries: [],
        rateLimitHits: 0,
        activeRules: {
          ipBlacklist: ipBlacklistCount,
          geoBlock: geoBlockCount,
          userAgentFilter: uaFilterCount,
          rateLimit: rateLimitCount
        },
        cacheStatus: 'loading'
      });
    }

    sendJSON(res, {
      ...stats,
      cacheStatus: 'ready'
    });
  } catch (error) {
    console.error('Get security stats error:', error);
    sendJSON(res, { error: error.message || 'Failed to get security stats' }, 500);
  }
}

/**
 * Get recent blocks
 * Returns recent blocked requests
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 */
function handleGetRecentBlocks(req, res, parsedUrl) {
  try {
    const params = new URLSearchParams(parsedUrl.search);
    const limit = parseInt(params.get('limit') || '50');

    // For now, return empty array
    // In the future, parse nginx logs for 403/429 responses
    const blocks = [];

    sendJSON(res, { blocks });
  } catch (error) {
    console.error('Get recent blocks error:', error);
    sendJSON(res, { error: error.message || 'Failed to get recent blocks' }, 500);
  }
}

module.exports = handleSecurityStatsRoutes;
