/**
 * Notifications routes
 * Manages notification settings and testing
 */

const { getSetting, setSetting, logAudit } = require('../db');
const { parseBody, sendJSON, getClientIP } = require('./shared/utils');

/**
 * Handle notification-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleNotificationRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/settings/notifications' && method === 'GET') {
    return handleGetNotificationSettings(req, res);
  }

  if (pathname === '/api/settings/notifications' && method === 'PUT') {
    return handleUpdateNotificationSettings(req, res);
  }

  if (pathname === '/api/notifications/test' && method === 'POST') {
    return handleTestNotification(req, res);
  }

  if (pathname === '/api/notifications/matrix' && method === 'GET') {
    return handleGetWAFMatrix(req, res);
  }

  if (pathname === '/api/notifications/matrix' && method === 'PUT') {
    return handleUpdateWAFMatrix(req, res);
  }

  if (pathname === '/api/notifications/schedules' && method === 'GET') {
    return handleGetSchedules(req, res);
  }

  if (pathname === '/api/notifications/schedules' && method === 'PUT') {
    return handleUpdateSchedules(req, res);
  }

  if (pathname === '/api/notifications/templates' && method === 'GET') {
    return handleGetTemplates(req, res);
  }

  if (pathname === '/api/notifications/history' && method === 'GET') {
    return handleGetHistory(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get notification settings
 * Returns current notification configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetNotificationSettings(req, res) {
  try {
    const settings = {
      enabled: getSetting('notifications_enabled') === '1',
      apprise_urls: JSON.parse(getSetting('notification_apprise_urls') || '[]'),
      triggers: {
        waf_blocks: getSetting('notification_waf_blocks') === '1',
        waf_high_severity: getSetting('notification_waf_high_severity') === '1',
        waf_threshold: parseInt(getSetting('notification_waf_threshold') || '10'),
        waf_threshold_minutes: parseInt(getSetting('notification_waf_threshold_minutes') || '5'),
        system_errors: getSetting('notification_system_errors') === '1',
        proxy_changes: getSetting('notification_proxy_changes') === '1',
        cert_expiry: getSetting('notification_cert_expiry') === '1',
        cert_expiry_days: parseInt(getSetting('notification_cert_expiry_days') || '7'),
        ban_issued: getSetting('notification_ban_issued') === '1',
        ban_cleared: getSetting('notification_ban_cleared') === '1'
      },
      enhanced: {
        matrix_enabled: getSetting('notification_matrix_enabled') === '1',
        daily_report_enabled: getSetting('notification_daily_report_enabled') === '1',
        proxy_lifecycle_enabled: getSetting('notification_proxy_lifecycle_enabled') === '1',
        batching_enabled: getSetting('notification_batching_enabled') === '1',
        batch_interval: parseInt(getSetting('notification_batch_interval') || '300'),
        rate_limit: parseInt(getSetting('notification_rate_limit') || '10'),
        daily_report_time: getSetting('notification_daily_report_time') || '23:30',
        timezone: getSetting('notification_timezone') || 'UTC'
      }
    };

    sendJSON(res, settings);
  } catch (error) {
    console.error('Get notification settings error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Update notification settings
 * Updates notification configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleUpdateNotificationSettings(req, res) {
  try {
    const body = await parseBody(req);

    setSetting('notifications_enabled', body.enabled ? '1' : '0');
    setSetting('notification_apprise_urls', JSON.stringify(body.apprise_urls || []));

    if (body.triggers) {
      setSetting('notification_waf_blocks', body.triggers.waf_blocks ? '1' : '0');
      setSetting('notification_waf_high_severity', body.triggers.waf_high_severity ? '1' : '0');
      setSetting('notification_waf_threshold', String(body.triggers.waf_threshold || 10));
      setSetting('notification_waf_threshold_minutes', String(body.triggers.waf_threshold_minutes || 5));
      setSetting('notification_system_errors', body.triggers.system_errors ? '1' : '0');
      setSetting('notification_proxy_changes', body.triggers.proxy_changes ? '1' : '0');
      setSetting('notification_cert_expiry', body.triggers.cert_expiry ? '1' : '0');
      setSetting('notification_cert_expiry_days', String(body.triggers.cert_expiry_days || 7));
      setSetting('notification_ban_issued', body.triggers.ban_issued ? '1' : '0');
      setSetting('notification_ban_cleared', body.triggers.ban_cleared ? '1' : '0');
    }

    // Enhanced notification settings
    if (body.enhanced) {
      setSetting('notification_matrix_enabled', body.enhanced.matrix_enabled ? '1' : '0');
      setSetting('notification_daily_report_enabled', body.enhanced.daily_report_enabled ? '1' : '0');
      setSetting('notification_proxy_lifecycle_enabled', body.enhanced.proxy_lifecycle_enabled ? '1' : '0');
      setSetting('notification_batching_enabled', body.enhanced.batching_enabled ? '1' : '0');
      setSetting('notification_batch_interval', String(body.enhanced.batch_interval || 300));
      setSetting('notification_rate_limit', String(body.enhanced.rate_limit || 10));
      setSetting('notification_daily_report_time', body.enhanced.daily_report_time || '23:30');
      setSetting('notification_timezone', body.enhanced.timezone || 'UTC');
      
      // Restart scheduler if settings changed
      const { getNotificationService } = require('../utils/notification-service');
      const service = getNotificationService();
      if (service.scheduleDailyReports) {
        service.scheduleDailyReports();
      }
    }

    // Enhanced notification settings
    if (body.enhanced) {
      setSetting('notification_matrix_enabled', body.enhanced.matrix_enabled ? '1' : '0');
      setSetting('notification_daily_report_enabled', body.enhanced.daily_report_enabled ? '1' : '0');
      setSetting('notification_proxy_lifecycle_enabled', body.enhanced.proxy_lifecycle_enabled ? '1' : '0');
      setSetting('notification_batching_enabled', body.enhanced.batching_enabled ? '1' : '0');
      setSetting('notification_batch_interval', String(body.enhanced.batch_interval || 300));
      setSetting('notification_rate_limit', String(body.enhanced.rate_limit || 10));
      setSetting('notification_daily_report_time', body.enhanced.daily_report_time || '23:30');
      setSetting('notification_timezone', body.enhanced.timezone || 'UTC');
      
      // Restart scheduler if settings changed
      const { getNotificationService } = require('../utils/notification-service');
      const service = getNotificationService();
      if (service.scheduleDailyReports) {
        service.scheduleDailyReports();
      }
    }

    logAudit(req.user.userId, 'update_notification_settings', 'settings', null,
             null, getClientIP(req));

    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Update notification settings error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Test notification
 * Sends a test notification to verify configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleTestNotification(req, res) {
  try {
    const { sendTestNotification } = require('../utils/notification-service');
    const result = await sendTestNotification();

    if (result.success) {
      sendJSON(res, { success: true, message: 'Test notification sent' });
    } else {
      const errorMessage = result.reason || result.error || 'Unknown error';
      sendJSON(res, {
        success: false,
        error: `Failed to send: ${errorMessage}`
      }, 400);
    }
  } catch (error) {
    console.error('Test notification error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get WAF notification matrix settings
 */
