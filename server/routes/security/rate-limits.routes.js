/**
 * Rate limits routes
 * Manages rate limiting rules for proxy hosts
 */

const { db, logAudit } = require('../../db');
const { parseBody, sendJSON, getClientIP } = require('../shared/utils');
const { updateGlobalSecurityConfig } = require('../../utils/security-config-generator');
const {
  generateServerBlock,
  writeNginxConfig,
  enableNginxConfig,
  disableNginxConfig
} = require('../../utils/nginx-parser');
const { reloadManager } = require('../../utils/nginx-reload-manager');

/**
 * Handle rate limit routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleRateLimitRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/security/rate-limits' && method === 'GET') {
    return handleGetRateLimits(req, res, parsedUrl);
  }

  if (pathname === '/api/security/rate-limits' && method === 'POST') {
    return handleCreateRateLimit(req, res);
  }

  if (pathname.match(/^\/api\/security\/rate-limits\/\d+$/) && method === 'PUT') {
    return handleUpdateRateLimit(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/security\/rate-limits\/\d+$/) && method === 'DELETE') {
    return handleDeleteRateLimit(req, res, parsedUrl);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get rate limits
 * Returns list of rate limits with optional proxy filtering
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 */
function handleGetRateLimits(req, res, parsedUrl) {
  try {
    const params = new URLSearchParams(parsedUrl.search);
    const proxyId = params.get('proxy_id');

    let query = 'SELECT * FROM rate_limits';
    let queryParams = [];

    if (proxyId) {
      query += ' WHERE proxy_id = ?';
      queryParams.push(parseInt(proxyId));
    }

    query += ' ORDER BY created_at DESC';

    const rateLimits = db.prepare(query).all(...queryParams);
    sendJSON(res, { rateLimits });
  } catch (error) {
    console.error('Get rate limits error:', error);
    sendJSON(res, { error: error.message || 'Failed to get rate limits' }, 500);
  }
}

/**
 * Create rate limit
 * Creates a new rate limit for a proxy host and updates configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleCreateRateLimit(req, res) {
  try {
    const body = await parseBody(req);
    const { proxy_id, rate, burst, nodelay, enabled } = body;

    if (!proxy_id || !rate) {
      return sendJSON(res, { error: 'proxy_id and rate are required' }, 400);
    }

    // Check if proxy exists
    const proxy = db.prepare('SELECT id, name FROM proxy_hosts WHERE id = ?').get(proxy_id);
    if (!proxy) {
      return sendJSON(res, { error: 'Proxy not found' }, 404);
    }

    // Generate zone name
    const zoneName = `proxy_${proxy_id}_ratelimit`;

    const result = db.prepare(`
      INSERT INTO rate_limits (proxy_id, zone_name, rate, burst, nodelay, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      proxy_id,
      zoneName,
      rate,
      burst !== undefined ? burst : 50,
      nodelay !== undefined ? nodelay : 0,
      enabled !== undefined ? enabled : 1
    );

    // Update global security config
    updateGlobalSecurityConfig(db);

    // Regenerate the proxy config
    const updatedProxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(proxy_id);
    const modules = db.prepare(`
      SELECT m.* FROM modules m
      JOIN proxy_modules pm ON m.id = pm.module_id
      WHERE pm.proxy_id = ?
    `).all(proxy_id);

    let config = generateServerBlock(updatedProxy, modules, db);

    // Replace SSL placeholders if needed
    if (updatedProxy.ssl_enabled && updatedProxy.ssl_cert_id) {
      const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?')
        .get(updatedProxy.ssl_cert_id);
      if (cert) {
        config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
        config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
      }
    }

    const filename = updatedProxy.config_filename || `${updatedProxy.id}.conf`;
    writeNginxConfig(filename, config);

    // Ensure correct file extension based on enabled state
    if (updatedProxy.enabled) {
      enableNginxConfig(filename);
    } else {
      disableNginxConfig(filename);
    }

    // Log audit
    logAudit(
      req.user.userId,
      'create',
      'rate_limit',
      result.lastInsertRowid,
      `Created rate limit for proxy ${proxy.name}: ${rate}`,
      getClientIP(req)
    );

    // Trigger nginx reload
    await reloadManager.queueReload();

    sendJSON(res, {
      success: true,
      id: result.lastInsertRowid,
      message: 'Rate limit created successfully'
    });
  } catch (error) {
    console.error('Create rate limit error:', error);
    sendJSON(res, { error: error.message || 'Failed to create rate limit' }, 500);
  }
}

/**
 * Update rate limit
 * Updates an existing rate limit and regenerates proxy configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with rate limit ID
 */
