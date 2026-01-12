/**
 * Statistics routes
 * Provides traffic statistics and analytics
 */

const { sendJSON } = require('./shared/utils');
const { getCachedTrafficStats, refreshStatsCache } = require('../utils/stats-cache-service');

/**
 * Handle statistics-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleStatisticsRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/statistics' && method === 'GET') {
    return handleGetStatistics(req, res, parsedUrl);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get traffic statistics
 * Returns traffic analytics including requests, status codes, top IPs, etc.
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 */
async function handleGetStatistics(req, res, parsedUrl) {
  try {
    // Get query parameters
    const params = new URLSearchParams(parsedUrl.search);
    const timeRange = params.get('range') || '24h';
    const forceRefresh = params.get('refresh') === 'true';

    // Force refresh if requested
    if (forceRefresh) {
      await refreshStatsCache();
    }

    // Get traffic statistics from unified cache (5-minute refresh)
    let statistics = getCachedTrafficStats(timeRange);

    // If cache not ready yet, return empty stats
    if (!statistics) {
      statistics = {
        totalRequests: 0,
        uniqueVisitors: 0,
        statusCodes: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
        errors4xx: 0,
        errors5xx: 0,
        errorRate4xx: '0.00',
        errorRate5xx: '0.00',
        topIPs: [],
        topErrorIPs: [],
        topHosts: [],
        requestsByHour: Array(24).fill(0),
        totalBytes: 0,
        totalBytesFormatted: '0 B',
        timeRangeStart: null,
        timeRangeEnd: null
      };
    } else {
      // Map to legacy format for backward compatibility
      statistics = {
        ...statistics,
        uniqueVisitors: statistics.totalRequests, // Approximate
        statusCodes: statistics.statusCategories,
        errors4xx: statistics.statusCategories['4xx'] || 0,
        errors5xx: statistics.statusCategories['5xx'] || 0,
        errorRate4xx: statistics.errorRate,
        errorRate5xx: statistics.errorRate
      };
    }

    sendJSON(res, statistics);
  } catch (error) {
    console.error('Statistics error:', error);
    sendJSON(res, { error: error.message || 'Failed to get statistics' }, 500);
  }
}

module.exports = handleStatisticsRoutes;
