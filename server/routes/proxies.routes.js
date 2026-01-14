/**
 * Proxies routes
 * Manages proxy host configurations
 */

const { db, logAudit } = require('../db');
const { parseBody, sendJSON, getClientIP } = require('./shared/utils');
const {
  generateServerBlock,
  generateStreamBlock,
  generate404Block,
  writeNginxConfig,
  deleteNginxConfig,
  enableNginxConfig,
  disableNginxConfig,
  sanitizeFilename
} = require('../utils/nginx-parser');
const { testNginxConfig } = require('../utils/nginx-ops');
const { reloadManager } = require('../utils/nginx-reload-manager');
const { validateNginxConfig } = require('../utils/input-validator');

/**
 * Handle proxy-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleProxyRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/proxies' && method === 'GET') {
    return handleGetProxies(req, res);
  }

  if (pathname === '/api/proxies' && method === 'POST') {
    return handleCreateProxy(req, res);
  }

  if (pathname.match(/^\/api\/proxies\/\d+$/) && method === 'GET') {
    return handleGetProxy(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/proxies\/\d+$/) && method === 'PUT') {
    return handleUpdateProxy(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/proxies\/\d+$/) && method === 'DELETE') {
    return handleDeleteProxy(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/proxies\/\d+\/toggle$/) && method === 'POST') {
    return handleToggleProxy(req, res, parsedUrl);
  }

  if (pathname === '/api/proxies/bulk/toggle' && method === 'POST') {
    return handleBulkToggleProxies(req, res);
  }

  if (pathname === '/api/proxies/bulk/delete' && method === 'POST') {
    return handleBulkDeleteProxies(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get all proxies
 * Returns list of all proxy hosts with certificate and WAF profile info
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetProxies(req, res) {
  const proxies = db.prepare(`
    SELECT
      ph.*,
      sc.name as ssl_cert_name,
      wp.id as waf_profile_id,
      wp.name as waf_profile_name,
      wp.paranoia_level as waf_profile_paranoia
    FROM proxy_hosts ph
    LEFT JOIN ssl_certificates sc ON ph.ssl_cert_id = sc.id
    LEFT JOIN waf_profiles wp ON ph.waf_profile_id = wp.id
    ORDER BY ph.name COLLATE NOCASE ASC
  `).all();

  sendJSON(res, proxies);
}

/**
 * Get proxy by ID
 * Returns a single proxy host with full details
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with proxy ID
 */
function handleGetProxy(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/').pop());
  const proxy = db.prepare(`
    SELECT
      ph.*,
      sc.name as ssl_cert_name,
      wp.id as waf_profile_id,
      wp.name as waf_profile_name,
      wp.paranoia_level as waf_profile_paranoia,
      wp.enabled as waf_profile_enabled
    FROM proxy_hosts ph
    LEFT JOIN ssl_certificates sc ON ph.ssl_cert_id = sc.id
    LEFT JOIN waf_profiles wp ON ph.waf_profile_id = wp.id
    WHERE ph.id = ?
  `).get(id);

  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  // Get associated modules
  const modules = db.prepare(`
    SELECT m.id, m.name, m.description
    FROM modules m
    JOIN proxy_modules pm ON m.id = pm.module_id
    WHERE pm.proxy_id = ?
  `).all(id);

  proxy.modules = modules;

  sendJSON(res, proxy);
}

