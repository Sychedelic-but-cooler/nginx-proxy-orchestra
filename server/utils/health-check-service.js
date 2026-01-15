/**
 * Upstream Health Check Service
 * 
 * Monitors upstream servers by performing periodic health checks.
 * Tracks response times, success/failure rates, and maintains ping history.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { db } = require('../db');

// Store active check intervals
const activeChecks = new Map();

// Maximum number of pings to store per upstream
const MAX_PING_HISTORY = 100;

/**
 * Initialize health check service
 * Starts health checks for all enabled upstreams
 */
function initializeHealthChecks() {
  console.log('Initializing upstream health check service...');
  
  try {
    // Get all enabled health check configs
    const configs = db.prepare(`
      SELECT hc.*, ph.forward_scheme, ph.forward_host, ph.forward_port, ph.enabled as proxy_enabled
      FROM upstream_health_config hc
      JOIN proxy_hosts ph ON hc.proxy_id = ph.id
      WHERE hc.enabled = 1 AND ph.enabled = 1
    `).all();
    
    console.log(`  Starting health checks for ${configs.length} upstreams`);
    
    configs.forEach(config => {
      startHealthCheck(config);
    });
    
  } catch (error) {
    console.error('Failed to initialize health checks:', error.message);
  }
}

/**
 * Start health check for a specific upstream
 */
function startHealthCheck(config) {
  // Stop existing check if any
  stopHealthCheck(config.proxy_id);
  
  const intervalMs = config.check_interval * 1000;
  
  // Perform initial check immediately
  performHealthCheck(config);
  
  // Schedule periodic checks
  const intervalId = setInterval(() => {
    performHealthCheck(config);
  }, intervalMs);
  
  activeChecks.set(config.proxy_id, intervalId);
}

/**
 * Stop health check for a specific upstream
 */
function stopHealthCheck(proxyId) {
  const intervalId = activeChecks.get(proxyId);
  if (intervalId) {
    clearInterval(intervalId);
    activeChecks.delete(proxyId);
  }
}

/**
 * Perform a single health check
 */
async function performHealthCheck(config) {
  const startTime = Date.now();
  let status = 'down';
  let responseTime = null;
  let httpStatus = null;
  let errorMessage = null;
  
  try {
    const result = await checkUpstream(
      config.forward_scheme,
      config.forward_host,
      config.forward_port,
      config.check_path,
      config.timeout,
      config.expected_status
    );
    
    status = result.success ? 'up' : 'down';
    responseTime = result.responseTime;
    httpStatus = result.httpStatus;
    errorMessage = result.error;
    
  } catch (error) {
    status = 'down';
    errorMessage = error.message;
  }
  
  // Record ping
  recordPing(config.proxy_id, status, responseTime, httpStatus, errorMessage);
  
  // Update current health status
  updateCurrentStatus(config.proxy_id);
}

/**
 * Check upstream server availability
 */
function checkUpstream(scheme, host, port, path, timeout, expectedStatus) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const client = scheme === 'https' ? https : http;
    
    // Build URL
    const url = `${scheme}://${host}:${port}${path}`;
    
    const options = {
      method: 'HEAD', // Use HEAD for minimal overhead
      timeout: timeout,
      headers: {
        'User-Agent': 'Nginx-Proxy-Orchestra-HealthCheck/1.0'
      }
    };
    
    const req = client.request(url, options, (res) => {
      const responseTime = Date.now() - startTime;
      const httpStatus = res.statusCode;
      
      // Consume response data to free up memory
      res.resume();
      
      // Check if status matches expected
      const success = httpStatus === expectedStatus;
      
      resolve({
        success,
        responseTime,
        httpStatus,
        error: success ? null : `Unexpected status: ${httpStatus} (expected ${expectedStatus})`
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      const responseTime = Date.now() - startTime;
      resolve({
        success: false,
        responseTime,
        httpStatus: null,
        error: 'Request timeout'
      });
    });
    
    req.on('error', (error) => {
      const responseTime = Date.now() - startTime;
      resolve({
        success: false,
        responseTime,
        httpStatus: null,
        error: error.message
      });
    });
    
    req.end();
  });
}

/**
 * Record a ping in the database
 */
