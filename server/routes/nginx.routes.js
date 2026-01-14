/**
 * Nginx routes
 * Manages nginx operations, status, and statistics
 */

const { db, logAudit } = require('../db');
const { sendJSON, getClientIP } = require('./shared/utils');
const { testNginxConfig, getNginxStatus, getStubStatus } = require('../utils/nginx-ops');
const { reloadManager } = require('../utils/nginx-reload-manager');
const { getCachedNginxStats, getCacheAge } = require('../utils/stats-cache-service');

/**
 * Handle nginx-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleNginxRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/nginx/test' && method === 'POST') {
    return handleNginxTest(req, res);
  }

  if (pathname === '/api/nginx/reload' && method === 'POST') {
    return handleNginxReload(req, res);
  }

  if (pathname.match(/^\/api\/nginx\/reload-status\/\d+$/) && method === 'GET') {
    return handleNginxReloadStatus(req, res, parsedUrl);
  }

  if (pathname === '/api/nginx/status' && method === 'GET') {
    return handleNginxStatus(req, res);
  }

  if (pathname === '/api/nginx/tuning-stats' && method === 'GET') {
    return handleGetNginxTuningStats(req, res, parsedUrl);
  }

  if (pathname === '/api/nginx/statistics' && method === 'GET') {
    return handleGetNginxStatistics(req, res, parsedUrl);
  }

  if (pathname === '/api/nginx/stub-status' && method === 'GET') {
    return handleGetStubStatus(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Test nginx configuration
 * Validates nginx configuration without reloading
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleNginxTest(req, res) {
  const result = testNginxConfig();
  sendJSON(res, result);
}

/**
 * Reload nginx
 * Queues a nginx reload operation
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleNginxReload(req, res) {
  const { reloadId } = await reloadManager.queueReload();

  logAudit(req.user.userId, 'reload_nginx', 'nginx', null, null, getClientIP(req));

  sendJSON(res, { success: true, reloadId, message: 'Reload queued' });
}

/**
 * Get reload status
 * Returns the status of a specific reload operation
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with reload ID
 */
function handleNginxReloadStatus(req, res, parsedUrl) {
  const reloadId = parseInt(parsedUrl.pathname.split('/').pop());
  const status = reloadManager.getReloadStatus(reloadId);
  sendJSON(res, status);
}

/**
 * Get nginx status
 * Returns nginx process status and uptime
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleNginxStatus(req, res) {
  const status = getNginxStatus();
  sendJSON(res, status);
}

/**
 * Get nginx tuning statistics
 * Returns statistics for tuning and optimization
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 */
async function handleGetNginxTuningStats(req, res, parsedUrl) {
  try {
    const params = new URLSearchParams(parsedUrl.search);
    const hoursBack = parseInt(params.get('hours') || '24');
    const excludePrivate = params.get('excludePrivate') !== 'false'; // Default true

    // Determine cache key based on hours
    const timeRange = hoursBack === 24 ? '24h' : '7d';

    // Get cached stats
    const stats = getCachedNginxStats(timeRange, excludePrivate);

    if (!stats) {
      // Cache not ready yet, return minimal response
      return sendJSON(res, {
        timeRange: `${hoursBack}h`,
        topIPs: [],
        topUserAgents: [],
        topCountries: [],
        totalRequests: 0,
        uniqueIPCount: 0,
        blockedRequests: 0,
        rateLimitedRequests: 0,
        cacheStatus: 'loading',
        message: 'Statistics are being generated. Please refresh in a few seconds.'
      });
    }

    sendJSON(res, {
      timeRange: `${hoursBack}h`,
      topIPs: stats.topIPs,
      topUserAgents: stats.topUserAgents,
      topCountries: stats.topCountries || [],
      totalRequests: stats.totalRequests,
      uniqueIPCount: stats.uniqueIPCount,
      blockedRequests: stats.blockedRequests,
      rateLimitedRequests: stats.rateLimitedRequests,
      cacheStatus: 'ready',
      cacheAge: getCacheAge()
    });
  } catch (error) {
    console.error('Get nginx tuning stats error:', error);
    sendJSON(res, { error: error.message || 'Failed to get tuning statistics' }, 500);
  }
}

