/**
 * Ban integrations routes
 * Manages ban system integrations with external providers
 */

const { db, logAudit } = require('../../db');
const { parseBody, sendJSON, getClientIP } = require('../shared/utils');
const { getProviderInfo } = require('../../utils/ban-providers');

/**
 * Handle ban integrations routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleBanIntegrationRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/ban/integrations' && method === 'GET') {
    return handleGetBanIntegrations(req, res);
  }

  if (pathname === '/api/ban/integrations' && method === 'POST') {
    return handleCreateBanIntegration(req, res);
  }

  if (pathname.match(/^\/api\/ban\/integrations\/\d+$/) && method === 'PUT') {
    return handleUpdateBanIntegration(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/ban\/integrations\/\d+$/) && method === 'DELETE') {
    return handleDeleteBanIntegration(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/ban\/integrations\/\d+\/test$/) && method === 'POST') {
    return handleTestBanIntegration(req, res, parsedUrl);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get ban integrations
 * Returns all configured ban integrations with provider info
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetBanIntegrations(req, res) {
  try {
    const integrations = db.prepare(`
      SELECT
        i.*,
        c.name as credential_name,
        c.credential_type,
        (SELECT COUNT(*) FROM ip_bans WHERE integrations_notified LIKE '%"id":' || i.id || '%') as bans_sent
      FROM ban_integrations i
      LEFT JOIN credentials c ON i.credential_id = c.id
      ORDER BY i.created_at DESC
    `).all();

    // Get provider info for each integration
    const integrationsWithInfo = integrations.map(integration => {
      const info = getProviderInfo(integration.type);
      return {
        ...integration,
        provider_info: info,
        config: JSON.parse(integration.config_json || '{}')
      };
    });

    sendJSON(res, { integrations: integrationsWithInfo });
  } catch (error) {
    console.error('Get ban integrations error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Create ban integration
 * Creates a new external ban provider integration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleCreateBanIntegration(req, res) {
  try {
    const body = await parseBody(req);
    const { name, type, credential_id, config_json, enabled } = body;

    if (!name || !type) {
      return sendJSON(res, { error: 'Name and type are required' }, 400);
    }

    // Validate provider type
    const providerInfo = getProviderInfo(type);
    if (!providerInfo) {
      return sendJSON(res, { error: `Unknown provider type: ${type}` }, 400);
    }

    const result = db.prepare(`
      INSERT INTO ban_integrations (name, type, credential_id, config_json, enabled)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, type, credential_id || null, config_json || '{}', enabled ? 1 : 0);

    logAudit(
      req.user.userId,
      'create_ban_integration',
      'ban_integration',
      result.lastInsertRowid,
      null,
      getClientIP(req)
    );

    sendJSON(res, {
      success: true,
      id: result.lastInsertRowid,
      message: 'Ban integration created successfully'
    }, 201);
  } catch (error) {
    console.error('Create ban integration error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Update ban integration
 * Updates an existing ban integration configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with integration ID
 */
async function handleUpdateBanIntegration(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];
    const body = await parseBody(req);
    const { name, credential_id, config_json, enabled } = body;

    const existing = db.prepare('SELECT * FROM ban_integrations WHERE id = ?').get(id);
    if (!existing) {
      return sendJSON(res, { error: 'Integration not found' }, 404);
    }

    db.prepare(`
      UPDATE ban_integrations
      SET name = ?, credential_id = ?, config_json = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name || existing.name,
      credential_id !== undefined ? credential_id : existing.credential_id,
      config_json || existing.config_json,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      id
    );

    logAudit(req.user.userId, 'update_ban_integration', 'ban_integration', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'Integration updated successfully' });
  } catch (error) {
    console.error('Update ban integration error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Delete ban integration
 * Removes a ban integration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with integration ID
 */
function handleDeleteBanIntegration(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const existing = db.prepare('SELECT * FROM ban_integrations WHERE id = ?').get(id);
    if (!existing) {
      return sendJSON(res, { error: 'Integration not found' }, 404);
    }

    db.prepare('DELETE FROM ban_integrations WHERE id = ?').run(id);

    logAudit(req.user.userId, 'delete_ban_integration', 'ban_integration', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'Integration deleted successfully' });
  } catch (error) {
    console.error('Delete ban integration error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Test ban integration
 * Tests connectivity and authentication with an integration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with integration ID
 */
async function handleTestBanIntegration(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const integration = db.prepare('SELECT * FROM ban_integrations WHERE id = ?').get(id);
    if (!integration) {
      return sendJSON(res, { error: 'Integration not found' }, 404);
    }

    // Test connection using provider
    const { getProvider } = require('../../utils/ban-providers');

    try {
      const provider = getProvider(integration);
      const testResult = await provider.testConnection();

      sendJSON(res, {
        success: testResult.success,
        message: testResult.message
      });
    } catch (error) {
      sendJSON(res, {
        success: false,
        message: error.message
      }, 400);
    }
  } catch (error) {
    console.error('Test ban integration error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

module.exports = handleBanIntegrationRoutes;
