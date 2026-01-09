/**
 * Base Provider for Ban Integrations
 *
 * All ban integration providers extend this class
 */

class BanProvider {
  constructor(integration) {
    this.integration = integration;

    // Load credentials from database if credential_id is set
    if (integration.credential_id) {
      const { db } = require('../../db');
      const { decryptCredentials } = require('../credential-encryption');

      const credential = db.prepare('SELECT * FROM credentials WHERE id = ?')
        .get(integration.credential_id);

      if (credential) {
        this.credentials = decryptCredentials(credential.credentials_encrypted);
      } else {
        throw new Error(`Credential ${integration.credential_id} not found`);
      }
    } else {
      this.credentials = {};
    }

    // Parse additional config (non-sensitive settings)
    this.config = JSON.parse(integration.config_json || '{}');
  }

  /**
   * Test connection to the provider
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented by provider');
  }

  /**
   * Ban an IP address
   * @param {string} ip - IP address to ban
   * @param {object} options - Ban options {reason, duration}
   * @returns {Promise<{success: boolean, message: string, ban_id?: string}>}
   */
  async banIP(ip, options = {}) {
    throw new Error('banIP() must be implemented by provider');
  }

  /**
   * Unban an IP address
   * @param {string} ip - IP address to unban
   * @param {string} ban_id - Provider-specific ban ID (if applicable)
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async unbanIP(ip, ban_id = null) {
    throw new Error('unbanIP() must be implemented by provider');
  }

  /**
   * Get list of currently banned IPs
   * @returns {Promise<Array<{ip: string, ban_id: string, banned_at: string}>>}
   */
  async getBannedIPs() {
    throw new Error('getBannedIPs() must be implemented by provider');
  }

  /**
   * Ban multiple IPs in a single request (optional, override if supported)
   * @param {Array<{ip: string, reason: string, duration: number}>} bans
   * @returns {Promise<{success: boolean, message: string, banned_count: number, ban_ids: object}>}
   */
  async batchBanIPs(bans) {
    // Default implementation: not supported, will fall back to individual bans
    return null;
  }

  /**
   * Unban multiple IPs in a single request (optional, override if supported)
   * @param {Array<{ip: string, ban_id: string}>} unbans
   * @returns {Promise<{success: boolean, message: string, unbanned_count: number}>}
   */
  async batchUnbanIPs(unbans) {
    // Default implementation: not supported, will fall back to individual unbans
    return null;
  }

  /**
   * Get provider capabilities
   */
  getCapabilities() {
    return {
      supportsBatch: typeof this.batchBanIPs === 'function' && this.batchBanIPs !== BanProvider.prototype.batchBanIPs,
      supportsExpiry: true,  // Most providers support timed bans
      supportsSync: true     // Most providers can list banned IPs
    };
  }
}

module.exports = BanProvider;
