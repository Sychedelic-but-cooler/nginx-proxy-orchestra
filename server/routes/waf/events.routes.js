/**
 * WAF events routes
 * Manages ModSecurity WAF event logs and statistics
 */

const { db } = require('../../db');
const { sendJSON } = require('../shared/utils');
const { getWAFDb } = require('../../waf-db');

/**
 * Handle WAF events routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleWAFEventsRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/waf/events' && method === 'GET') {
    return handleGetWAFEvents(req, res, parsedUrl);
  }

  if (pathname === '/api/waf/stats' && method === 'GET') {
    return handleGetWAFStats(req, res, parsedUrl);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get WAF events
 * Returns WAF events with filtering and pagination
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 */
function handleGetWAFEvents(req, res, parsedUrl) {
  try {
    const params = parsedUrl.searchParams;
    const limit = parseInt(params.get('limit') || '100');
    const offset = parseInt(params.get('offset') || '0');
    const proxyId = params.get('proxy_id');
    const severity = params.get('severity');
    const attackType = params.get('attack_type');
    const clientIp = params.get('client_ip');
    const startDate = params.get('start_date');
    const endDate = params.get('end_date');
    const blocked = params.get('blocked');

    let query = `
      SELECT
        e.*,
        p.name as proxy_name,
        p.domain_names,
        json_extract(e.raw_log, '$.transaction.response.http_code') as http_status
      FROM waf_events e
      LEFT JOIN proxy_hosts p ON e.proxy_id = p.id
      WHERE 1=1
    `;
    const queryParams = [];

    if (proxyId) {
      query += ' AND e.proxy_id = ?';
      queryParams.push(proxyId);
    }
    if (severity) {
      query += ' AND e.severity = ?';
      queryParams.push(severity);
    }
    if (attackType) {
      query += ' AND LOWER(e.attack_type) = LOWER(?)';
      queryParams.push(attackType);
    }
    if (clientIp) {
      query += ' AND e.client_ip = ?';
      queryParams.push(clientIp);
    }
    if (startDate) {
      query += ' AND e.timestamp >= ?';
      queryParams.push(startDate);
    }
    if (endDate) {
      query += ' AND e.timestamp <= ?';
      queryParams.push(endDate);
    }
    if (blocked !== null && blocked !== undefined && blocked !== '') {
      query += ' AND e.blocked = ?';
      // Convert string "true"/"false" to 1/0
      const blockedValue = blocked === 'true' || blocked === true ? 1 : 0;
      queryParams.push(blockedValue);
    }

    query += ' ORDER BY e.timestamp DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    // Use WAF database (main database is attached as 'maindb' at startup)
    const wafDb = getWAFDb();

    // Update query to use maindb.proxy_hosts
    query = query.replace('LEFT JOIN proxy_hosts p', 'LEFT JOIN maindb.proxy_hosts p');

    const events = wafDb.prepare(query).all(...queryParams);

    // Get total count for pagination (use same params except limit/offset)
    let countQuery = 'SELECT COUNT(*) as total FROM waf_events e WHERE 1=1';
    const countParams = [];

    if (proxyId) {
      countQuery += ' AND e.proxy_id = ?';
      countParams.push(proxyId);
    }
    if (severity) {
      countQuery += ' AND e.severity = ?';
      countParams.push(severity);
    }
    if (attackType) {
      countQuery += ' AND LOWER(e.attack_type) = LOWER(?)';
      countParams.push(attackType);
    }
    if (clientIp) {
      countQuery += ' AND e.client_ip = ?';
      countParams.push(clientIp);
    }
    if (startDate) {
      countQuery += ' AND e.timestamp >= ?';
      countParams.push(startDate);
    }
    if (endDate) {
      countQuery += ' AND e.timestamp <= ?';
      countParams.push(endDate);
    }
    if (blocked !== null && blocked !== undefined && blocked !== '') {
      countQuery += ' AND e.blocked = ?';
      const blockedValue = blocked === 'true' || blocked === true ? 1 : 0;
      countParams.push(blockedValue);
    }

    const total = wafDb.prepare(countQuery).get(...countParams).total;

    sendJSON(res, { events, total, limit, offset });
  } catch (error) {
    console.error('Get WAF events error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get WAF statistics
 * Returns aggregated statistics about WAF events
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 */
function handleGetWAFStats(req, res, parsedUrl) {
  try {
    const params = parsedUrl.searchParams;
    const hours = parseInt(params.get('hours') || '24');
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const wafDb = getWAFDb();

    // Total events
    const totalEvents = wafDb.prepare(`
      SELECT COUNT(*) as count FROM waf_events
      WHERE timestamp >= ?
    `).get(cutoffTime).count;

    // Blocked attacks
    const blockedAttacks = wafDb.prepare(`
      SELECT COUNT(*) as count FROM waf_events
      WHERE timestamp >= ? AND blocked = 1
    `).get(cutoffTime).count;

    // Active profiles (single profile model) - from main DB
    const activeProfiles = db.prepare(`
      SELECT COUNT(DISTINCT waf_profile_id) as count FROM proxy_hosts WHERE waf_profile_id IS NOT NULL
    `).get().count;

    // Events by attack type
    const eventsByType = wafDb.prepare(`
      SELECT attack_type, COUNT(*) as count
      FROM waf_events
      WHERE timestamp >= ?
      GROUP BY attack_type
      ORDER BY count DESC
      LIMIT 10
    `).all(cutoffTime);

    // Top attacking IPs
    const topIPs = wafDb.prepare(`
      SELECT client_ip, COUNT(*) as count
      FROM waf_events
      WHERE timestamp >= ?
      GROUP BY client_ip
      ORDER BY count DESC
      LIMIT 10
    `).all(cutoffTime);

    // Events over time (hourly buckets)
    const timeline = wafDb.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00:00', timestamp) as hour,
        COUNT(*) as count,
        SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blocked_count
      FROM waf_events
      WHERE timestamp >= ?
      GROUP BY hour
      ORDER BY hour
    `).all(cutoffTime);

    // Events by severity
    const bySeverity = wafDb.prepare(`
      SELECT severity, COUNT(*) as count
      FROM waf_events
      WHERE timestamp >= ?
      GROUP BY severity
    `).all(cutoffTime);

    sendJSON(res, {
      total_events: totalEvents,
      totalEvents: totalEvents,
      blocked_attacks: blockedAttacks,
      blockedEvents: blockedAttacks,
      active_profiles: activeProfiles,
      profileCount: activeProfiles,
      enabled: activeProfiles > 0,
      by_type: eventsByType,
      top_ips: topIPs,
      timeline,
      by_severity: bySeverity
    });
  } catch (error) {
    console.error('Get WAF stats error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

module.exports = handleWAFEventsRoutes;