/**
 * Get nginx statistics
 * Returns effectiveness metrics and security rule statistics
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 */
async function handleGetNginxStatistics(req, res, parsedUrl) {
  try {
    const params = new URLSearchParams(parsedUrl.search);
    const hoursBack = parseInt(params.get('hours') || '24');

    // Determine cache key based on hours
    const timeRange = hoursBack === 24 ? '24h' : '7d';

    // Get cached stats
    const stats = getCachedNginxStats(timeRange, false); // Don't exclude private IPs for this endpoint

    if (!stats) {
      // Cache not ready yet
      return sendJSON(res, {
        timeRange: `${hoursBack}h`,
        totalRequests: 0,
        successfulRequests: 0,
        blockedRequests: 0,
        rateLimitedRequests: 0,
        successRate: '0.00',
        blockedPercentage: '0.00',
        rateLimitedPercentage: '0.00',
        statusBreakdown: {},
        errorStats: {},
        activeRules: {
          ipBlacklist: 0,
          geoBlock: 0,
          userAgentFilter: 0,
          rateLimit: 0
        },
        metrics: {
          avgRequestsPerHour: 0,
          avgBlocksPerHour: 0,
          avgRateLimitsPerHour: 0
        },
        cacheStatus: 'loading',
        message: 'Statistics are being generated. Please refresh in a few seconds.'
      });
    }

    // Calculate additional metrics
    const successRate = stats.totalRequests > 0
      ? ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(2)
      : '0.00';

    const blockedPercentage = stats.totalRequests > 0
      ? ((stats.blockedRequests / stats.totalRequests) * 100).toFixed(2)
      : '0.00';

    const rateLimitedPercentage = stats.totalRequests > 0
      ? ((stats.rateLimitedRequests / stats.totalRequests) * 100).toFixed(2)
      : '0.00';

    // Get security rule counts
    const activeRules = {
      ipBlacklist: db.prepare(
        "SELECT COUNT(*) as count FROM security_rules WHERE rule_type = 'ip_blacklist' AND enabled = 1"
      ).get().count,
      geoBlock: db.prepare(
        "SELECT COUNT(*) as count FROM security_rules WHERE rule_type = 'geo_block' AND enabled = 1"
      ).get().count,
      userAgentFilter: db.prepare(
        "SELECT COUNT(*) as count FROM security_rules WHERE rule_type = 'user_agent_filter' AND enabled = 1"
      ).get().count,
      rateLimit: db.prepare(
        "SELECT COUNT(*) as count FROM rate_limits WHERE enabled = 1"
      ).get().count
    };

    sendJSON(res, {
      timeRange: `${hoursBack}h`,
      totalRequests: stats.totalRequests,
      successfulRequests: stats.successfulRequests,
      blockedRequests: stats.blockedRequests,
      rateLimitedRequests: stats.rateLimitedRequests,
      successRate,
      blockedPercentage,
      rateLimitedPercentage,
      statusBreakdown: stats.requestsByStatus,
      errorStats: stats.errorStats,
      activeRules,
      metrics: {
        avgRequestsPerHour: (stats.totalRequests / hoursBack).toFixed(0),
        avgBlocksPerHour: (stats.blockedRequests / hoursBack).toFixed(0),
        avgRateLimitsPerHour: (stats.rateLimitedRequests / hoursBack).toFixed(0)
      },
      cacheStatus: 'ready',
      cacheAge: getCacheAge()
    });
  } catch (error) {
    console.error('Get nginx statistics error:', error);
    sendJSON(res, { error: error.message || 'Failed to get nginx statistics' }, 500);
  }
}

/**
 * Get stub_status metrics
 * Returns real-time nginx performance metrics from stub_status module
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleGetStubStatus(req, res) {
  try {
    const result = await getStubStatus();
    sendJSON(res, result);
  } catch (error) {
    console.error('Get stub_status error:', error);
    sendJSON(res, { 
      success: false,
      error: error.message || 'Failed to fetch stub_status metrics' 
    }, 500);
  }
}

module.exports = handleNginxRoutes;