/**
 * Create proxy
 * Creates a new proxy host configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleCreateProxy(req, res) {
  const body = await parseBody(req);
  const { name, type, domain_names, forward_scheme, forward_host, forward_port, ssl_enabled, ssl_cert_id, advanced_config, module_ids, stream_protocol, incoming_port, enabled } = body;

  // Validation based on type
  if (!name) {
    return sendJSON(res, { error: 'Name is required' }, 400);
  }

  // SECURITY: Validate advanced_config if provided
  if (advanced_config) {
    try {
      validateNginxConfig(advanced_config);
    } catch (error) {
      return sendJSON(res, { error: `Invalid advanced config: ${error.message}` }, 400);
    }
  }

  if (type === 'stream') {
    if (!forward_host || !forward_port || !incoming_port) {
      return sendJSON(res, { error: 'Stream hosts require forward_host, forward_port, and incoming_port' }, 400);
    }
  } else if (type === '404') {
    if (!domain_names) {
      return sendJSON(res, { error: '404 hosts require domain_names' }, 400);
    }
  } else {
    // Reverse proxy
    if (!domain_names || !forward_host || !forward_port) {
      return sendJSON(res, { error: 'Reverse proxy requires domain_names, forward_host, and forward_port' }, 400);
    }
  }

  let proxyId = null;
  let configFilename = null;

  try {
    // Generate safe filename from name
    const safeFilename = sanitizeFilename(name);
    configFilename = `${safeFilename}.conf`;

    // Insert proxy with initial status (default to enabled if not specified)
    const isEnabled = enabled !== undefined ? (enabled ? 1 : 0) : 1;

    // Wrap database operations in a transaction for atomicity
    const createProxyTransaction = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO proxy_hosts (name, type, domain_names, forward_scheme, forward_host, forward_port,
                                  ssl_enabled, ssl_cert_id, advanced_config, config_filename, config_status,
                                  stream_protocol, incoming_port, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(name, type || 'reverse', domain_names, forward_scheme || 'http', forward_host, forward_port,
             ssl_enabled ? 1 : 0, ssl_cert_id || null, advanced_config || null, configFilename,
             stream_protocol || null, incoming_port || null, isEnabled);

      proxyId = result.lastInsertRowid;

      // Associate modules
      if (module_ids && Array.isArray(module_ids)) {
        const insertModule = db.prepare('INSERT INTO proxy_modules (proxy_id, module_id) VALUES (?, ?)');
        for (const moduleId of module_ids) {
          insertModule.run(proxyId, moduleId);
        }
      }

      // Auto-enable Force HTTPS module for SSL-enabled proxies
      if (ssl_enabled) {
        const forceHTTPSModule = db.prepare('SELECT id FROM modules WHERE name = ?').get('Force HTTPS');
        if (forceHTTPSModule) {
          db.prepare(`
            INSERT OR IGNORE INTO proxy_modules (proxy_id, module_id)
            VALUES (?, ?)
          `).run(proxyId, forceHTTPSModule.id);
        }
      }

      return proxyId;
    });

    // Execute transaction
    proxyId = createProxyTransaction();

    // Get proxy with modules for config generation
    const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(proxyId);
    const modules = module_ids && module_ids.length > 0
      ? db.prepare(`SELECT * FROM modules WHERE id IN (${module_ids.map(() => '?').join(',')})`).all(...module_ids)
      : [];

    // Generate nginx config
    let config;
    if (type === 'stream') {
      config = generateStreamBlock(proxy);
    } else if (type === '404') {
      config = generate404Block(proxy);
    } else {
      config = generateServerBlock(proxy, modules, db);

      // Replace SSL cert placeholders if needed
      if (ssl_enabled && ssl_cert_id) {
        const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?').get(ssl_cert_id);
        if (cert) {
          config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
          config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
        }
      }
    }

    // Write nginx config and enable/disable based on enabled flag
    writeNginxConfig(configFilename, config);
    if (isEnabled) {
      enableNginxConfig(configFilename);
    } else {
      disableNginxConfig(configFilename);
    }

    // Test nginx configuration
    const testResult = testNginxConfig();
    if (!testResult.success) {
      throw new Error(`Nginx config test failed: ${testResult.error}`);
    }

    // Queue nginx reload to apply changes
    const { reloadId } = await reloadManager.queueReload();

    // Update status to active (keep the enabled state we already set)
    db.prepare(`
      UPDATE proxy_hosts
      SET config_status = 'active', config_error = NULL
      WHERE id = ?
    `).run(proxyId);

    logAudit(req.user.userId, 'create', 'proxy', proxyId, JSON.stringify({ name, type }), getClientIP(req));

    // Send enhanced proxy lifecycle notification
    try {
      const { notifyProxyLifecycle } = require('../utils/notification-service');
      await notifyProxyLifecycle('created', {
        name,
        domain_names: domain_names || 'N/A',
        enabled: !!isEnabled
      }, req.user.username || req.user.userId);
    } catch (notificationError) {
      console.warn('Failed to send proxy creation notification:', notificationError);
    }

    // Get updated proxy for response
    const updatedProxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(proxyId);

    // Broadcast proxy creation event to SSE clients
    broadcastProxyEvent('created', { id: proxyId, name, type: type || 'reverse', enabled: !!isEnabled });

    sendJSON(res, { success: true, id: proxyId, proxy: updatedProxy, reloadId }, 201);
  } catch (error) {
    console.error('Create proxy error:', error);

    // Rollback: mark as error and disabled if proxy was created
    if (proxyId) {
      try {
        db.prepare(`
          UPDATE proxy_hosts
          SET config_status = 'error', config_error = ?, enabled = 0
          WHERE id = ?
        `).run(error.message || 'Configuration failed', proxyId);

        // Try to clean up config file
        if (configFilename) {
          try {
            deleteNginxConfig(configFilename);
          } catch (cleanupError) {
            console.error('Config cleanup error:', cleanupError);
          }
        }
      } catch (rollbackError) {
        console.error('Rollback error:', rollbackError);
      }
    }

    sendJSON(res, { error: error.message || 'Failed to create proxy' }, 500);
  }
}

/**
 * Update proxy
 * Updates an existing proxy host configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with proxy ID
 */
