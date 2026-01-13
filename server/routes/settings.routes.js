/**
 * Settings routes
 * Manages application settings and audit log
 */

const { db, logAudit, getSetting, setSetting, getAllSettings } = require('../db');
const { parseBody, sendJSON, getClientIP } = require('./shared/utils');
const { reloadManager } = require('../utils/nginx-reload-manager');
const { getMigrationStatus } = require('../migrate');

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
    return handleGetAuditLog(req, res, parsedUrl);
  }

  if (pathname === '/api/audit-log/export' && method === 'GET') {
    return handleExportAuditLog(req, res, parsedUrl);
  }

  if (pathname === '/api/audit-log/stats' && method === 'GET') {
    return handleGetAuditStats(req, res, parsedUrl);
  }

  if (pathname === '/api/migrations' && method === 'GET') {
    return handleGetMigrations(req, res);
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
 * Returns audit log entries with pagination and filtering
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
function handleGetAuditLog(req, res, parsedUrl) {
  const params = parsedUrl.searchParams;
  
  // Pagination parameters
  const limit = parseInt(params.get('limit')) || 100;
  const offset = parseInt(params.get('offset')) || 0;
  
  // Filter parameters
  const userId = params.get('user_id');
  const username = params.get('username');
  const action = params.get('action');
  const resourceType = params.get('resource_type');
  const ipAddress = params.get('ip_address');
  const startDate = params.get('start_date');
  const endDate = params.get('end_date');
  const search = params.get('search');
  const success = params.get('success'); // 'true', 'false', or null

  // Build WHERE clauses
  const whereClauses = [];
  const params_array = [];

  if (userId) {
    whereClauses.push('al.user_id = ?');
    params_array.push(parseInt(userId));
  }

  if (username) {
    whereClauses.push('u.username = ?');
    params_array.push(username);
  }

  if (action) {
    whereClauses.push('al.action = ?');
    params_array.push(action);
  }

  if (resourceType) {
    whereClauses.push('al.resource_type = ?');
    params_array.push(resourceType);
  }

  if (ipAddress) {
    whereClauses.push('al.ip_address = ?');
    params_array.push(ipAddress);
  }

  if (startDate) {
    whereClauses.push('al.created_at >= ?');
    params_array.push(startDate);
  }

  if (endDate) {
    whereClauses.push('al.created_at <= ?');
    params_array.push(endDate);
  }

  if (search) {
    whereClauses.push('(al.details LIKE ? OR u.username LIKE ?)');
    params_array.push(`%${search}%`, `%${search}%`);
  }

  if (success !== null && success !== undefined && success !== '') {
    whereClauses.push('al.success = ?');
    params_array.push(success === 'true' ? 1 : 0);
  }

  const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  // Get total count for pagination
  const countQuery = `
    SELECT COUNT(*) as total
    FROM audit_log al
    LEFT JOIN users u ON al.user_id = u.id
    ${whereClause}
  `;
  const totalResult = db.prepare(countQuery).get(...params_array);
  const total = totalResult.total;

  // Get paginated results
  const logsQuery = `
    SELECT
      al.*,
      u.username
    FROM audit_log al
    LEFT JOIN users u ON al.user_id = u.id
    ${whereClause}
    ORDER BY al.created_at DESC
    LIMIT ? OFFSET ?
  `;
  const logs = db.prepare(logsQuery).all(...params_array, limit, offset);

  sendJSON(res, {
    logs,
    total,
    limit,
    offset
  });
}

/**
 * Export audit log to CSV
 * Returns CSV file with filtered audit log entries
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
function handleExportAuditLog(req, res, parsedUrl) {
  const params = parsedUrl.searchParams;
  
  // Max export limit for performance
  const maxLimit = 10000;
  
  // Filter parameters (same as handleGetAuditLog)
  const userId = params.get('user_id');
  const username = params.get('username');
  const action = params.get('action');
  const resourceType = params.get('resource_type');
  const ipAddress = params.get('ip_address');
  const startDate = params.get('start_date');
  const endDate = params.get('end_date');
  const search = params.get('search');
  const success = params.get('success');

  // Build WHERE clauses
  const whereClauses = [];
  const params_array = [];

  if (userId) {
    whereClauses.push('al.user_id = ?');
    params_array.push(parseInt(userId));
  }

  if (username) {
    whereClauses.push('u.username = ?');
    params_array.push(username);
  }

  if (action) {
    whereClauses.push('al.action = ?');
    params_array.push(action);
  }

  if (resourceType) {
    whereClauses.push('al.resource_type = ?');
    params_array.push(resourceType);
  }

  if (ipAddress) {
    whereClauses.push('al.ip_address = ?');
    params_array.push(ipAddress);
  }

  if (startDate) {
    whereClauses.push('al.created_at >= ?');
    params_array.push(startDate);
  }

  if (endDate) {
    whereClauses.push('al.created_at <= ?');
    params_array.push(endDate);
  }

  if (search) {
    whereClauses.push('(al.details LIKE ? OR u.username LIKE ?)');
    params_array.push(`%${search}%`, `%${search}%`);
  }

  if (success !== null && success !== undefined && success !== '') {
    whereClauses.push('al.success = ?');
    params_array.push(success === 'true' ? 1 : 0);
  }

  const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  // Get logs for export
  const logsQuery = `
    SELECT
      al.id,
      al.created_at,
      u.username,
      al.action,
      al.resource_type,
      al.resource_id,
      al.details,
      al.ip_address,
      al.user_agent,
      al.success,
      al.error_message
    FROM audit_log al
    LEFT JOIN users u ON al.user_id = u.id
    ${whereClause}
    ORDER BY al.created_at DESC
    LIMIT ?
  `;
  const logs = db.prepare(logsQuery).all(...params_array, maxLimit);

  // Generate CSV
  const csvRows = [];
  
  // Header row
  csvRows.push([
    'ID',
    'Timestamp',
    'User',
    'Action',
    'Resource Type',
    'Resource ID',
    'Details',
    'IP Address',
    'User Agent',
    'Success',
    'Error Message'
  ].map(escapeCSV).join(','));

  // Data rows
  for (const log of logs) {
    csvRows.push([
      log.id,
      log.created_at,
      log.username || 'System',
      log.action,
      log.resource_type,
      log.resource_id || '',
      log.details || '',
      log.ip_address || '',
      log.user_agent || '',
      log.success ? 'Yes' : 'No',
      log.error_message || ''
    ].map(escapeCSV).join(','));
  }

  const csv = csvRows.join('\n');

  // Send CSV response
  res.writeHead(200, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="audit-log-${Date.now()}.csv"`
  });
  res.end(csv);
}

/**
 * Escape CSV field
 */
function escapeCSV(field) {
  if (field === null || field === undefined) {
    return '';
  }
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Get audit log statistics
 * Returns statistics about audit log entries
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
function handleGetAuditStats(req, res, parsedUrl) {
  const params = parsedUrl.searchParams;
  const hours = parseInt(params.get('hours')) || 24;

  const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // Get total count
  const totalCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM audit_log
    WHERE created_at >= ?
  `).get(cutoffTime).count;

  // Get count by action
  const byAction = db.prepare(`
    SELECT action, COUNT(*) as count
    FROM audit_log
    WHERE created_at >= ?
    GROUP BY action
    ORDER BY count DESC
    LIMIT 10
  `).all(cutoffTime);

  // Get count by resource type
  const byResourceType = db.prepare(`
    SELECT resource_type, COUNT(*) as count
    FROM audit_log
    WHERE created_at >= ?
    GROUP BY resource_type
    ORDER BY count DESC
    LIMIT 10
  `).all(cutoffTime);

  // Get top users by activity
  const topUsers = db.prepare(`
    SELECT u.username, COUNT(*) as count
    FROM audit_log al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.created_at >= ?
    GROUP BY al.user_id
    ORDER BY count DESC
    LIMIT 10
  `).all(cutoffTime);

  // Get hourly timeline
  const timeline = db.prepare(`
    SELECT
      strftime('%Y-%m-%d %H:00:00', created_at) as hour,
      COUNT(*) as count
    FROM audit_log
    WHERE created_at >= ?
    GROUP BY hour
    ORDER BY hour ASC
  `).all(cutoffTime);

  // Get failed actions count
  const failedCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM audit_log
    WHERE created_at >= ? AND success = 0
  `).get(cutoffTime).count;

  sendJSON(res, {
    totalCount,
    failedCount,
    byAction,
    byResourceType,
    topUsers,
    timeline
  });
}
/**
 * Get migration status
 * Returns status of all database migrations
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetMigrations(req, res) {
  try {
    const migrations = getMigrationStatus(db);
    sendJSON(res, { migrations });
  } catch (error) {
    console.error('Get migrations error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

module.exports = handleSettingsRoutes;
