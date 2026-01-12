/**
 * Settings routes
 * Manages application settings and audit log
 */

const { db, logAudit, getSetting, setSetting, getAllSettings } = require('../db');
const { parseBody, sendJSON, getClientIP } = require('./shared/utils');
const { reloadManager } = require('../utils/nginx-reload-manager');

/**
 * Handle settings-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleSettingsRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/settings' && method === 'GET') {
    return handleGetSettings(req, res);
  }

  if (pathname === '/api/settings' && method === 'PUT') {
    return handleUpdateSettings(req, res);
  }

  if (pathname === '/api/audit-log' && method === 'GET') {
    return handleGetAuditLog(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get settings
 * Returns all application settings
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetSettings(req, res) {
  const settings = {};
  const allSettings = getAllSettings();

  // Convert array of {key, value} to object
  for (const setting of allSettings) {
    settings[setting.key] = setting.value;
  }

  sendJSON(res, settings);
}

/**
 * Update settings
 * Updates application settings
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleUpdateSettings(req, res) {
  const body = await parseBody(req);
  const { default_server_behavior, default_server_custom_url, admin_cert_id } = body;

  try {
    // Validate behavior option
    const validBehaviors = ['drop', '404', 'custom'];
    if (default_server_behavior && !validBehaviors.includes(default_server_behavior)) {
      return sendJSON(res, { error: 'Invalid default server behavior' }, 400);
    }

    let adminCertChanged = false;

    // Update settings
    if (default_server_behavior) {
      setSetting('default_server_behavior', default_server_behavior);
    }

    if (default_server_custom_url !== undefined) {
      setSetting('default_server_custom_url', default_server_custom_url);
    }

    // Handle admin certificate update
    if (admin_cert_id !== undefined) {
      // Validate certificate exists if provided
      if (admin_cert_id) {
        const cert = db.prepare('SELECT id FROM ssl_certificates WHERE id = ?').get(parseInt(admin_cert_id));
        if (!cert) {
          return sendJSON(res, { error: 'Invalid certificate ID' }, 400);
        }
      }
      setSetting('admin_cert_id', admin_cert_id || '');
      adminCertChanged = true;
    }

    // Regenerate default server configuration (only for nginx settings)
    if (default_server_behavior || default_server_custom_url !== undefined) {
      const { initializeDefaultServer } = require('../utils/default-server');
      initializeDefaultServer();

      // Reload nginx to apply changes
      await reloadManager.queueReload();
    }

    logAudit(req.user.userId, 'update_settings', 'settings', null, JSON.stringify(body), getClientIP(req));

    // Different message if admin cert was changed
    if (adminCertChanged) {
      sendJSON(res, {
        success: true,
        message: 'Settings updated successfully',
        requiresRestart: true,
        restartMessage: 'Admin interface certificate changed. Please restart the server for changes to take effect.'
      });
    } else {
      sendJSON(res, { success: true, message: 'Settings updated successfully' });
    }
  } catch (error) {
    console.error('Update settings error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get audit log
 * Returns recent audit log entries
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetAuditLog(req, res) {
  const logs = db.prepare(`
    SELECT
      al.*,
      u.username
    FROM audit_log al
    LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.created_at DESC
    LIMIT 100
  `).all();

  sendJSON(res, logs);
}

module.exports = handleSettingsRoutes;