async function handleUpdateProxy(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);
  const body = await parseBody(req);

  const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(id);
  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  const { name, domain_names, forward_scheme, forward_host, forward_port, ssl_enabled, ssl_cert_id, advanced_config, module_ids, stream_protocol, incoming_port } = body;

  // SECURITY: Validate advanced_config if provided
  if (advanced_config !== undefined && advanced_config !== null) {
    try {
      validateNginxConfig(advanced_config);
    } catch (error) {
      return sendJSON(res, { error: `Invalid advanced config: ${error.message}` }, 400);
    }
  }

  try {
    // Wrap database operations in a transaction for atomicity
    const updateProxyTransaction = db.transaction(() => {
      db.prepare(`
        UPDATE proxy_hosts
        SET name = ?, domain_names = ?, forward_scheme = ?, forward_host = ?, forward_port = ?,
            ssl_enabled = ?, ssl_cert_id = ?, advanced_config = ?, stream_protocol = ?, incoming_port = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name || proxy.name, domain_names || proxy.domain_names, forward_scheme || proxy.forward_scheme,
             forward_host || proxy.forward_host, forward_port || proxy.forward_port,
             ssl_enabled !== undefined ? (ssl_enabled ? 1 : 0) : proxy.ssl_enabled,
             ssl_cert_id !== undefined ? ssl_cert_id : proxy.ssl_cert_id,
             advanced_config !== undefined ? advanced_config : proxy.advanced_config,
             stream_protocol !== undefined ? stream_protocol : proxy.stream_protocol,
             incoming_port !== undefined ? incoming_port : proxy.incoming_port,
             id);

      // Update modules
      if (module_ids !== undefined) {
        db.prepare('DELETE FROM proxy_modules WHERE proxy_id = ?').run(id);
        if (Array.isArray(module_ids) && module_ids.length > 0) {
          const insertModule = db.prepare('INSERT INTO proxy_modules (proxy_id, module_id) VALUES (?, ?)');
          for (const moduleId of module_ids) {
            insertModule.run(id, moduleId);
          }
        }
      }

      // Auto-enable Force HTTPS module if SSL is being enabled
      const finalSSLState = ssl_enabled !== undefined ? ssl_enabled : proxy.ssl_enabled;
      if (finalSSLState) {
        const forceHTTPSModule = db.prepare('SELECT id FROM modules WHERE name = ?').get('Force HTTPS');
        if (forceHTTPSModule) {
          db.prepare(`
            INSERT OR IGNORE INTO proxy_modules (proxy_id, module_id)
            VALUES (?, ?)
          `).run(id, forceHTTPSModule.id);
        }
      }
    });

    // Execute transaction
    updateProxyTransaction();

    // Regenerate config using centralized utility
    // This ensures SSL certificates, WAF profiles, and security features are always up-to-date
    const { regenerateProxyConfig } = require('../utils/proxy-config-regenerator');
    const regenResult = await regenerateProxyConfig(id);

    if (!regenResult.success) {
      throw new Error(regenResult.error || 'Configuration regeneration failed');
    }

    const reloadId = regenResult.reloadId;
    const updatedProxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(id);

    logAudit(req.user.userId, 'update', 'proxy', id, JSON.stringify({ name: name || proxy.name }), getClientIP(req));

    // Broadcast proxy update event to SSE clients
    broadcastProxyEvent('updated', { id, name: name || proxy.name });

    sendJSON(res, { success: true, proxy: updatedProxy, reloadId });
  } catch (error) {
    console.error('Update proxy error:', error);

    // Mark as error (only if not already handled by regenerateProxyConfig)
    const currentProxy = db.prepare('SELECT config_status FROM proxy_hosts WHERE id = ?').get(id);
    if (currentProxy && currentProxy.config_status !== 'error') {
      db.prepare(`
        UPDATE proxy_hosts
        SET config_status = 'error', config_error = ?
        WHERE id = ?
      `).run(error.message || 'Update failed', id);
    }

    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Delete proxy
 * Removes a proxy host configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with proxy ID
 */
async function handleDeleteProxy(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);

  const proxy = db.prepare('SELECT name, config_filename, domain_names FROM proxy_hosts WHERE id = ?').get(id);
  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  try {
    // Use stored filename or generate for legacy records
    const filename = proxy.config_filename || `${sanitizeFilename(proxy.name)}.conf`;
    deleteNginxConfig(filename);

    db.prepare('DELETE FROM proxy_hosts WHERE id = ?').run(id);

    // Queue nginx reload to apply deletion
    const { reloadId } = await reloadManager.queueReload();

    logAudit(req.user.userId, 'delete', 'proxy', id, JSON.stringify({ name: proxy.name }), getClientIP(req));

    // Send enhanced proxy lifecycle notification
    try {
      const { notifyProxyLifecycle } = require('../utils/notification-service');
      await notifyProxyLifecycle('deleted', {
        name: proxy.name,
        domain_names: proxy.domain_names || 'N/A',
        enabled: false
      }, req.user.username || req.user.userId);
    } catch (notificationError) {
      console.warn('Failed to send proxy deletion notification:', notificationError);
    }

    // Broadcast proxy deletion event to SSE clients
    broadcastProxyEvent('deleted', { id, name: proxy.name });

    sendJSON(res, { success: true, reloadId });
  } catch (error) {
    console.error('Delete proxy error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Toggle proxy enabled/disabled state
 * Enables or disables a proxy host
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with proxy ID
 */
async function handleToggleProxy(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);

  const proxy = db.prepare('SELECT name, enabled, config_filename FROM proxy_hosts WHERE id = ?').get(id);
  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  try {
    const newEnabled = proxy.enabled ? 0 : 1;
    db.prepare('UPDATE proxy_hosts SET enabled = ? WHERE id = ?').run(newEnabled, id);

    // Use stored filename or generate for legacy records
    const filename = proxy.config_filename || `${sanitizeFilename(proxy.name)}.conf`;
    if (newEnabled) {
      enableNginxConfig(filename);
    } else {
      disableNginxConfig(filename);
    }

    // Queue nginx reload to apply change
    const { reloadId } = await reloadManager.queueReload();

    logAudit(req.user.userId, newEnabled ? 'enable' : 'disable', 'proxy', id, JSON.stringify({ name: proxy.name }), getClientIP(req));

    // Broadcast proxy toggle event to SSE clients
    broadcastProxyEvent('toggled', { id, name: proxy.name, enabled: !!newEnabled });

    sendJSON(res, { success: true, enabled: newEnabled, reloadId });
  } catch (error) {
    console.error('Toggle proxy error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Broadcast proxy change event to all connected SSE clients
 *
 * @param {string} eventType - Type of proxy event (created, updated, deleted, toggled, bulk_toggled, bulk_deleted)
 * @param {Object} data - Event data
 */
function broadcastProxyEvent(eventType, data) {
  try {
    const { sseManager } = require('./shared/sse');
    sseManager.broadcast('proxy_event', { eventType, data, timestamp: new Date().toISOString() });
  } catch (error) {
    console.warn('Failed to broadcast proxy event:', error);
  }
}

/**
 * Bulk toggle proxies enabled/disabled state
 * Enables or disables multiple proxy hosts at once
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleBulkToggleProxies(req, res) {
  const body = await parseBody(req);
  const { ids, enabled } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return sendJSON(res, { error: 'ids array is required and must not be empty' }, 400);
  }

  if (typeof enabled !== 'boolean') {
    return sendJSON(res, { error: 'enabled must be a boolean value' }, 400);
  }

  const results = {
    success: [],
    failed: []
  };

  try {
    // Process each proxy
    for (const id of ids) {
      try {
        const proxy = db.prepare('SELECT name, enabled, config_filename FROM proxy_hosts WHERE id = ?').get(id);
        if (!proxy) {
          results.failed.push({ id, error: 'Proxy not found' });
          continue;
        }

        // Update enabled state
        db.prepare('UPDATE proxy_hosts SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);

        // Use stored filename or generate for legacy records
        const filename = proxy.config_filename || `${sanitizeFilename(proxy.name)}.conf`;
        if (enabled) {
          enableNginxConfig(filename);
        } else {
          disableNginxConfig(filename);
        }

        logAudit(req.user.userId, enabled ? 'enable' : 'disable', 'proxy', id, JSON.stringify({ name: proxy.name, bulk: true }), getClientIP(req));

        results.success.push({ id, name: proxy.name, enabled });
      } catch (error) {
        console.error(`Bulk toggle error for proxy ${id}:`, error);
        results.failed.push({ id, error: error.message });
      }
    }

    // Queue single nginx reload for all changes
    const { reloadId } = await reloadManager.queueReload();

    // Broadcast proxy event to SSE clients
    broadcastProxyEvent('bulk_toggled', {
      count: results.success.length,
      enabled,
      failedCount: results.failed.length
    });

    sendJSON(res, {
      success: true,
      results,
      reloadId,
      summary: {
        total: ids.length,
        succeeded: results.success.length,
        failed: results.failed.length
      }
    });
  } catch (error) {
    console.error('Bulk toggle error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Bulk delete proxies
 * Deletes multiple proxy hosts at once
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleBulkDeleteProxies(req, res) {
  const body = await parseBody(req);
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return sendJSON(res, { error: 'ids array is required and must not be empty' }, 400);
  }

  const results = {
    success: [],
    failed: []
  };

  try {
    // Process each proxy
    for (const id of ids) {
      try {
        const proxy = db.prepare('SELECT name, config_filename, domain_names FROM proxy_hosts WHERE id = ?').get(id);
        if (!proxy) {
          results.failed.push({ id, error: 'Proxy not found' });
          continue;
        }

        // Use stored filename or generate for legacy records
        const filename = proxy.config_filename || `${sanitizeFilename(proxy.name)}.conf`;
        deleteNginxConfig(filename);

        db.prepare('DELETE FROM proxy_hosts WHERE id = ?').run(id);

        logAudit(req.user.userId, 'delete', 'proxy', id, JSON.stringify({ name: proxy.name, bulk: true }), getClientIP(req));

        results.success.push({ id, name: proxy.name });

        // Send notification for each deleted proxy
        try {
          const { notifyProxyLifecycle } = require('../utils/notification-service');
          await notifyProxyLifecycle('deleted', {
            name: proxy.name,
            domain_names: proxy.domain_names || 'N/A',
            enabled: false
          }, req.user.username || req.user.userId);
        } catch (notificationError) {
          console.warn(`Failed to send proxy deletion notification for ${proxy.name}:`, notificationError);
        }
      } catch (error) {
        console.error(`Bulk delete error for proxy ${id}:`, error);
        results.failed.push({ id, error: error.message });
      }
    }

    // Queue single nginx reload for all changes
    const { reloadId } = await reloadManager.queueReload();

    // Broadcast proxy event to SSE clients
    broadcastProxyEvent('bulk_deleted', {
      count: results.success.length,
      failedCount: results.failed.length
    });

    sendJSON(res, {
      success: true,
      results,
      reloadId,
      summary: {
        total: ids.length,
        succeeded: results.success.length,
        failed: results.failed.length
      }
    });
  } catch (error) {
    console.error('Bulk delete error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

module.exports = handleProxyRoutes;
