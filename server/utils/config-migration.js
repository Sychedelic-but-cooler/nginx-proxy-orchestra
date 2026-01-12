/**
 * Config Migration Utility
 *
 * Handles lazy migration of existing proxies from structured database fields
 * to raw text editor format
 */

const { generateServerBlock, generateStreamBlock, generate404Block } = require('./nginx-parser');

/**
 * Migrate proxy to text editor format
 *
 * Checks if proxy already has advanced_config populated.
 * If not, generates config from structured fields using existing generation functions.
 *
 * @param {Object} proxyHost - Proxy host record from database
 * @param {Array} modules - Array of module records associated with this proxy
 * @param {Object} db - Database instance
 * @returns {string} - Nginx configuration string
 */
function migrateProxyToTextEditor(proxyHost, modules, db) {
  // Check if advanced_config is already populated
  if (proxyHost.advanced_config && proxyHost.advanced_config.trim()) {
    return proxyHost.advanced_config;
  }

  // Generate config from structured fields using existing functions
  try {
    if (proxyHost.type === 'reverse') {
      return generateServerBlock(proxyHost, modules, db);
    } else if (proxyHost.type === 'stream') {
      return generateStreamBlock(proxyHost);
    } else if (proxyHost.type === '404') {
      return generate404Block(proxyHost);
    } else {
      throw new Error(`Unknown proxy type: ${proxyHost.type}`);
    }
  } catch (error) {
    console.error(`Error migrating proxy ${proxyHost.id} (${proxyHost.name}):`, error.message);
    throw error;
  }
}

module.exports = {
  migrateProxyToTextEditor
};
