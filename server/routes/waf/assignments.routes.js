/**
 * WAF assignments routes
 * Manages WAF profile assignments to proxy hosts
 */

const { db, logAudit } = require('../../db');
const { parseBody, sendJSON, getClientIP } = require('../shared/utils');

/**
 * Handle WAF assignment routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleWAFAssignmentRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname.match(/^\/api\/proxies\/\d+\/waf$/) && method === 'GET') {
    return handleGetProxyWAFProfiles(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/proxies\/\d+\/waf$/) && method === 'POST') {
    return handleAssignWAFProfile(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/proxies\/\d+\/waf$/) && method === 'DELETE') {
    return handleRemoveWAFProfile(req, res, parsedUrl);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get proxy WAF profile
 * Returns the WAF profile assigned to a proxy
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with proxy ID
 */
function handleGetProxyWAFProfiles(req, res, parsedUrl) {
  try {
    const proxyId = parsedUrl.pathname.split('/')[3];

    // Get assigned profile (single)
    const profile = db.prepare(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.paranoia_level,
        p.enabled
      FROM waf_profiles p
      INNER JOIN proxy_hosts ph ON p.id = ph.waf_profile_id
      WHERE ph.id = ?
    `).get(proxyId);

    sendJSON(res, { profile: profile || null });
  } catch (error) {
    console.error('Get proxy WAF profile error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Assign WAF profile to proxy
 * Assigns a WAF profile to a proxy host and regenerates configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with proxy ID
 */
async function handleAssignWAFProfile(req, res, parsedUrl) {
  try {
    const proxyId = parsedUrl.pathname.split('/')[3];
    const body = await parseBody(req);
    const { profile_id } = body;

    // Validate profile exists
    const profileExists = db.prepare(`
      SELECT id FROM waf_profiles WHERE id = ?
    `).get(profile_id);

    if (!profileExists) {
      return sendJSON(res, { error: 'WAF profile not found' }, 404);
    }

    // Update proxy with the profile (replaces any existing assignment)
    db.prepare(`
      UPDATE proxy_hosts
      SET waf_profile_id = ?
      WHERE id = ?
    `).run(profile_id, proxyId);

    // Regenerate proxy nginx config with WAF using centralized utility
    const { regenerateProxyConfig } = require('../../utils/proxy-config-regenerator');
    const regenResult = await regenerateProxyConfig(proxyId);

    if (!regenResult.success && !regenResult.skipped) {
      console.error('Failed to regenerate proxy config:', regenResult.error);
      // Don't fail the request - WAF profile was assigned in database
      // User can manually regenerate or update the proxy
    }

    logAudit(
      req.user.userId,
      'assign_waf_profile',
      'proxy',
      proxyId,
      `Assigned profile ${profile_id}`,
      getClientIP(req)
    );

    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Assign WAF profile error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Remove WAF profile from proxy
 * Removes the WAF profile assignment and regenerates configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with proxy ID
 */
async function handleRemoveWAFProfile(req, res, parsedUrl) {
  try {
    const proxyId = parsedUrl.pathname.split('/')[3];

    // Clear the waf_profile_id column
    db.prepare(`
      UPDATE proxy_hosts
      SET waf_profile_id = NULL
      WHERE id = ?
    `).run(proxyId);

    // Regenerate proxy config without WAF using centralized utility
    const { regenerateProxyConfig } = require('../../utils/proxy-config-regenerator');
    const regenResult = await regenerateProxyConfig(proxyId);

    if (!regenResult.success && !regenResult.skipped) {
      console.error('Failed to regenerate proxy config:', regenResult.error);
      // Don't fail the request - WAF profile was removed from database
      // User can manually regenerate or update the proxy
    }

    logAudit(
      req.user.userId,
      'remove_waf_profile',
      'proxy',
      proxyId,
      'Removed WAF profile assignment',
      getClientIP(req)
    );

    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Remove WAF profile error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

module.exports = handleWAFAssignmentRoutes;
