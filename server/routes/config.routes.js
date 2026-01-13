/**
 * Config routes
 * Manages advanced configuration editor for custom nginx configs
 */

const { db, logAudit } = require('../db');
const { parseBody, sendJSON, getClientIP } = require('./shared/utils');
const {
  writeNginxConfig,
  deleteNginxConfig,
  forceDeleteNginxConfig,
  enableNginxConfig,
  disableNginxConfig,
  sanitizeFilename,
  extractStructuredFields
} = require('../utils/nginx-parser');
const { testNginxConfig } = require('../utils/nginx-ops');
const { reloadManager } = require('../utils/nginx-reload-manager');
const { validateNginxConfig } = require('../utils/input-validator');

/**
 * Handle config-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleConfigRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname.match(/^\/api\/config\/raw\/\d+$/) && method === 'GET') {
    return handleGetRawConfig(req, res, parsedUrl);
  }

  if (pathname === '/api/config/template' && method === 'POST') {
    return handleGetConfigTemplate(req, res);
  }

  if (pathname === '/api/config/test' && method === 'POST') {
    return handleTestCustomConfig(req, res);
  }

  if (pathname === '/api/config/save' && method === 'POST') {
    return handleSaveCustomConfig(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get raw config
 * Returns the raw nginx configuration for a proxy
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with ID parameter
 */
