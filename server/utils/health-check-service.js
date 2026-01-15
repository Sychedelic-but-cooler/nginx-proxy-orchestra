/**
 * Upstream Health Check Service
 * 
 * Monitors upstream servers by performing periodic health checks.
 * Tracks response times, success/failure rates, and maintains ping history.
 * Uses node-cron to schedule checks every 5 minutes for all enabled sites.
 * 
 * Uses TCP connection checks to avoid issues with SSL certificates,
 * HTTP redirects, and other application-level concerns.
 */

const net = require('net');
const cron = require('node-cron');
const { db } = require('../db');

// Cron job instance
let cronJob = null;

// Maximum number of pings to store per upstream
const MAX_PING_HISTORY = 100;

/**
 * Initialize health check service
 * Starts cron job to check all enabled upstreams every 5 minutes
 */
function initializeHealthChecks() {
  console.log('Initializing upstream health check service...');
  
  try {
    // Stop existing cron job if any
    if (cronJob) {
      cronJob.stop();
      cronJob = null;
    }
    
    // Run initial check immediately
    performAllHealthChecks();
    
    // Schedule health checks every 5 minutes using cron
    // Cron expression: */5 * * * * = every 5 minutes
    cronJob = cron.schedule('*/5 * * * *', () => {
      console.log('Running scheduled health checks...');
      performAllHealthChecks();
    });
    
    console.log('  Health check service started (checks every 5 minutes)');
    
  } catch (error) {
    console.error('Failed to initialize health checks:', error.message);
  }
}

/**
 * Perform health checks for all enabled upstreams
 */
async function performAllHealthChecks() {
  try {
    // Get all enabled health check configs
    const configs = db.prepare(`
      SELECT hc.*, ph.forward_scheme, ph.forward_host, ph.forward_port, ph.enabled as proxy_enabled
      FROM upstream_health_config hc
      JOIN proxy_hosts ph ON hc.proxy_id = ph.id
      WHERE hc.enabled = 1 AND ph.enabled = 1
    `).all();
    
    if (configs.length === 0) {
      return;
    }
    
    console.log(`  Checking ${configs.length} upstreams...`);
    
    // Perform all checks in parallel
    const checks = configs.map(config => performHealthCheck(config));
    await Promise.allSettled(checks);
    
  } catch (error) {
    console.error('Error performing health checks:', error.message);
  }
}

/**
 * Perform a single health check
 */
async function performHealthCheck(config) {
  const startTime = Date.now();
  let status = 'down';
  let responseTime = null;
  let errorMessage = null;
  
  try {
    const result = await checkUpstreamTCP(
      config.forward_host,
      config.forward_port,
      config.timeout
    );
    
    status = result.success ? 'up' : 'down';
    responseTime = result.responseTime;
    errorMessage = result.error;
    
  } catch (error) {
    status = 'down';
    errorMessage = error.message;
  }
  
  // Record ping (http_status is null for TCP checks)
  recordPing(config.proxy_id, status, responseTime, null, errorMessage);
  
  // Update current health status
  updateCurrentStatus(config.proxy_id);
}

/**
 * Check upstream server availability using TCP connection
 */
function checkUpstreamTCP(host, port, timeout) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    
    // Set timeout
    socket.setTimeout(timeout);
    
    // Attempt to connect
    socket.connect(port, host, () => {
      const responseTime = Date.now() - startTime;
      socket.destroy();
      
      resolve({
        success: true,
        responseTime,
        error: null
      });
    });
    
    // Handle timeout
    socket.on('timeout', () => {
      const responseTime = Date.now() - startTime;
      socket.destroy();
      
      resolve({
        success: false,
        responseTime,
        error: 'Connection timeout'
      });
    });
    
    // Handle connection errors
    socket.on('error', (error) => {
      const responseTime = Date.now() - startTime;
      socket.destroy();
      
      resolve({
        success: false,
        responseTime,
        error: error.message
      });
    });
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
    
    // Perform an immediate check for this proxy
    const config = db.prepare(`
      SELECT hc.*, ph.forward_scheme, ph.forward_host, ph.forward_port
      FROM upstream_health_config hc
      JOIN proxy_hosts ph ON hc.proxy_id = ph.id
      WHERE hc.proxy_id = ?
    `).get(proxyId);
    
    if (config) {
      performHealthCheck(config).catch(err => {
        console.error(`Initial health check failed for proxy ${proxyId}:`, err.message);
      });
    }
    
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
    
    // Perform immediate check if enabled
    if (enabled) {
      const fullConfig = db.prepare(`
        SELECT hc.*, ph.forward_scheme, ph.forward_host, ph.forward_port
        FROM upstream_health_config hc
        JOIN proxy_hosts ph ON hc.proxy_id = ph.id
        WHERE hc.proxy_id = ?
      `).get(proxyId);
      
      if (fullConfig) {
        performHealthCheck(fullConfig).catch(err => {
          console.error(`Health check failed for proxy ${proxyId}:`, err.message);
        });
      }
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
 * Cleanup - stop cron job
 */
function cleanup() {
  console.log('Stopping health check service...');
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}

// Handle graceful shutdown
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

module.exports = {
  initializeHealthChecks,
  enableHealthCheck,
  disableHealthCheck,
  updateHealthCheckConfig,
  getAllHealthStatus,
  getProxyHealthStatus,
  performHealthCheck,
  performAllHealthChecks,
  cleanup
};
