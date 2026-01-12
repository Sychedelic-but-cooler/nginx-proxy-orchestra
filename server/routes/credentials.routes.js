/**
 * Credentials routes
 * Manages generic encrypted credentials for integrations
 */

const { db, logAudit } = require('../db');
const { parseBody, sendJSON, getClientIP } = require('./shared/utils');
const { encryptCredentials } = require('../utils/credential-encryption');

/**
 * Handle credential-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleCredentialRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/credentials' && method === 'GET') {
    return handleGetCredentials(req, res, parsedUrl);
  }

  if (pathname === '/api/credentials' && method === 'POST') {
    return handleCreateCredential(req, res);
  }

  if (pathname.match(/^\/api\/credentials\/\d+$/) && method === 'PUT') {
    return handleUpdateCredential(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/credentials\/\d+$/) && method === 'DELETE') {
    return handleDeleteCredential(req, res, parsedUrl);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get credentials
 * Returns list of credentials (encrypted data not included)
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 */
function handleGetCredentials(req, res, parsedUrl) {
  try {
    const type = parsedUrl.searchParams.get('type');

    let query = 'SELECT id, name, credential_type, provider, created_at, updated_at FROM credentials';
    const params = [];

    if (type) {
      query += ' WHERE credential_type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC';

    const credentials = db.prepare(query).all(...params);

    sendJSON(res, { credentials });
  } catch (error) {
    console.error('Get credentials error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Create credential
 * Creates a new encrypted credential
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleCreateCredential(req, res) {
  try {
    const body = await parseBody(req);
    const { name, credential_type, provider, credentials } = body;

    if (!name || !credential_type || !credentials) {
      return sendJSON(res, { error: 'Name, credential_type, and credentials are required' }, 400);
    }

    // Encrypt credentials
    const encryptedData = encryptCredentials(credentials);

    const result = db.prepare(`
      INSERT INTO credentials (name, credential_type, provider, credentials_encrypted)
      VALUES (?, ?, ?, ?)
    `).run(name, credential_type, provider || null, encryptedData);

    logAudit(req.user.userId, 'create_credential', 'credential', result.lastInsertRowid, null, getClientIP(req));

    sendJSON(res, { success: true, id: result.lastInsertRowid }, 201);
  } catch (error) {
    console.error('Create credential error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Update credential
 * Updates an existing credential
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with ID parameter
 */
async function handleUpdateCredential(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[3];
    const body = await parseBody(req);
    const { name, credential_type, provider, credentials } = body;

    if (!name || !credential_type) {
      return sendJSON(res, { error: 'Name and credential_type are required' }, 400);
    }

    // If credentials provided, encrypt them
    let updateFields = ['name = ?', 'credential_type = ?', 'provider = ?', 'updated_at = CURRENT_TIMESTAMP'];
    let params = [name, credential_type, provider || null];

    if (credentials) {
      const encryptedData = encryptCredentials(credentials);
      updateFields.push('credentials_encrypted = ?');
      params.push(encryptedData);
    }

    params.push(id);

    db.prepare(`
      UPDATE credentials
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `).run(...params);

    logAudit(req.user.userId, 'update_credential', 'credential', id, null, getClientIP(req));

    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Update credential error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Delete credential
 * Deletes a credential if not in use
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with ID parameter
 */
function handleDeleteCredential(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[3];

    // Check if credential is in use
    const inUse = db.prepare(`
      SELECT COUNT(*) as count FROM ban_integrations WHERE credential_id = ?
    `).get(id);

    if (inUse && inUse.count > 0) {
      return sendJSON(res, { error: 'Cannot delete credential that is in use by integrations' }, 400);
    }

    db.prepare('DELETE FROM credentials WHERE id = ?').run(id);

    logAudit(req.user.userId, 'delete_credential', 'credential', id, null, getClientIP(req));

    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Delete credential error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

module.exports = handleCredentialRoutes;
