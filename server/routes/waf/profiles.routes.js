/**
 * WAF profiles routes
 * Manages ModSecurity WAF profiles and configurations
 */

const fs = require('fs');
const path = require('path');
const { db, logAudit } = require('../../db');
const { parseBody, sendJSON, getClientIP } = require('../shared/utils');
const {
  generateProfileConfig,
  generateExclusionConfig,
  getProfileExclusions
} = require('../../utils/modsecurity-config-generator');

/**
 * Handle WAF profile routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleWAFProfileRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/waf/profiles' && method === 'GET') {
    return handleGetWAFProfiles(req, res);
  }

  if (pathname === '/api/waf/profiles' && method === 'POST') {
    return handleCreateWAFProfile(req, res);
  }

  if (pathname.match(/^\/api\/waf\/profiles\/\d+$/) && method === 'PUT') {
    return handleUpdateWAFProfile(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/waf\/profiles\/\d+$/) && method === 'DELETE') {
    return handleDeleteWAFProfile(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/waf\/profiles\/\d+\/config$/) && method === 'GET') {
    return handleGetWAFProfileConfig(req, res, parsedUrl);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get WAF profiles
 * Returns all WAF profiles with proxy usage counts
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetWAFProfiles(req, res) {
  try {
    const profiles = db.prepare(`
      SELECT
        p.*,
        COUNT(DISTINCT ph.id) as proxy_count
      FROM waf_profiles p
      LEFT JOIN proxy_hosts ph ON p.id = ph.waf_profile_id
      GROUP BY p.id
      ORDER BY p.name
    `).all();

    sendJSON(res, { profiles });
  } catch (error) {
    console.error('Get WAF profiles error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Create WAF profile
 * Creates a new ModSecurity profile with configuration files
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleCreateWAFProfile(req, res) {
  try {
    const body = await parseBody(req);
    const { name, description, ruleset, paranoia_level, config_json } = body;

    console.log('Creating WAF profile:', { name, ruleset, paranoia_level });
    console.log('Config JSON:', JSON.stringify(config_json, null, 2));

    // Validation
    if (!name || !ruleset || paranoia_level < 1 || paranoia_level > 4) {
      return sendJSON(res, { error: 'Invalid profile data' }, 400);
    }

    const result = db.prepare(`
      INSERT INTO waf_profiles (name, description, ruleset, paranoia_level, config_json, enabled)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(name, description || '', ruleset, paranoia_level, JSON.stringify(config_json || {}));

    // Regenerate profile config and create empty exclusion file
    try {
      // Get the newly created profile
      const newProfile = db.prepare('SELECT * FROM waf_profiles WHERE id = ?').get(result.lastInsertRowid);

      // Generate profile config
      const profileConfig = generateProfileConfig(newProfile);
      const profilesDir = path.join(__dirname, '../../../data/modsec-profiles');

      // Ensure directory exists
      if (!fs.existsSync(profilesDir)) {
        fs.mkdirSync(profilesDir, { recursive: true });
      }

      // Write profile config
      const profilePath = path.join(profilesDir, `profile_${newProfile.id}.conf`);
      fs.writeFileSync(profilePath, profileConfig, 'utf8');
      console.log(`Generated WAF profile config: ${profilePath}`);

      // Create empty exclusion file
      const exclusions = getProfileExclusions(db, newProfile.id);
      const exclusionPath = path.join(profilesDir, `exclusions_profile_${newProfile.id}.conf`);
      generateExclusionConfig(exclusions, exclusionPath);
      console.log(`Generated WAF exclusion file: ${exclusionPath}`);
    } catch (err) {
      console.error('Failed to generate WAF profile config:', err);
    }

    logAudit(
      req.user.userId,
      'create_waf_profile',
      'waf_profile',
      result.lastInsertRowid,
      null,
      getClientIP(req)
    );

    sendJSON(res, {
      success: true,
      profile: { id: result.lastInsertRowid, name }
    }, 201);
  } catch (error) {
    console.error('Create WAF profile error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Update WAF profile
 * Updates a ModSecurity profile and regenerates configuration
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with profile ID
 */
