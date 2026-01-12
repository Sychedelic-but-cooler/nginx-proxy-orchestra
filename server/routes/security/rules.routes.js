/**
 * Security rules routes
 * Manages IP blacklist, geo-blocking, and user-agent filtering rules
 */

const { db, logAudit } = require('../../db');
const { parseBody, sendJSON, getClientIP } = require('../shared/utils');
const { updateGlobalSecurityConfig } = require('../../utils/security-config-generator');
const { reloadManager } = require('../../utils/nginx-reload-manager');

/**
 * Handle security rules routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleSecurityRulesRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/security/rules' && method === 'GET') {
    return handleGetSecurityRules(req, res, parsedUrl);
  }

  if (pathname === '/api/security/rules' && method === 'POST') {
    return handleCreateSecurityRule(req, res);
  }

  if (pathname.match(/^\/api\/security\/rules\/\d+$/) && method === 'PUT') {
    return handleUpdateSecurityRule(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/security\/rules\/\d+$/) && method === 'DELETE') {
    return handleDeleteSecurityRule(req, res, parsedUrl);
  }

  if (pathname === '/api/security/rules/bulk' && method === 'POST') {
    return handleBulkImportSecurityRules(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get security rules
 * Returns list of security rules with optional type filtering
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 */
function handleGetSecurityRules(req, res, parsedUrl) {
  try {
    const params = new URLSearchParams(parsedUrl.search);
    const ruleType = params.get('type');

    let query = 'SELECT * FROM security_rules';
    let queryParams = [];

    if (ruleType) {
      query += ' WHERE rule_type = ?';
      queryParams.push(ruleType);
    }

    query += ' ORDER BY created_at DESC';

    const rules = db.prepare(query).all(...queryParams);
    sendJSON(res, { rules });
  } catch (error) {
    console.error('Get security rules error:', error);
    sendJSON(res, { error: error.message || 'Failed to get security rules' }, 500);
  }
}

/**
 * Create security rule
 * Creates a new security rule and updates nginx configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleCreateSecurityRule(req, res) {
  try {
    const body = await parseBody(req);
    const { rule_type, rule_value, action, description, enabled } = body;

    if (!rule_type || !rule_value) {
      return sendJSON(res, { error: 'rule_type and rule_value are required' }, 400);
    }

    // Validate rule_type
    const validTypes = ['ip_blacklist', 'geo_block', 'user_agent_filter'];
    if (!validTypes.includes(rule_type)) {
      return sendJSON(res, { error: 'Invalid rule_type' }, 400);
    }

    const result = db.prepare(`
      INSERT INTO security_rules (rule_type, rule_value, action, description, enabled)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      rule_type,
      rule_value,
      action || 'deny',
      description || null,
      enabled !== undefined ? enabled : 1
    );

    // Update global security config
    updateGlobalSecurityConfig(db);

    // Log audit
    logAudit(
      req.user.userId,
      'create',
      'security_rule',
      result.lastInsertRowid,
      `Created ${rule_type} rule: ${rule_value}`,
      getClientIP(req)
    );

    // Trigger nginx reload
    await reloadManager.queueReload();

    sendJSON(res, {
      success: true,
      id: result.lastInsertRowid,
      message: 'Security rule created successfully'
    });
  } catch (error) {
    console.error('Create security rule error:', error);
    sendJSON(res, { error: error.message || 'Failed to create security rule' }, 500);
  }
}

/**
 * Update security rule
 * Updates an existing security rule and regenerates nginx configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with rule ID
 */
async function handleUpdateSecurityRule(req, res, parsedUrl) {
  try {
    const id = parseInt(parsedUrl.pathname.split('/')[4]);
    const body = await parseBody(req);
    const { rule_value, action, description, enabled } = body;

    const rule = db.prepare('SELECT * FROM security_rules WHERE id = ?').get(id);
    if (!rule) {
      return sendJSON(res, { error: 'Security rule not found' }, 404);
    }

    db.prepare(`
      UPDATE security_rules
      SET rule_value = ?, action = ?, description = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      rule_value || rule.rule_value,
      action || rule.action,
      description !== undefined ? description : rule.description,
      enabled !== undefined ? enabled : rule.enabled,
      id
    );

    // Update global security config
    updateGlobalSecurityConfig(db);

    // Log audit
    logAudit(
      req.user.userId,
      'update',
      'security_rule',
      id,
      `Updated ${rule.rule_type} rule: ${rule_value || rule.rule_value}`,
      getClientIP(req)
    );

    // Trigger nginx reload
    await reloadManager.queueReload();

    sendJSON(res, { success: true, message: 'Security rule updated successfully' });
  } catch (error) {
    console.error('Update security rule error:', error);
    sendJSON(res, { error: error.message || 'Failed to update security rule' }, 500);
  }
}

/**
 * Delete security rule
 * Removes a security rule and updates nginx configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with rule ID
 */
async function handleDeleteSecurityRule(req, res, parsedUrl) {
  try {
    const id = parseInt(parsedUrl.pathname.split('/')[4]);

    const rule = db.prepare('SELECT * FROM security_rules WHERE id = ?').get(id);
    if (!rule) {
      return sendJSON(res, { error: 'Security rule not found' }, 404);
    }

    db.prepare('DELETE FROM security_rules WHERE id = ?').run(id);

    // Update global security config
    updateGlobalSecurityConfig(db);

    // Log audit
    logAudit(
      req.user.userId,
      'delete',
      'security_rule',
      id,
      `Deleted ${rule.rule_type} rule: ${rule.rule_value}`,
      getClientIP(req)
    );

    // Trigger nginx reload
    await reloadManager.queueReload();

    sendJSON(res, { success: true, message: 'Security rule deleted successfully' });
  } catch (error) {
    console.error('Delete security rule error:', error);
    sendJSON(res, { error: error.message || 'Failed to delete security rule' }, 500);
  }
}

/**
 * Bulk import security rules
 * Imports multiple security rules at once
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleBulkImportSecurityRules(req, res) {
  try {
    const body = await parseBody(req);
    const { rule_type, rules } = body;

    if (!rule_type || !Array.isArray(rules) || rules.length === 0) {
      return sendJSON(res, { error: 'rule_type and rules array are required' }, 400);
    }

    const validTypes = ['ip_blacklist', 'geo_block', 'user_agent_filter'];
    if (!validTypes.includes(rule_type)) {
      return sendJSON(res, { error: 'Invalid rule_type' }, 400);
    }

    const insertStmt = db.prepare(`
      INSERT INTO security_rules (rule_type, rule_value, action, description, enabled)
      VALUES (?, ?, ?, ?, ?)
    `);

    let imported = 0;
    for (const rule of rules) {
      if (rule.rule_value) {
        insertStmt.run(
          rule_type,
          rule.rule_value,
          rule.action || 'deny',
          rule.description || null,
          rule.enabled !== undefined ? rule.enabled : 1
        );
        imported++;
      }
    }

    // Update global security config
    updateGlobalSecurityConfig(db);

    // Log audit
    logAudit(
      req.user.userId,
      'bulk_import',
      'security_rule',
      null,
      `Bulk imported ${imported} ${rule_type} rules`,
      getClientIP(req)
    );

    // Trigger nginx reload
    await reloadManager.queueReload();

    sendJSON(res, {
      success: true,
      imported,
      message: `Successfully imported ${imported} security rules`
    });
  } catch (error) {
    console.error('Bulk import security rules error:', error);
    sendJSON(res, { error: error.message || 'Failed to bulk import security rules' }, 500);
  }
}

module.exports = handleSecurityRulesRoutes;
