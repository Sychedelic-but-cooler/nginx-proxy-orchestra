/**
 * Detection rules routes
 * Manages automatic IP detection and banning rules
 */

const { db, logAudit } = require('../../db');
const { parseBody, sendJSON, getClientIP } = require('../shared/utils');
const { verifyTOTPIfEnabled } = require('../middleware/totp.middleware');

/**
 * Handle detection rules routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleDetectionRulesRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/ban/detection-rules' && method === 'GET') {
    return handleGetDetectionRules(req, res);
  }

  if (pathname === '/api/ban/detection-rules' && method === 'POST') {
    return handleCreateDetectionRule(req, res);
  }

  if (pathname.match(/^\/api\/ban\/detection-rules\/\d+$/) && method === 'PUT') {
    return handleUpdateDetectionRule(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/ban\/detection-rules\/\d+$/) && method === 'DELETE') {
    return handleDeleteDetectionRule(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/ban\/detection-rules\/\d+\/toggle$/) && method === 'POST') {
    return handleToggleDetectionRule(req, res, parsedUrl);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get detection rules
 * Returns all configured detection rules
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetDetectionRules(req, res) {
  try {
    const rules = db.prepare(`
      SELECT
        r.*,
        (SELECT COUNT(*) FROM ip_bans WHERE detection_rule_id = r.id) as total_bans
      FROM ips_detection_rules r
      ORDER BY r.priority ASC, r.created_at DESC
    `).all();

    // Parse JSON fields
    const rulesWithParsed = rules.map(rule => ({
      ...rule,
      attack_types: rule.attack_types ? JSON.parse(rule.attack_types) : null
    }));

    sendJSON(res, { rules: rulesWithParsed });
  } catch (error) {
    console.error('Get detection rules error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Create detection rule
 * Creates a new automatic detection rule
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleCreateDetectionRule(req, res) {
  try {
    const body = await parseBody(req);
    const {
      name, threshold, time_window, attack_types, severity_filter,
      proxy_id, ban_duration, ban_severity, priority, enabled
    } = body;

    if (!name || !threshold || !time_window) {
      return sendJSON(res, { error: 'Name, threshold, and time_window are required' }, 400);
    }

    const result = db.prepare(`
      INSERT INTO ips_detection_rules (
        name, threshold, time_window, attack_types, severity_filter,
        proxy_id, ban_duration, ban_severity, priority, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, threshold, time_window,
      attack_types ? JSON.stringify(attack_types) : null,
      severity_filter || 'ALL',
      proxy_id || null,
      ban_duration || 3600,
      ban_severity || 'MEDIUM',
      priority || 100,
      enabled !== undefined ? (enabled ? 1 : 0) : 1
    );

    logAudit(
      req.user.userId,
      'create_detection_rule',
      'detection_rule',
      result.lastInsertRowid,
      JSON.stringify({ name, threshold, time_window }),
      getClientIP(req)
    );

    sendJSON(res, {
      success: true,
      id: result.lastInsertRowid,
      message: 'Detection rule created successfully'
    }, 201);
  } catch (error) {
    console.error('Create detection rule error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Update detection rule
 * Updates an existing detection rule
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with rule ID
 */
async function handleUpdateDetectionRule(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];
    const body = await parseBody(req);

    const existing = db.prepare('SELECT * FROM ips_detection_rules WHERE id = ?').get(id);
    if (!existing) {
      return sendJSON(res, { error: 'Detection rule not found' }, 404);
    }

    const {
      name, threshold, time_window, attack_types, severity_filter,
      proxy_id, ban_duration, ban_severity, priority, enabled
    } = body;

    db.prepare(`
      UPDATE ips_detection_rules
      SET name = ?, threshold = ?, time_window = ?, attack_types = ?,
          severity_filter = ?, proxy_id = ?, ban_duration = ?,
          ban_severity = ?, priority = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name !== undefined ? name : existing.name,
      threshold !== undefined ? threshold : existing.threshold,
      time_window !== undefined ? time_window : existing.time_window,
      attack_types !== undefined ? JSON.stringify(attack_types) : existing.attack_types,
      severity_filter !== undefined ? severity_filter : existing.severity_filter,
      proxy_id !== undefined ? proxy_id : existing.proxy_id,
      ban_duration !== undefined ? ban_duration : existing.ban_duration,
      ban_severity !== undefined ? ban_severity : existing.ban_severity,
      priority !== undefined ? priority : existing.priority,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      id
    );

    logAudit(req.user.userId, 'update_detection_rule', 'detection_rule', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'Detection rule updated successfully' });
  } catch (error) {
    console.error('Update detection rule error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Delete detection rule
 * Removes a detection rule
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with rule ID
 */
async function handleDeleteDetectionRule(req, res, parsedUrl) {
  try {
    // Verify TOTP if 2FA is enabled (critical security operation)
    const totpVerified = await verifyTOTPIfEnabled(req, res);
    if (!totpVerified) {
      return; // Response already sent
    }

    const id = parsedUrl.pathname.split('/')[4];

    const existing = db.prepare('SELECT * FROM ips_detection_rules WHERE id = ?').get(id);
    if (!existing) {
      return sendJSON(res, { error: 'Detection rule not found' }, 404);
    }

    db.prepare('DELETE FROM ips_detection_rules WHERE id = ?').run(id);

    logAudit(req.user.userId, 'delete_detection_rule', 'detection_rule', id, '2FA verified', getClientIP(req));

    sendJSON(res, { success: true, message: 'Detection rule deleted successfully' });
  } catch (error) {
    console.error('Delete detection rule error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Toggle detection rule
 * Enables or disables a detection rule
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with rule ID
 */
async function handleToggleDetectionRule(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const existing = db.prepare('SELECT enabled FROM ips_detection_rules WHERE id = ?').get(id);
    if (!existing) {
      return sendJSON(res, { error: 'Detection rule not found' }, 404);
    }

    const newEnabled = existing.enabled ? 0 : 1;

    // Only require TOTP when DISABLING a rule (security-critical)
    if (newEnabled === 0) {
      const totpVerified = await verifyTOTPIfEnabled(req, res);
      if (!totpVerified) {
        return; // Response already sent
      }
    }

    db.prepare('UPDATE ips_detection_rules SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newEnabled, id);

    logAudit(
      req.user.userId,
      newEnabled ? 'enable_detection_rule' : 'disable_detection_rule',
      'detection_rule',
      id,
      newEnabled === 0 ? '2FA verified' : null,
      getClientIP(req)
    );

    sendJSON(res, {
      success: true,
      enabled: newEnabled === 1,
      message: `Detection rule ${newEnabled ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    console.error('Toggle detection rule error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

module.exports = handleDetectionRulesRoutes;