function recordPing(proxyId, status, responseTime, httpStatus, errorMessage) {
  try {
    // Insert new ping
    db.prepare(`
      INSERT INTO upstream_health_pings (proxy_id, status, response_time, http_status, error_message)
      VALUES (?, ?, ?, ?, ?)
    `).run(proxyId, status, responseTime, httpStatus, errorMessage);
    
    // Trim old pings (keep only last MAX_PING_HISTORY)
    const count = db.prepare('SELECT COUNT(*) as count FROM upstream_health_pings WHERE proxy_id = ?')
      .get(proxyId).count;
    
    if (count > MAX_PING_HISTORY) {
      const toDelete = count - MAX_PING_HISTORY;
      db.prepare(`
        DELETE FROM upstream_health_pings 
        WHERE id IN (
          SELECT id FROM upstream_health_pings 
          WHERE proxy_id = ? 
          ORDER BY timestamp ASC 
          LIMIT ?
        )
      `).run(proxyId, toDelete);
    }
  } catch (error) {
    console.error(`Failed to record ping for proxy ${proxyId}:`, error.message);
  }
}

/**
 * Update current health status based on recent pings
 */
function updateCurrentStatus(proxyId) {
  try {
    // Get last 100 pings
    const pings = db.prepare(`
      SELECT status, response_time, timestamp
      FROM upstream_health_pings
      WHERE proxy_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(proxyId, MAX_PING_HISTORY);
    
    if (pings.length === 0) {
      return;
    }
    
    // Calculate statistics
    const successfulPings = pings.filter(p => p.status === 'up' && p.response_time !== null);
    const failedPings = pings.filter(p => p.status === 'down');
    const lastPing = pings[0];
    const lastSuccess = pings.find(p => p.status === 'up');
    
    const avgResponseTime = successfulPings.length > 0
      ? successfulPings.reduce((sum, p) => sum + p.response_time, 0) / successfulPings.length
      : null;
    
    const maxResponseTime = successfulPings.length > 0
      ? Math.max(...successfulPings.map(p => p.response_time))
      : null;
    
    // Upsert current status
    db.prepare(`
      INSERT INTO upstream_health_current (
        proxy_id, status, last_checked, last_success, 
        avg_response_time, max_response_time, success_count, failure_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(proxy_id) DO UPDATE SET
        status = excluded.status,
        last_checked = excluded.last_checked,
        last_success = excluded.last_success,
        avg_response_time = excluded.avg_response_time,
        max_response_time = excluded.max_response_time,
        success_count = excluded.success_count,
        failure_count = excluded.failure_count,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      proxyId,
      lastPing.status,
      lastPing.timestamp,
      lastSuccess ? lastSuccess.timestamp : null,
      avgResponseTime ? Math.round(avgResponseTime) : null,
      maxResponseTime,
      successfulPings.length,
      failedPings.length
    );
    
  } catch (error) {
    console.error(`Failed to update current status for proxy ${proxyId}:`, error.message);
  }
}

/**
 * Enable health check for a proxy
 */
function enableHealthCheck(proxyId) {
  try {
    // Get proxy details
    const proxy = db.prepare(`
      SELECT ph.*, hc.check_interval, hc.timeout, hc.check_path, hc.expected_status
      FROM proxy_hosts ph
      LEFT JOIN upstream_health_config hc ON ph.id = hc.proxy_id
      WHERE ph.id = ? AND ph.enabled = 1
    `).get(proxyId);
    
    if (!proxy) {
      throw new Error('Proxy not found or not enabled');
    }
    
    // Create or update config
    db.prepare(`
      INSERT INTO upstream_health_config (proxy_id, enabled)
      VALUES (?, 1)
      ON CONFLICT(proxy_id) DO UPDATE SET
        enabled = 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(proxyId);
    
    // Get full config
    const config = db.prepare(`
      SELECT hc.*, ph.forward_scheme, ph.forward_host, ph.forward_port
      FROM upstream_health_config hc
      JOIN proxy_hosts ph ON hc.proxy_id = ph.id
      WHERE hc.proxy_id = ?
    `).get(proxyId);
    
    // Start health check
    startHealthCheck(config);
    
    return { success: true, message: 'Health check enabled' };
  } catch (error) {
    console.error(`Failed to enable health check for proxy ${proxyId}:`, error.message);
    throw error;
  }
}

/**
 * Disable health check for a proxy
 */
function disableHealthCheck(proxyId) {
  try {
    // Update config
    db.prepare(`
      UPDATE upstream_health_config 
      SET enabled = 0, updated_at = CURRENT_TIMESTAMP
      WHERE proxy_id = ?
    `).run(proxyId);
    
    // Stop active check
    stopHealthCheck(proxyId);
    
    return { success: true, message: 'Health check disabled' };
  } catch (error) {
    console.error(`Failed to disable health check for proxy ${proxyId}:`, error.message);
    throw error;
  }
}

/**
 * Update health check configuration
 */
function updateHealthCheckConfig(proxyId, config) {
  try {
    const { enabled, check_interval, timeout, check_path, expected_status } = config;
    
    db.prepare(`
      UPDATE upstream_health_config
      SET enabled = ?,
          check_interval = ?,
          timeout = ?,
          check_path = ?,
          expected_status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE proxy_id = ?
    `).run(enabled, check_interval, timeout, check_path, expected_status, proxyId);
    
    // Restart health check if enabled
    if (enabled) {
      const fullConfig = db.prepare(`
        SELECT hc.*, ph.forward_scheme, ph.forward_host, ph.forward_port
        FROM upstream_health_config hc
        JOIN proxy_hosts ph ON hc.proxy_id = ph.id
        WHERE hc.proxy_id = ?
      `).get(proxyId);
      
      startHealthCheck(fullConfig);
    } else {
      stopHealthCheck(proxyId);
    }
    
    return { success: true, message: 'Health check configuration updated' };
  } catch (error) {
    console.error(`Failed to update health check config for proxy ${proxyId}:`, error.message);
    throw error;
  }
}

/**
 * Get health status for all monitored upstreams
 */
function getAllHealthStatus() {
  try {
    const results = db.prepare(`
      SELECT 
        ph.id,
        ph.name,
        ph.domain_names,
        ph.forward_scheme,
        ph.forward_host,
        ph.forward_port,
        hc.enabled as health_check_enabled,
        hc.check_interval,
        hcs.status,
        hcs.last_checked,
        hcs.last_success,
        hcs.avg_response_time,
        hcs.max_response_time,
        hcs.success_count,
        hcs.failure_count
      FROM proxy_hosts ph
      LEFT JOIN upstream_health_config hc ON ph.id = hc.proxy_id
      LEFT JOIN upstream_health_current hcs ON ph.id = hcs.proxy_id
      WHERE ph.enabled = 1
      ORDER BY ph.name
    `).all();
    
    return results;
  } catch (error) {
    console.error('Failed to get all health status:', error.message);
    throw error;
  }
}

/**
 * Get detailed health status for a specific proxy
 */
function getProxyHealthStatus(proxyId) {
  try {
    const status = db.prepare(`
      SELECT 
        ph.id,
        ph.name,
        ph.domain_names,
        ph.forward_scheme,
        ph.forward_host,
        ph.forward_port,
        hc.enabled as health_check_enabled,
        hc.check_interval,
        hc.timeout,
        hc.check_path,
        hc.expected_status,
        hcs.status,
        hcs.last_checked,
        hcs.last_success,
        hcs.avg_response_time,
        hcs.max_response_time,
        hcs.success_count,
        hcs.failure_count
      FROM proxy_hosts ph
      LEFT JOIN upstream_health_config hc ON ph.id = hc.proxy_id
      LEFT JOIN upstream_health_current hcs ON ph.id = hcs.proxy_id
      WHERE ph.id = ?
    `).get(proxyId);
    
    if (!status) {
      throw new Error('Proxy not found');
    }
    
    // Get recent pings
    const pings = db.prepare(`
      SELECT timestamp, status, response_time, http_status, error_message
      FROM upstream_health_pings
      WHERE proxy_id = ?
      ORDER BY timestamp DESC
      LIMIT 100
    `).all(proxyId);
    
    return { ...status, pings };
  } catch (error) {
    console.error(`Failed to get health status for proxy ${proxyId}:`, error.message);
    throw error;
  }
}

/**
 * Cleanup - stop all health checks
 */
function cleanup() {
  console.log('Stopping all health checks...');
  for (const [proxyId, intervalId] of activeChecks.entries()) {
    clearInterval(intervalId);
  }
  activeChecks.clear();
}

// Handle graceful shutdown
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

module.exports = {
  initializeHealthChecks,
  startHealthCheck,
  stopHealthCheck,
  enableHealthCheck,
  disableHealthCheck,
  updateHealthCheckConfig,
  getAllHealthStatus,
  getProxyHealthStatus,
  performHealthCheck,
  cleanup
};
