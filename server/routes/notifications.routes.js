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

module.exports = handleNotificationRoutes;
