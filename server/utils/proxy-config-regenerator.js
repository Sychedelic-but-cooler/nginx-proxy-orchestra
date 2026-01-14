/**
 * Proxy Configuration Regeneration Utility
 *
 * Centralized function for regenerating nginx configuration files for proxy hosts.
 * This ensures consistent behavior across all endpoints that modify proxy settings.
 *
 * Handles:
 * - Config generation based on proxy type (reverse/stream/404)
 * - SSL certificate placeholder replacement
 * - Module loading
 * - File writing and enabling/disabling
 * - Nginx reload queueing
 */

const { db } = require('../db');
const {
  generateServerBlock,
  generateStreamBlock,
  generate404Block,
  writeNginxConfig,
  enableNginxConfig,
  disableNginxConfig,
  sanitizeFilename
} = require('./nginx-parser');
const { testNginxConfig } = require('./nginx-ops');
const { reloadManager } = require('./nginx-reload-manager');

/**
 * Regenerate nginx configuration for a proxy host
 * 
 * This function:
 * 1. Fetches the latest proxy data from database
 * 2. Fetches associated modules
 * 3. Generates appropriate config based on proxy type
 * 4. Replaces SSL certificate placeholders with actual paths
 * 5. Writes config file to disk
 * 6. Enables or disables config based on proxy.enabled
 * 7. Tests nginx configuration
 * 8. Queues nginx reload
 * 9. Updates database status
 *
 * @param {number} proxyId - The proxy host ID
 * @param {Object} options - Optional configuration
 * @param {boolean} options.skipReload - Skip nginx reload (default: false)
 * @param {boolean} options.skipStatusUpdate - Skip database status update (default: false)
 * @returns {Promise<Object>} Result object with success, reloadId, and optional error
 */
async function regenerateProxyConfig(proxyId, options = {}) {
  const {
    skipReload = false,
    skipStatusUpdate = false
  } = options;

  try {
    // Fetch latest proxy data from database
    const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(proxyId);
    
    if (!proxy) {
      throw new Error(`Proxy with ID ${proxyId} not found`);
    }

    // Skip regeneration for proxies using custom config editor
    // These proxies have domain_names = 'N/A' and store full config in advanced_config
    if (proxy.domain_names === 'N/A' && proxy.advanced_config && proxy.advanced_config.trim()) {
      console.log(`Skipping config regeneration for custom-config proxy: ${proxy.name}`);
      console.log(`This proxy uses the custom config editor. Changes must be made manually.`);
      return {
        success: true,
        skipped: true,
        reason: 'custom_config_editor'
      };
    }

    // Fetch associated modules
    const modules = db.prepare(`
      SELECT m.* FROM modules m
      INNER JOIN proxy_modules pm ON m.id = pm.module_id
      WHERE pm.proxy_id = ?
    `).all(proxyId);

    // Determine config filename
    const configFilename = proxy.config_filename || `${sanitizeFilename(proxy.name)}.conf`;

    // Generate configuration based on proxy type
    let config;
    if (proxy.type === 'stream') {
      config = generateStreamBlock(proxy);
    } else if (proxy.type === '404') {
      config = generate404Block(proxy);
    } else {
      // Default: reverse proxy
      // Pass database instance to enable security and WAF config generation
      config = generateServerBlock(proxy, modules, db);
    }

    // Replace SSL certificate placeholders with actual paths
    if (proxy.ssl_enabled && proxy.ssl_cert_id) {
      const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?')
        .get(proxy.ssl_cert_id);
      
      if (cert) {
        // Use global replace to handle multiple occurrences
        config = config.replace(/\{\{SSL_CERT_PATH\}\}/g, cert.cert_path);
        config = config.replace(/\{\{SSL_KEY_PATH\}\}/g, cert.key_path);
      } else {
        // SSL enabled but certificate not found
        console.warn(`Warning: Proxy ${proxy.name} has ssl_enabled=true but certificate ${proxy.ssl_cert_id} not found`);
      }
    }

    // Write configuration file to disk
    writeNginxConfig(configFilename, config);

    // Enable or disable config based on proxy.enabled flag
    if (proxy.enabled) {
      enableNginxConfig(configFilename);
    } else {
      disableNginxConfig(configFilename);
    }

    // Test nginx configuration
    const testResult = testNginxConfig();
    if (!testResult.success) {
      throw new Error(`Nginx config test failed: ${testResult.error}`);
    }

    // Queue nginx reload (unless skipped)
    let reloadId = null;
    if (!skipReload) {
      const reloadResult = await reloadManager.queueReload();
      reloadId = reloadResult.reloadId;
    }

    // Update database status (unless skipped)
    if (!skipStatusUpdate) {
      db.prepare(`
        UPDATE proxy_hosts
        SET config_status = 'active', config_error = NULL
        WHERE id = ?
      `).run(proxyId);
    }

    console.log(`✓ Successfully regenerated config for proxy: ${proxy.name}`);

    return {
      success: true,
      reloadId,
      filename: configFilename
    };

  } catch (error) {
    console.error(`Error regenerating config for proxy ${proxyId}:`, error);

    // Update database status with error (unless skipped)
    if (!skipStatusUpdate) {
      db.prepare(`
        UPDATE proxy_hosts
        SET config_status = 'error', config_error = ?
        WHERE id = ?
      `).run(error.message || 'Configuration regeneration failed', proxyId);
    }

    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}

/**
 * Regenerate configurations for multiple proxies
 * Useful for bulk operations like security profile updates
 *
 * @param {number[]} proxyIds - Array of proxy IDs
 * @param {Object} options - Optional configuration
 * @returns {Promise<Object>} Results summary
 */
async function regenerateMultipleProxyConfigs(proxyIds, options = {}) {
  const results = {
    total: proxyIds.length,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  // Process all proxies but only reload once at the end
  const regenOptions = {
    ...options,
    skipReload: true  // Skip individual reloads
  };

  for (const proxyId of proxyIds) {
    const result = await regenerateProxyConfig(proxyId, regenOptions);
    
    if (result.success) {
      if (result.skipped) {
        results.skipped++;
      } else {
        results.successful++;
      }
    } else {
      results.failed++;
      results.errors.push({
        proxyId,
        error: result.error
      });
    }
  }

  // Reload nginx once for all changes (unless skipped)
  if (!options.skipReload && results.successful > 0) {
    try {
      const reloadResult = await reloadManager.queueReload();
      results.reloadId = reloadResult.reloadId;
    } catch (error) {
      console.error('Error reloading nginx:', error);
      results.reloadError = error.message;
    }
  }

  console.log(`Bulk regeneration complete: ${results.successful} successful, ${results.failed} failed, ${results.skipped} skipped`);

  return results;
}

module.exports = {
  regenerateProxyConfig,
  regenerateMultipleProxyConfigs
};