function handleGetRawConfig(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[4]);

  const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(id);
  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  try {
    let config = proxy.advanced_config;

    // If advanced_config is empty, generate from structured fields (lazy migration)
    if (!config || !config.trim()) {
      const { migrateProxyToTextEditor } = require('../utils/config-migration');

      // Get associated modules for this proxy
      const modules = db.prepare(`
        SELECT m.* FROM modules m
        INNER JOIN proxy_modules pm ON m.id = pm.module_id
        WHERE pm.proxy_id = ?
      `).all(proxy.id);

      config = migrateProxyToTextEditor(proxy, modules, db);
    }

    sendJSON(res, {
      config,
      name: proxy.name,
      type: proxy.type,
      enabled: proxy.enabled === 1,
      launch_url: proxy.launch_url || null
    });
  } catch (error) {
    console.error('Get raw config error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get config template
 * Returns a template configuration for a given proxy type
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleGetConfigTemplate(req, res) {
  const body = await parseBody(req);
  const { type, name, options } = body;

  if (!type) {
    return sendJSON(res, { error: 'Proxy type required' }, 400);
  }

  try {
    const { getTemplateForType } = require('../utils/config-templates');
    const config = getTemplateForType(type, name || 'New Proxy', options || {});

    sendJSON(res, { config });
  } catch (error) {
    console.error('Get config template error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Test custom config
 * Tests a configuration without saving it
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleTestCustomConfig(req, res) {
  const body = await parseBody(req);
  const { config } = body;

  if (!config) {
    return sendJSON(res, { error: 'Config content required' }, 400);
  }

  try {
    // Generate test filename
    const testFilename = `test_${Date.now()}.conf`;

    // Write temporary config file
    writeNginxConfig(testFilename, config);

    // Test nginx configuration
    const testResult = testNginxConfig();

    // Clean up test file (force delete, don't rename)
    try {
      forceDeleteNginxConfig(testFilename);
    } catch (cleanupError) {
      console.error('Test config cleanup error:', cleanupError);
    }

    if (!testResult.success) {
      return sendJSON(res, {
        success: false,
        error: testResult.error,
        message: 'Configuration test failed. Please fix the errors before saving.'
      }, 400);
    }

    sendJSON(res, {
      success: true,
      message: 'Configuration test passed! You can now save this configuration.'
    });
  } catch (error) {
    console.error('Test custom config error:', error);
    sendJSON(res, {
      success: false,
      error: error.message || 'Failed to test configuration'
    }, 500);
  }
}

/**
 * Save custom config
 * Saves or updates a proxy with custom nginx configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleSaveCustomConfig(req, res) {
  const body = await parseBody(req);
  const { proxyId, name, type, enabled, config, launch_url } = body;

  if (!name || !config) {
    return sendJSON(res, { error: 'Name and config content required' }, 400);
  }

  // SECURITY: Validate nginx configuration
  try {
    validateNginxConfig(config);
  } catch (error) {
    return sendJSON(res, { error: `Invalid nginx config: ${error.message}` }, 400);
  }

  let finalProxyId = proxyId ? parseInt(proxyId) : null;
  const isUpdate = !!finalProxyId;

  try {
    // Extract structured fields from config for better display/search
    const extractedFields = extractStructuredFields(config, type || 'reverse');
    
    // Generate filename from name
    const safeFilename = sanitizeFilename(name);
    let configFilename = `${finalProxyId || 'new'}-${safeFilename}.conf`;

    // Update or insert
    if (isUpdate) {
      // Update existing proxy
      const existing = db.prepare('SELECT id FROM proxy_hosts WHERE id = ?').get(finalProxyId);
      if (!existing) {
        return sendJSON(res, { error: 'Proxy not found' }, 404);
      }

      db.prepare(`
        UPDATE proxy_hosts
        SET name = ?, type = ?, enabled = ?, advanced_config = ?, launch_url = ?,
            config_filename = ?, config_status = 'pending', 
            domain_names = ?, forward_scheme = ?, forward_host = ?, forward_port = ?, ssl_enabled = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, type, enabled ? 1 : 0, config, launch_url || null, configFilename,
             extractedFields.domain_names, extractedFields.forward_scheme, 
             extractedFields.forward_host, extractedFields.forward_port, extractedFields.ssl_enabled,
             finalProxyId);
    } else {
      // Insert new proxy
      const result = db.prepare(`
        INSERT INTO proxy_hosts (name, type, enabled, advanced_config, launch_url, config_filename,
                                  config_status, domain_names, forward_scheme, forward_host, forward_port, ssl_enabled)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
      `).run(name, type, enabled ? 1 : 0, config, launch_url || null, configFilename,
             extractedFields.domain_names, extractedFields.forward_scheme,
             extractedFields.forward_host, extractedFields.forward_port, extractedFields.ssl_enabled);
      finalProxyId = result.lastInsertRowid;

      // Update filename with actual ID
      const actualFilename = `${finalProxyId}-${safeFilename}.conf`;
      db.prepare('UPDATE proxy_hosts SET config_filename = ? WHERE id = ?').run(actualFilename, finalProxyId);
      configFilename = actualFilename;
    }

    // Write nginx config
    writeNginxConfig(configFilename, config);

    // Enable or disable based on enabled flag
    if (enabled) {
      enableNginxConfig(configFilename);
    } else {
      disableNginxConfig(configFilename);
    }

    // Test nginx configuration
    const testResult = testNginxConfig();
    if (!testResult.success) {
      throw new Error(`Nginx config test failed: ${testResult.error}`);
    }

    // Reload nginx to apply changes
    const { reloadId } = await reloadManager.queueReload();

    // Update status to active
    db.prepare(`
      UPDATE proxy_hosts
      SET config_status = 'active', config_error = NULL
      WHERE id = ?
    `).run(finalProxyId);

    logAudit(req.user.userId, isUpdate ? 'update' : 'create', 'proxy', finalProxyId, JSON.stringify({ name, type, launch_url }), getClientIP(req));

    // Get updated proxy for response
    const updatedProxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(finalProxyId);

    sendJSON(res, {
      success: true,
      proxyId: finalProxyId,
      proxy: updatedProxy,
      message: isUpdate ? 'Proxy updated successfully' : 'Proxy created successfully'
    }, isUpdate ? 200 : 201);
  } catch (error) {
    console.error('Save config error:', error);

    // Rollback: mark as error if proxy was created
    if (finalProxyId) {
      try {
        db.prepare(`
          UPDATE proxy_hosts
          SET config_status = 'error', config_error = ?, enabled = 0
          WHERE id = ?
        `).run(error.message || 'Configuration failed', finalProxyId);
      } catch (rollbackError) {
        console.error('Rollback error:', rollbackError);
      }
    }

    sendJSON(res, { error: error.message || 'Failed to save configuration' }, 500);
  }
}

module.exports = handleConfigRoutes;
