/**
 * DNS routes
 * Manages DNS providers and credentials for DNS-01 challenge
 */

const { db, logAudit } = require('../db');
const { parseBody, sendJSON, getClientIP } = require('./shared/utils');
const {
  getProviders,
  getProvider,
  validateCredentials
} = require('../utils/dns-providers');
const {
  encryptCredentials,
  isEncryptionConfigured
} = require('../utils/credential-encryption');

/**
 * Handle DNS-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleDNSRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/dns-providers' && method === 'GET') {
    return handleGetDNSProviders(req, res);
  }

  if (pathname === '/api/dns-credentials' && method === 'GET') {
    return handleGetDNSCredentials(req, res);
  }

  if (pathname === '/api/dns-credentials' && method === 'POST') {
    return handleCreateDNSCredential(req, res);
  }

  if (pathname.match(/^\/api\/dns-credentials\/\d+$/) && method === 'PUT') {
    return handleUpdateDNSCredential(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/dns-credentials\/\d+$/) && method === 'DELETE') {
    return handleDeleteDNSCredential(req, res, parsedUrl);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get DNS providers
 * Returns list of supported DNS providers
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetDNSProviders(req, res) {
  try {
    const providers = getProviders();
    sendJSON(res, { providers });
  } catch (error) {
    console.error('Get DNS providers error:', error);
    sendJSON(res, { error: error.message || 'Failed to get DNS providers' }, 500);
  }
}

/**
 * Get DNS credentials
 * Returns list of DNS credentials (encrypted data not included)
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetDNSCredentials(req, res) {
  try {
    // Check if encryption is configured
    if (!isEncryptionConfigured()) {
      return sendJSON(res, {
        error: 'Encryption not configured. Please set CERT_ENCRYPTION_KEY in .env file',
        credentials: []
      }, 500);
    }

    // Use unified credentials table with dns credential_type filter
    const credentials = db.prepare(`
      SELECT
        id,
        name,
        provider,
        created_at,
        updated_at
      FROM credentials
      WHERE credential_type = 'dns'
      ORDER BY created_at DESC
    `).all();

    sendJSON(res, { credentials });
  } catch (error) {
    console.error('Get DNS credentials error:', error);
    sendJSON(res, { error: error.message || 'Failed to get DNS credentials' }, 500);
  }
}

/**
 * Create DNS credential
 * Creates a new DNS provider credential
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleCreateDNSCredential(req, res) {
  try {
    const body = await parseBody(req);
    const { name, provider, credentials } = body;

    // Validate inputs
    if (!name || !provider || !credentials) {
      return sendJSON(res, { error: 'Name, provider, and credentials are required' }, 400);
    }

    // Check if encryption is configured
    if (!isEncryptionConfigured()) {
      return sendJSON(res, {
        error: 'Encryption not configured. Please set CERT_ENCRYPTION_KEY in .env file'
      }, 500);
    }

    // Validate provider
    const providerDef = getProvider(provider);
    if (!providerDef) {
      return sendJSON(res, { error: `Unknown provider: ${provider}` }, 400);
    }

    // Validate credentials
    const validation = validateCredentials(provider, credentials);
    if (!validation.valid) {
      return sendJSON(res, {
        error: 'Invalid credentials',
        details: validation.errors
      }, 400);
    }

    // Check for duplicate name
    const existing = db.prepare(
      'SELECT id FROM dns_credentials WHERE name = ?'
    ).get(name);

    if (existing) {
      return sendJSON(res, { error: 'Credential with this name already exists' }, 400);
    }

    // Encrypt credentials
    const encrypted = encryptCredentials(credentials);

    // Insert into database
    const result = db.prepare(`
      INSERT INTO dns_credentials (name, provider, credentials_encrypted, created_by)
      VALUES (?, ?, ?, ?)
    `).run(name, provider, encrypted, req.user.userId);

    logAudit(req.user.userId, 'create', 'dns_credential', result.lastInsertRowid, null, getClientIP(req));

    sendJSON(res, {
      success: true,
      message: 'DNS credential created successfully',
      id: result.lastInsertRowid
    }, 201);
  } catch (error) {
    console.error('Create DNS credential error:', error);
    sendJSON(res, { error: error.message || 'Failed to create DNS credential' }, 500);
  }
}

/**
 * Update DNS credential
 * Updates an existing DNS credential
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with ID parameter
 */
async function handleUpdateDNSCredential(req, res, parsedUrl) {
  try {
    const id = parseInt(parsedUrl.pathname.split('/').pop());
    const body = await parseBody(req);
    const { name, credentials } = body;

    // Check if credential exists
    const existing = db.prepare('SELECT * FROM dns_credentials WHERE id = ?').get(id);
    if (!existing) {
      return sendJSON(res, { error: 'DNS credential not found' }, 404);
    }

    // Check if encryption is configured
    if (!isEncryptionConfigured()) {
      return sendJSON(res, {
        error: 'Encryption not configured. Please set CERT_ENCRYPTION_KEY in .env file'
      }, 500);
    }

    // Build update query
    const updates = [];
    const params = [];

    if (name) {
      // Check for duplicate name
      const duplicate = db.prepare(
        'SELECT id FROM dns_credentials WHERE name = ? AND id != ?'
      ).get(name, id);

      if (duplicate) {
        return sendJSON(res, { error: 'Credential with this name already exists' }, 400);
      }

      updates.push('name = ?');
      params.push(name);
    }

    if (credentials) {
      // Validate credentials
      const validation = validateCredentials(existing.provider, credentials);
      if (!validation.valid) {
        return sendJSON(res, {
          error: 'Invalid credentials',
          details: validation.errors
        }, 400);
      }

      // Encrypt credentials
      const encrypted = encryptCredentials(credentials);
      updates.push('credentials_encrypted = ?');
      params.push(encrypted);
    }

    if (updates.length === 0) {
      return sendJSON(res, { error: 'No updates provided' }, 400);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    db.prepare(`
      UPDATE dns_credentials
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params);

    logAudit(req.user.userId, 'update', 'dns_credential', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'DNS credential updated successfully' });
  } catch (error) {
    console.error('Update DNS credential error:', error);
    sendJSON(res, { error: error.message || 'Failed to update DNS credential' }, 500);
  }
}

/**
 * Delete DNS credential
 * Deletes a DNS credential if not in use
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with ID parameter
 */
function handleDeleteDNSCredential(req, res, parsedUrl) {
  try {
    const id = parseInt(parsedUrl.pathname.split('/').pop());

    // Check if credential exists
    const existing = db.prepare('SELECT * FROM dns_credentials WHERE id = ?').get(id);
    if (!existing) {
      return sendJSON(res, { error: 'DNS credential not found' }, 404);
    }

    // Check if credential is in use
    const inUse = db.prepare(`
      SELECT COUNT(*) as count
      FROM ssl_certificates
      WHERE dns_credential_id = ? AND auto_renew = 1
    `).get(id);

    if (inUse.count > 0) {
      return sendJSON(res, {
        error: `Cannot delete credential: in use by ${inUse.count} certificate(s) with auto-renewal enabled`
      }, 400);
    }

    // Delete credential
    db.prepare('DELETE FROM dns_credentials WHERE id = ?').run(id);

    logAudit(req.user.userId, 'delete', 'dns_credential', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'DNS credential deleted successfully' });
  } catch (error) {
    console.error('Delete DNS credential error:', error);
    sendJSON(res, { error: error.message || 'Failed to delete DNS credential' }, 500);
  }
}

module.exports = handleDNSRoutes;
