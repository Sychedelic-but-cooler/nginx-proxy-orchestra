/**
 * Health Check API Routes
 * 
 * Provides endpoints for managing and viewing upstream health checks
 */

const { sendJSON } = require('./shared/utils');
const healthCheckService = require('../utils/health-check-service');

/**
 * Handle health check routes
 * 
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
function handleHealthCheckRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // GET /api/health - Get all health statuses
  if (pathname === '/api/health' && method === 'GET') {
    return handleGetAllHealthStatus(req, res);
  }

  // GET /api/health/:proxyId - Get specific proxy health status
  if (pathname.startsWith('/api/health/') && method === 'GET') {
    const proxyId = parseInt(pathname.split('/')[3], 10);
    return handleGetProxyHealthStatus(req, res, proxyId);
  }

  // POST /api/health/:proxyId/enable - Enable health check for proxy
  if (pathname.match(/^\/api\/health\/\d+\/enable$/) && method === 'POST') {
    const proxyId = parseInt(pathname.split('/')[3], 10);
    return handleEnableHealthCheck(req, res, proxyId);
  }

  // POST /api/health/:proxyId/disable - Disable health check for proxy
  if (pathname.match(/^\/api\/health\/\d+\/disable$/) && method === 'POST') {
    const proxyId = parseInt(pathname.split('/')[3], 10);
    return handleDisableHealthCheck(req, res, proxyId);
  }

  // PUT /api/health/:proxyId/config - Update health check configuration
  if (pathname.match(/^\/api\/health\/\d+\/config$/) && method === 'PUT') {
    const proxyId = parseInt(pathname.split('/')[3], 10);
    return handleUpdateHealthCheckConfig(req, res, proxyId);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get all health statuses
 */
function handleGetAllHealthStatus(req, res) {
  try {
    const statuses = healthCheckService.getAllHealthStatus();
    sendJSON(res, { statuses });
  } catch (error) {
    console.error('Error getting all health status:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get specific proxy health status with detailed ping history
 */
function handleGetProxyHealthStatus(req, res, proxyId) {
  try {
    const status = healthCheckService.getProxyHealthStatus(proxyId);
    sendJSON(res, status);
  } catch (error) {
    console.error(`Error getting health status for proxy ${proxyId}:`, error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Enable health check for a proxy
 */
function handleEnableHealthCheck(req, res, proxyId) {
  try {
    const result = healthCheckService.enableHealthCheck(proxyId);
    sendJSON(res, result);
  } catch (error) {
    console.error(`Error enabling health check for proxy ${proxyId}:`, error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Disable health check for a proxy
 */
function handleDisableHealthCheck(req, res, proxyId) {
  try {
    const result = healthCheckService.disableHealthCheck(proxyId);
    sendJSON(res, result);
  } catch (error) {
    console.error(`Error disabling health check for proxy ${proxyId}:`, error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Update health check configuration
 */
function handleUpdateHealthCheckConfig(req, res, proxyId) {
  let body = '';

  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    try {
      const config = JSON.parse(body);
      
      // Validate config
      if (config.check_interval !== undefined && (config.check_interval < 10 || config.check_interval > 3600)) {
        return sendJSON(res, { error: 'Check interval must be between 10 and 3600 seconds' }, 400);
      }
      
      if (config.timeout !== undefined && (config.timeout < 1000 || config.timeout > 30000)) {
        return sendJSON(res, { error: 'Timeout must be between 1000 and 30000 milliseconds' }, 400);
      }
      
      if (config.expected_status !== undefined && (config.expected_status < 100 || config.expected_status > 599)) {
        return sendJSON(res, { error: 'Expected status must be a valid HTTP status code' }, 400);
      }
      
      const result = healthCheckService.updateHealthCheckConfig(proxyId, config);
      sendJSON(res, result);
    } catch (error) {
      console.error(`Error updating health check config for proxy ${proxyId}:`, error);
      sendJSON(res, { error: error.message }, 400);
    }
  });
}

module.exports = handleHealthCheckRoutes;
