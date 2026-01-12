/**
 * IP whitelist routes
 * Manages IP whitelist for ban system
 */

const { db, logAudit } = require('../../db');
const { parseBody, sendJSON, getClientIP } = require('../shared/utils');

/**
 * Handle whitelist routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleWhitelistRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/ban/whitelist' && method === 'GET') {
    return handleGetWhitelist(req, res);
  }

  if (pathname === '/api/ban/whitelist' && method === 'POST') {
    return handleAddToWhitelist(req, res);
  }

  if (pathname.match(/^\/api\/ban\/whitelist\/\d+$/) && method === 'DELETE') {
    return handleRemoveFromWhitelist(req, res, parsedUrl);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get whitelist
 * Returns all whitelisted IPs and ranges
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetWhitelist(req, res) {
  try {
    const whitelist = db.prepare(`
      SELECT
        w.*,
        u.username as added_by_username
      FROM ip_whitelist w
      LEFT JOIN users u ON w.added_by = u.id
      ORDER BY w.priority ASC, w.created_at DESC
    `).all();

    sendJSON(res, { whitelist });
  } catch (error) {
    console.error('Get whitelist error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Add to whitelist
 * Adds an IP address or range to whitelist
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleAddToWhitelist(req, res) {
  try {
    const body = await parseBody(req);
    const { ip_address, ip_range, reason, priority } = body;

    if (!ip_address && !ip_range) {
      return sendJSON(res, { error: 'IP address or IP range is required' }, 400);
    }

    // Check if already whitelisted
    const existing = db.prepare(
      'SELECT id FROM ip_whitelist WHERE ip_address = ? OR ip_range = ?'
    ).get(ip_address || null, ip_range || null);

    if (existing) {
      return sendJSON(res, { error: 'IP or range is already whitelisted' }, 400);
    }

    const result = db.prepare(`
      INSERT INTO ip_whitelist (ip_address, ip_range, type, reason, priority, added_by)
      VALUES (?, ?, 'manual', ?, ?, ?)
    `).run(
      ip_address || null,
      ip_range || null,
      reason || 'Manual whitelist',
      priority || 50,
      req.user.userId
    );

    logAudit(
      req.user.userId,
      'add_to_whitelist',
      'ip_whitelist',
      result.lastInsertRowid,
      JSON.stringify({ ip_address, ip_range, reason }),
      getClientIP(req)
    );

    sendJSON(res, {
      success: true,
      id: result.lastInsertRowid,
      message: 'IP added to whitelist successfully'
    }, 201);
  } catch (error) {
    console.error('Add to whitelist error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Remove from whitelist
 * Removes an IP from whitelist
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with whitelist ID
 */
function handleRemoveFromWhitelist(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const entry = db.prepare('SELECT type FROM ip_whitelist WHERE id = ?').get(id);
    if (!entry) {
      return sendJSON(res, { error: 'Whitelist entry not found' }, 404);
    }

    if (entry.type === 'system') {
      return sendJSON(res, { error: 'Cannot remove system whitelist entries' }, 403);
    }

    db.prepare('DELETE FROM ip_whitelist WHERE id = ?').run(id);

    logAudit(req.user.userId, 'remove_from_whitelist', 'ip_whitelist', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'IP removed from whitelist successfully' });
  } catch (error) {
    console.error('Remove from whitelist error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

module.exports = handleWhitelistRoutes;