async function handleUpdateRateLimit(req, res, parsedUrl) {
  try {
    const id = parseInt(parsedUrl.pathname.split('/')[4]);
    const body = await parseBody(req);
    const { rate, burst, nodelay, enabled } = body;

    const rateLimit = db.prepare('SELECT * FROM rate_limits WHERE id = ?').get(id);
    if (!rateLimit) {
      return sendJSON(res, { error: 'Rate limit not found' }, 404);
    }

    db.prepare(`
      UPDATE rate_limits
      SET rate = ?, burst = ?, nodelay = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      rate || rateLimit.rate,
      burst !== undefined ? burst : rateLimit.burst,
      nodelay !== undefined ? nodelay : rateLimit.nodelay,
      enabled !== undefined ? enabled : rateLimit.enabled,
      id
    );

    // Update global security config
    updateGlobalSecurityConfig(db);

    // Regenerate the proxy config
    const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(rateLimit.proxy_id);
    const modules = db.prepare(`
      SELECT m.* FROM modules m
      JOIN proxy_modules pm ON m.id = pm.module_id
      WHERE pm.proxy_id = ?
    `).all(rateLimit.proxy_id);

    let config = generateServerBlock(proxy, modules, db);

    // Replace SSL placeholders if needed
    if (proxy.ssl_enabled && proxy.ssl_cert_id) {
      const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?')
        .get(proxy.ssl_cert_id);
      if (cert) {
        config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
        config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
      }
    }

    const filename = proxy.config_filename || `${proxy.id}.conf`;
    writeNginxConfig(filename, config);

    // Ensure correct file extension based on enabled state
    if (proxy.enabled) {
      enableNginxConfig(filename);
    } else {
      disableNginxConfig(filename);
    }

    // Log audit
    logAudit(
      req.user.userId,
      'update',
      'rate_limit',
      id,
      `Updated rate limit: ${rate || rateLimit.rate}`,
      getClientIP(req)
    );

    // Trigger nginx reload
    await reloadManager.queueReload();

    sendJSON(res, { success: true, message: 'Rate limit updated successfully' });
  } catch (error) {
    console.error('Update rate limit error:', error);
    sendJSON(res, { error: error.message || 'Failed to update rate limit' }, 500);
  }
}

/**
 * Delete rate limit
 * Removes a rate limit and updates proxy configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with rate limit ID
 */
async function handleDeleteRateLimit(req, res, parsedUrl) {
  try {
    const id = parseInt(parsedUrl.pathname.split('/')[4]);

    const rateLimit = db.prepare('SELECT * FROM rate_limits WHERE id = ?').get(id);
    if (!rateLimit) {
      return sendJSON(res, { error: 'Rate limit not found' }, 404);
    }

    db.prepare('DELETE FROM rate_limits WHERE id = ?').run(id);

    // Update global security config
    updateGlobalSecurityConfig(db);

    // Regenerate the proxy config
    const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(rateLimit.proxy_id);
    if (proxy) {
      const modules = db.prepare(`
        SELECT m.* FROM modules m
        JOIN proxy_modules pm ON m.id = pm.module_id
        WHERE pm.proxy_id = ?
      `).all(rateLimit.proxy_id);

      let config = generateServerBlock(proxy, modules, db);

      // Replace SSL placeholders if needed
      if (proxy.ssl_enabled && proxy.ssl_cert_id) {
        const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?')
          .get(proxy.ssl_cert_id);
        if (cert) {
          config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
          config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
        }
      }

      const filename = proxy.config_filename || `${proxy.id}.conf`;
      writeNginxConfig(filename, config);

      // Ensure correct file extension based on enabled state
      if (proxy.enabled) {
        enableNginxConfig(filename);
      } else {
        disableNginxConfig(filename);
      }
    }

    // Log audit
    logAudit(
      req.user.userId,
      'delete',
      'rate_limit',
      id,
      `Deleted rate limit for proxy ${rateLimit.proxy_id}`,
      getClientIP(req)
    );

    // Trigger nginx reload
    await reloadManager.queueReload();

    sendJSON(res, { success: true, message: 'Rate limit deleted successfully' });
  } catch (error) {
    console.error('Delete rate limit error:', error);
    sendJSON(res, { error: error.message || 'Failed to delete rate limit' }, 500);
  }
}

module.exports = handleRateLimitRoutes;
