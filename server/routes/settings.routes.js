const { sendJSON, parseBody, getClientIP } = require('./shared/utils');
const { db, logAudit, getSetting, setSetting, getAllSettings } = require('../db');
const { reloadManager } = require('../utils/nginx-reload-manager');
const { getErrorPages, setErrorPage, ALLOWED_CODES, ensureDefaultErrorPages } = require('../utils/error-pages');
// Note: 'migrate' module might not be fully available if we just use db methods
// but let's try to import getMigrationStatus safely or replicate it if simple
let getMigrationStatus;
try {
  const migrateModule = require('../migrate');
  getMigrationStatus = migrateModule.getMigrationStatus;
} catch (e) {
  // Fallback if migrate.js exports structure is different or module missing
  getMigrationStatus = (database) => {
    try {
      return database.prepare('SELECT * FROM migrations ORDER BY id DESC').all();
    } catch (err) {
      return [];
    }
  };
}


/**
 * Handle settings and audit-log routes
 * @param {IncomingMessage} req 
 * @param {ServerResponse} res 
 * @param {URL} parsedUrl 
 */
async function handleSettingsRoutes(req, res, parsedUrl) {
  const method = req.method;
  const pathname = parsedUrl.pathname;

  // Settings routes
  if (pathname === '/api/settings' && method === 'GET') {
    return handleGetSettings(req, res);
  }
  if (pathname === '/api/settings' && method === 'PUT') {
    return await handleUpdateSettings(req, res);
  }

  // Error Pages routes
  if (pathname === '/api/settings/error-pages' && method === 'GET') {
    return handleGetErrorPages(req, res);
  }
  if (pathname === '/api/settings/error-pages' && method === 'PUT') {
    return await handleUpdateErrorPage(req, res);
  }

  // Audit Log routes
  if (pathname === '/api/audit-log' && method === 'GET') {
    return handleGetAuditLog(req, res, parsedUrl);
  }
  if (pathname === '/api/audit-log/export' && method === 'GET') {
    return handleExportAuditLog(req, res, parsedUrl);
  }
  if (pathname === '/api/audit-log/stats' && method === 'GET') {
    return handleGetAuditStats(req, res, parsedUrl);
  }

  // Migration routes
  if (pathname === '/api/migrations' && method === 'GET') {
    return handleGetMigrations(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get all system settings
 */
function handleGetSettings(req, res) {
  try {
    const settings = {};
    const allSettings = getAllSettings();
    for (const setting of allSettings) {
      settings[setting.key] = setting.value;
    }
    sendJSON(res, settings);
  } catch (error) {
    console.error('Get settings error:', error);
    sendJSON(res, { error: 'Failed to fetch settings' }, 500);
  }
}

/**
 * Update system settings
 */
async function handleUpdateSettings(req, res) {
  try {
    const updates = await parseBody(req);
    // Destructure known fields to match old logic's specificity if needed, 
    // or just iterate updates like the new logic did. 
    // The old logic was more specific about what it handled (behavior, url, admin_cert).
    // The new logic was generic. Let's blend them to be safe but allow generic updates.
    
    const currentSettings = {};
    getAllSettings().forEach(s => currentSettings[s.key] = s.value);

    let requiresRestart = false;
    let restartMessage = '';
    let adminCertChanged = false;

    // specific validation from old code
    if (updates.default_server_behavior) {
       const validBehaviors = ['drop', '404', 'custom'];
       if (!validBehaviors.includes(updates.default_server_behavior)) {
         return sendJSON(res, { error: 'Invalid default server behavior' }, 400);
       }
    }

    // Check for changes that require restart (Admin Cert)
    if (updates.admin_cert_id !== undefined && updates.admin_cert_id != currentSettings.admin_cert_id) {
      // Validate cert exists (from old code)
      if (updates.admin_cert_id) {
        const cert = db.prepare('SELECT id FROM ssl_certificates WHERE id = ?').get(parseInt(updates.admin_cert_id));
        if (!cert) {
          return sendJSON(res, { error: 'Invalid certificate ID' }, 400);
        }
      }
      requiresRestart = true;
      restartMessage = 'Admin interface certificate changed. Please restart the server for changes to take effect.';
      adminCertChanged = true;
    }

    // Update settings in DB
    Object.keys(updates).forEach(key => {
      setSetting(key, updates[key]);
    });
    
    // Log action
    logAudit(req.user.userId, 'update_settings', 'settings', null, JSON.stringify(updates), getClientIP(req));

    // If default server behavior changed, we might need to reload nginx
    if (updates.default_server_behavior || updates.default_server_custom_url !== undefined) {
      const { ensureDefaultServer } = require('../utils/default-server'); // Using ensureDefaultServer (new) instead of initializeDefaultServer (old)
      ensureDefaultServer(); 
      await reloadManager.queueReload();
    }

    sendJSON(res, { 
      success: true, 
      message: 'Settings updated successfully',
      requiresRestart,
      restartMessage
    });
  } catch (error) {
    console.error('Update settings error:', error);
    sendJSON(res, { error: 'Failed to update settings' }, 500);
  }
}

/**
 * Get audit log entries
 */
function handleGetAuditLog(req, res, parsedUrl) {
  try {
    const params = parsedUrl.searchParams;
    const limit = parseInt(params.get('limit')) || 50;
    const offset = parseInt(params.get('offset')) || 0;
    
    // Extract filter params (restoring from old code)
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

    if (userId) { whereClauses.push('al.user_id = ?'); params_array.push(parseInt(userId)); }
    if (username) { whereClauses.push('u.username = ?'); params_array.push(username); }
    if (action) { whereClauses.push('al.action = ?'); params_array.push(action); }
    if (resourceType) { whereClauses.push('al.resource_type = ?'); params_array.push(resourceType); }
    if (ipAddress) { whereClauses.push('al.ip_address = ?'); params_array.push(ipAddress); }
    if (startDate) { whereClauses.push('al.created_at >= ?'); params_array.push(startDate); }
    if (endDate) { whereClauses.push('al.created_at <= ?'); params_array.push(endDate); }
    if (search) {
      whereClauses.push('(al.details LIKE ? OR u.username LIKE ?)');
      params_array.push(`%${search}%`, `%${search}%`);
    }
    if (success !== null && success !== undefined && success !== '') {
      whereClauses.push('al.success = ?');
      params_array.push(success === 'true' ? 1 : 0);
    }

    const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    // Count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
    `;
    const totalResult = db.prepare(countQuery).get(...params_array);
    const total = totalResult.total;

    // Fetch
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

    sendJSON(res, { logs, total, limit, offset });
  } catch (error) {
    console.error('Get audit log error:', error);
    sendJSON(res, { error: 'Failed to fetch audit log' }, 500);
  }
}

/**
 * Export audit log to CSV
 */
function handleExportAuditLog(req, res, parsedUrl) {
  try {
    const params = parsedUrl.searchParams;
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

    const whereClauses = [];
    const params_array = [];

    if (userId) { whereClauses.push('al.user_id = ?'); params_array.push(parseInt(userId)); }
    if (username) { whereClauses.push('u.username = ?'); params_array.push(username); }
    if (action) { whereClauses.push('al.action = ?'); params_array.push(action); }
    if (resourceType) { whereClauses.push('al.resource_type = ?'); params_array.push(resourceType); }
    if (ipAddress) { whereClauses.push('al.ip_address = ?'); params_array.push(ipAddress); }
    if (startDate) { whereClauses.push('al.created_at >= ?'); params_array.push(startDate); }
    if (endDate) { whereClauses.push('al.created_at <= ?'); params_array.push(endDate); }
    if (search) {
      whereClauses.push('(al.details LIKE ? OR u.username LIKE ?)');
      params_array.push(`%${search}%`, `%${search}%`);
    }
    if (success !== null && success !== undefined && success !== '') {
      whereClauses.push('al.success = ?');
      params_array.push(success === 'true' ? 1 : 0);
    }

    const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const logsQuery = `
      SELECT
        al.id, al.created_at, u.username, al.action, al.resource_type, al.resource_id,
        al.details, al.ip_address, al.user_agent, al.success, al.error_message
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ?
    `;
    const logs = db.prepare(logsQuery).all(...params_array, maxLimit);

    const csvRows = [];
    csvRows.push(['ID', 'Timestamp', 'User', 'Action', 'Resource Type', 'Resource ID', 'Details', 'IP Address', 'User Agent', 'Success', 'Error Message'].map(escapeCSV).join(','));

    for (const log of logs) {
      csvRows.push([
        log.id, log.created_at, log.username || 'System', log.action, log.resource_type,
        log.resource_id || '', log.details || '', log.ip_address || '', log.user_agent || '',
        log.success ? 'Yes' : 'No', log.error_message || ''
      ].map(escapeCSV).join(','));
    }

    res.writeHead(200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="audit-log-${Date.now()}.csv"`
    });
    res.end(csvRows.join('\n'));
  } catch (error) {
    console.error('Export audit log error:', error);
    sendJSON(res, { error: 'Failed to export audit log' }, 500);
  }
}

function escapeCSV(field) {
  if (field === null || field === undefined) return '';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Get audit log statistics
 */
function handleGetAuditStats(req, res, parsedUrl) {
  try {
    const params = parsedUrl.searchParams;
    const hours = parseInt(params.get('hours')) || 24;
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const totalCount = db.prepare('SELECT COUNT(*) as count FROM audit_log WHERE created_at >= ?').get(cutoffTime).count;
    const failedCount = db.prepare('SELECT COUNT(*) as count FROM audit_log WHERE created_at >= ? AND success = 0').get(cutoffTime).count;

    const byAction = db.prepare(`SELECT action, COUNT(*) as count FROM audit_log WHERE created_at >= ? GROUP BY action ORDER BY count DESC LIMIT 10`).all(cutoffTime);
    const byResourceType = db.prepare(`SELECT resource_type, COUNT(*) as count FROM audit_log WHERE created_at >= ? GROUP BY resource_type ORDER BY count DESC LIMIT 10`).all(cutoffTime);
    
    const topUsers = db.prepare(`
      SELECT u.username, COUNT(*) as count
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= ?
      GROUP BY al.user_id
      ORDER BY count DESC
      LIMIT 10
    `).all(cutoffTime);

    const timeline = db.prepare(`
      SELECT strftime('%Y-%m-%d %H:00:00', created_at) as hour, COUNT(*) as count
      FROM audit_log
      WHERE created_at >= ?
      GROUP BY hour
      ORDER BY hour ASC
    `).all(cutoffTime);

    sendJSON(res, { totalCount, failedCount, byAction, byResourceType, topUsers, timeline });
  } catch (error) {
    console.error('Get audit stats error:', error);
    sendJSON(res, { error: 'Failed to fetch audit stats' }, 500);
  }
}

/**
 * Get custom error pages
 */
function handleGetErrorPages(req, res) {
  try {
    const pages = getErrorPages(false);
    sendJSON(res, { success: true, pages, allowed: ALLOWED_CODES });
  } catch (error) {
    console.error('Get error pages error:', error);
    sendJSON(res, { error: error.message || 'Failed to get error pages' }, 500);
  }
}

/**
 * Update (upload) a custom error page
 */
async function handleUpdateErrorPage(req, res) {
  try {
    const body = await parseBody(req);
    const { code, html } = body;

    if (!code || !html) {
      return sendJSON(res, { error: 'code and html are required' }, 400);
    }
    if (!ALLOWED_CODES.includes(String(code))) {
      return sendJSON(res, { error: 'Unsupported error code' }, 400);
    }

    setErrorPage(String(code), html);
    ensureDefaultErrorPages();

    logAudit(req.user.userId, 'update_error_page', 'settings', null, JSON.stringify({ code }), getClientIP(req));

    // Reload nginx so new page takes effect in default server and templates
    await reloadManager.queueReload();

    sendJSON(res, { success: true, message: `Custom ${code} page saved` });
  } catch (error) {
    console.error('Update error page error:', error);
    sendJSON(res, { error: error.message || 'Failed to update error page' }, 500);
  }
}

/**
 * Get migration status
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
