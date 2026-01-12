/**
 * WAF exclusions routes
 * Manages ModSecurity WAF rule exclusions
 */

const path = require('path');
const { db, logAudit } = require('../../db');
const { parseBody, sendJSON, getClientIP } = require('../shared/utils');
const {
  generateServerBlock,
  writeNginxConfig
} = require('../../utils/nginx-parser');
const {
  getProfileExclusions,
  generateExclusionConfig
} = require('../../utils/modsecurity-config-generator');
const { reloadManager } = require('../../utils/nginx-reload-manager');

/**
 * Handle WAF exclusions routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleWAFExclusionsRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/waf/exclusions' && method === 'GET') {
    return handleGetWAFExclusions(req, res, parsedUrl);
  }

  if (pathname === '/api/waf/exclusions' && method === 'POST') {
    return handleCreateWAFExclusion(req, res);
  }

  if (pathname.match(/^\/api\/waf\/exclusions\/\d+$/) && method === 'DELETE') {
    return handleDeleteWAFExclusion(req, res, parsedUrl);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get WAF exclusions
 * Returns all WAF rule exclusions with optional profile filtering
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 */
function handleGetWAFExclusions(req, res, parsedUrl) {
  try {
    const profileId = parsedUrl.searchParams.get('profile_id');

    let query = `
      SELECT
        e.*,
        p.name as profile_name
      FROM waf_exclusions e
      LEFT JOIN waf_profiles p ON e.profile_id = p.id
    `;

    const params = [];
    if (profileId) {
      query += ' WHERE e.profile_id = ?';
      params.push(profileId);
    }

    query += ' ORDER BY e.created_at DESC';

    const exclusions = db.prepare(query).all(...params);
    sendJSON(res, { exclusions });
  } catch (error) {
    console.error('Get WAF exclusions error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Create WAF exclusion
 * Creates a new rule exclusion and regenerates affected proxy configurations
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleCreateWAFExclusion(req, res) {
  try {
    const body = await parseBody(req);
    let { profile_id, proxy_id, rule_id, path_pattern, parameter_name, reason } = body;

    if (!rule_id) {
      return sendJSON(res, { error: 'Rule ID is required' }, 400);
    }

    // Auto-detect profile from proxy if not specified
    if (!profile_id && proxy_id) {
      const proxy = db.prepare('SELECT waf_profile_id FROM proxy_hosts WHERE id = ?').get(proxy_id);
      profile_id = proxy?.waf_profile_id;
    }

    if (!profile_id) {
      return sendJSON(res, { error: 'Profile ID is required (or provide proxy_id to auto-detect)' }, 400);
    }

    const result = db.prepare(`
      INSERT INTO waf_exclusions
      (profile_id, rule_id, path_pattern, parameter_name, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(profile_id, rule_id, path_pattern || null,
           parameter_name || null, reason || null);

    // Regenerate all proxies using this profile
    await regenerateProfileProxyConfigs(profile_id);

    logAudit(
      req.user.userId,
      'create_waf_exclusion',
      'waf_exclusion',
      result.lastInsertRowid,
      null,
      getClientIP(req)
    );

    sendJSON(res, { success: true, id: result.lastInsertRowid }, 201);
  } catch (error) {
    console.error('Create WAF exclusion error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Delete WAF exclusion
 * Removes an exclusion and regenerates affected proxy configurations
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with exclusion ID
 */
async function handleDeleteWAFExclusion(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const exclusion = db.prepare('SELECT profile_id FROM waf_exclusions WHERE id = ?').get(id);

    db.prepare('DELETE FROM waf_exclusions WHERE id = ?').run(id);

    // Regenerate configs for all proxies using this profile
    if (exclusion && exclusion.profile_id) {
      await regenerateProfileProxyConfigs(exclusion.profile_id);
    }

    logAudit(
      req.user.userId,
      'delete_waf_exclusion',
      'waf_exclusion',
      id,
      null,
      getClientIP(req)
    );
    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Delete WAF exclusion error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Regenerate proxy configurations for a WAF profile
 * Regenerates exclusion file and all proxy configs using the profile
 *
 * @param {number} profileId - WAF profile ID
 */
async function regenerateProfileProxyConfigs(profileId) {
  try {
    // Regenerate the exclusion file for this profile FIRST
    try {
      const projectRoot = path.join(__dirname, '../../..');
      const profilesDir = path.join(projectRoot, 'data/modsec-profiles');
      const exclusionPath = path.join(profilesDir, `exclusions_profile_${profileId}.conf`);

      const exclusions = getProfileExclusions(db, profileId);
      generateExclusionConfig(exclusions, exclusionPath);
      console.log(`Regenerated exclusion file: ${exclusionPath} (${exclusions.length} rules)`);
    } catch (exclusionError) {
      console.error('Failed to regenerate exclusion file:', exclusionError);
      // Continue anyway - proxy configs can still be regenerated
    }

    // Get all proxies using this profile
    const proxies = db.prepare(`
      SELECT * FROM proxy_hosts WHERE waf_profile_id = ?
    `).all(profileId);

    for (const proxy of proxies) {
      // Get modules for this proxy
      const modules = db.prepare(`
        SELECT m.* FROM modules m
        JOIN proxy_modules pm ON m.id = pm.module_id
        WHERE pm.proxy_id = ?
      `).all(proxy.id);

      // Generate full server block config
      let config = generateServerBlock(proxy, modules, db);

      // Replace SSL placeholders if needed
      if (proxy.ssl_enabled && proxy.ssl_cert_id) {
        const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?')
          .get(proxy.ssl_cert_id);
        if (cert) {
          config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
          config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
        }
      }

      // Write the config file
      const filename = proxy.config_filename || `${proxy.id}.conf`;
      writeNginxConfig(filename, config);

      console.log(`Regenerated config for proxy: ${proxy.domain_names}`);
    }

    // Reload nginx to apply changes
    await reloadManager.queueReload();

    console.log(`Regenerated configs for ${proxies.length} proxies using profile ${profileId}`);
  } catch (error) {
    console.error('Failed to regenerate profile proxy configs:', error);
  }
}

module.exports = handleWAFExclusionsRoutes;
