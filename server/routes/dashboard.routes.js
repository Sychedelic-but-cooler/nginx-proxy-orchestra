/**
 * Dashboard routes
 * Provides summary statistics and recent activity
 */

const { db } = require('../db');
const { sendJSON } = require('./shared/utils');
const { getNginxStatus } = require('../utils/nginx-ops');
const { 
  getStaticSystemInfo, 
  getRealTimeMetrics 
} = require('../utils/system-metrics');

/**
 * Handle dashboard-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
function handleDashboardRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/dashboard/stats' && method === 'GET') {
    return handleDashboardStats(req, res);
  }

  if (pathname === '/api/dashboard/system/static' && method === 'GET') {
    return handleStaticSystemInfo(req, res);
  }

  if (pathname === '/api/dashboard/system/metrics' && method === 'GET') {
    return handleRealTimeMetrics(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get dashboard statistics
 * Returns summary of proxies, certificates, nginx status, and recent activity
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleDashboardStats(req, res) {
  const proxyCount = db.prepare('SELECT COUNT(*) as count FROM proxy_hosts WHERE enabled = 1').get();
  const totalProxies = db.prepare('SELECT COUNT(*) as count FROM proxy_hosts').get();
  const certificateCount = db.prepare('SELECT COUNT(*) as count FROM ssl_certificates').get();

  // Get certificates expiring in next 30 days
  const expiringCerts = db.prepare(`
    SELECT name, domain_names, expires_at
    FROM ssl_certificates
    WHERE expires_at IS NOT NULL
      AND date(expires_at) <= date('now', '+30 days')
      AND date(expires_at) >= date('now')
    ORDER BY expires_at ASC
    LIMIT 10
  `).all();

  // Add urgency level to each certificate
  const now = Date.now();
  const certsWithUrgency = expiringCerts.map(cert => {
    const expiresAt = new Date(cert.expires_at).getTime();
    const daysUntilExpiry = Math.floor((expiresAt - now) / (1000 * 60 * 60 * 24));

    let urgency = 'normal';
    if (daysUntilExpiry <= 7) {
      urgency = 'critical';
    } else if (daysUntilExpiry <= 14) {
      urgency = 'warning';
    }

    return {
      ...cert,
      daysUntilExpiry,
      urgency
    };
  });

  // Recent audit log
  const recentActivity = db.prepare(`
    SELECT
      al.action,
      al.resource_type,
      al.created_at,
      u.username
    FROM audit_log al
    LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.created_at DESC
    LIMIT 10
  `).all();

  const nginxStatus = getNginxStatus();

  sendJSON(res, {
    proxies: {
      active: proxyCount.count,
      total: totalProxies.count
    },
    certificates: {
      total: certificateCount.count,
      expiring: certsWithUrgency
    },
    nginx: nginxStatus,
    recentActivity
  });
}

/**
 * Get static system information (cached)
 * Hardware details that don't change
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleStaticSystemInfo(req, res) {
  const staticInfo = getStaticSystemInfo();
  sendJSON(res, staticInfo);
}

/**
 * Get real-time system metrics
 * Per-second updates for CPU, memory, network, disk I/O
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleRealTimeMetrics(req, res) {
  const metrics = getRealTimeMetrics();
  sendJSON(res, metrics);
}

module.exports = handleDashboardRoutes;