function handleGetWAFMatrix(req, res) {
  try {
    const matrix = db.prepare(`
      SELECT * FROM waf_notification_matrix
      ORDER BY severity_level, count_threshold
    `).all();
    
    sendJSON(res, { matrix });
  } catch (error) {
    console.error('Get WAF matrix error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Update WAF notification matrix settings
 */
async function handleUpdateWAFMatrix(req, res) {
  try {
    const body = await parseBody(req);
    
    if (body.matrix && Array.isArray(body.matrix)) {
      const updateStmt = db.prepare(`
        UPDATE waf_notification_matrix
        SET enabled = ?, count_threshold = ?, time_window = ?, notification_delay = ?
        WHERE id = ?
      `);
      
      body.matrix.forEach(config => {
        updateStmt.run(
          config.enabled ? 1 : 0,
          config.count_threshold,
          config.time_window,
          config.notification_delay || 0,
          config.id
        );
      });
    }
    
    logAudit(req.user.userId, 'update_waf_matrix', 'settings', null,
             null, getClientIP(req));
    
    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Update WAF matrix error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get notification schedules
 */
function handleGetSchedules(req, res) {
  try {
    const schedules = db.prepare(`
      SELECT * FROM notification_schedules
      ORDER BY name
    `).all();
    
    sendJSON(res, { schedules });
  } catch (error) {
    console.error('Get schedules error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Update notification schedules
 */
async function handleUpdateSchedules(req, res) {
  try {
    const body = await parseBody(req);
    
    if (body.schedules && Array.isArray(body.schedules)) {
      const updateStmt = db.prepare(`
        UPDATE notification_schedules
        SET enabled = ?, cron_expression = ?, settings = ?
        WHERE id = ?
      `);
      
      body.schedules.forEach(schedule => {
        updateStmt.run(
          schedule.enabled ? 1 : 0,
          schedule.cron_expression,
          JSON.stringify(schedule.settings),
          schedule.id
        );
      });
      
      // Restart scheduler
      const { getNotificationService } = require('../utils/notification-service');
      const service = getNotificationService();
      if (service.scheduleDailyReports) {
        service.scheduleDailyReports();
      }
    }
    
    logAudit(req.user.userId, 'update_schedules', 'settings', null,
             null, getClientIP(req));
    
    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Update schedules error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get notification templates
 */
function handleGetTemplates(req, res) {
  try {
    const templates = db.prepare(`
      SELECT * FROM notification_templates
      ORDER BY type, name
    `).all();
    
    sendJSON(res, { templates });
  } catch (error) {
    console.error('Get templates error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get notification history
 */
function handleGetHistory(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = parseInt(url.searchParams.get('limit')) || 50;
    const offset = parseInt(url.searchParams.get('offset')) || 0;
    
    const history = db.prepare(`
      SELECT * FROM notification_history
      ORDER BY sent_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    
    const total = db.prepare(`
      SELECT COUNT(*) as count FROM notification_history
    `).get();
    
    sendJSON(res, { 
      history,
      total: total.count,
      limit,
      offset
    });
  } catch (error) {
    console.error('Get history error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

module.exports = handleNotificationRoutes;