async function handleUpdateWAFProfile(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];
    const body = await parseBody(req);

    console.log(`Updating WAF profile ${id}:`, { name: body.name, ruleset: body.ruleset, paranoia_level: body.paranoia_level });
    console.log('Config JSON:', JSON.stringify(body.config_json, null, 2));

    db.prepare(`
      UPDATE waf_profiles
      SET name = ?, description = ?, ruleset = ?,
          paranoia_level = ?, config_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(body.name, body.description || '', body.ruleset,
           body.paranoia_level, JSON.stringify(body.config_json || {}), id);

    // Regenerate profile config and exclusion file
    try {
      const { reloadManager } = require('../../utils/nginx-reload-manager');

      // Get the updated profile
      const updatedProfile = db.prepare('SELECT * FROM waf_profiles WHERE id = ?').get(id);

      // Generate profile config
      const profileConfig = generateProfileConfig(updatedProfile);
      const profilesDir = path.join(__dirname, '../../../data/modsec-profiles');

      // Ensure directory exists
      if (!fs.existsSync(profilesDir)) {
        fs.mkdirSync(profilesDir, { recursive: true });
      }

      // Write profile config
      const profilePath = path.join(profilesDir, `profile_${updatedProfile.id}.conf`);
      fs.writeFileSync(profilePath, profileConfig, 'utf8');
      console.log(`Updated WAF profile config: ${profilePath}`);

      // Ensure exclusion file exists
      const exclusions = getProfileExclusions(db, updatedProfile.id);
      const exclusionPath = path.join(profilesDir, `exclusions_profile_${updatedProfile.id}.conf`);
      generateExclusionConfig(exclusions, exclusionPath);
      console.log(`Updated WAF exclusion file: ${exclusionPath}`);

      // Reload nginx to apply changes
      await reloadManager.queueReload();
    } catch (err) {
      console.error('Failed to update WAF profile config:', err);
    }

    logAudit(req.user.userId, 'update_waf_profile', 'waf_profile', id, null, getClientIP(req));
    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Update WAF profile error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Delete WAF profile
 * Removes a profile after checking it's not in use
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with profile ID
 */
function handleDeleteWAFProfile(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    // Check if profile is in use
    const inUse = db.prepare('SELECT COUNT(*) as count FROM proxy_hosts WHERE waf_profile_id = ?')
                    .get(id);

    if (inUse.count > 0) {
      return sendJSON(res, {
        error: `Profile is assigned to ${inUse.count} proxy(s). Remove assignments first.`
      }, 400);
    }

    db.prepare('DELETE FROM waf_profiles WHERE id = ?').run(id);

    logAudit(req.user.userId, 'delete_waf_profile', 'waf_profile', id, null, getClientIP(req));
    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Delete WAF profile error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get WAF profile config
 * Returns the generated ModSecurity configuration file content
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with profile ID
 */
function handleGetWAFProfileConfig(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    // Check if profile exists
    const profile = db.prepare('SELECT * FROM waf_profiles WHERE id = ?').get(id);
    if (!profile) {
      return sendJSON(res, { error: 'Profile not found' }, 404);
    }

    // Read the profile config file
    const profilePath = path.join(__dirname, '../../../data/modsec-profiles', `profile_${id}.conf`);

    if (!fs.existsSync(profilePath)) {
      return sendJSON(res, {
        error: 'Profile config file not found',
        message: 'The configuration file has not been generated yet. Try editing and saving the profile.'
      }, 404);
    }

    const configContent = fs.readFileSync(profilePath, 'utf8');

    sendJSON(res, {
      profile_id: id,
      profile_name: profile.name,
      config_path: profilePath,
      config_content: configContent
    });
  } catch (error) {
    console.error('Get WAF profile config error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

module.exports = handleWAFProfileRoutes;
