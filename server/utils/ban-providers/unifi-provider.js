/**
 * UniFi (Ubiquiti) Firewall Ban Provider
 *
 * Supports both Cloud Controller and Local Controller APIs
 *
 * Cloud API: https://developer.ui.com/site-manager-api/gettingstarted
 * Local API: https://www.ubntwiki.com/products/software/unifi-controller/api
 */

const BanProvider = require('./base-provider');

class UniFiProvider extends BanProvider {
  constructor(integration) {
    super(integration);

    // Validate required credentials
    if (!this.credentials.api_url) {
      throw new Error('UniFi API URL is required');
    }
    if (!this.credentials.api_key) {
      throw new Error('UniFi API key is required');
    }
    if (!this.credentials.site_id) {
      throw new Error('UniFi Site ID is required');
    }

    // Ensure API URL doesn't have trailing slash
    this.baseUrl = this.credentials.api_url.replace(/\/$/, '');

    // Detect controller type based on URL
    this.isCloudController = this.baseUrl.includes('api.ui.com');

    // Network ID only required for cloud controller
    if (this.isCloudController && !this.credentials.network_id) {
      throw new Error('UniFi Network ID is required for cloud controller');
    }

    // Rule priority from config (default: 1 = highest)
    this.rulePriority = this.config.rule_priority || 1;

    console.log(`[UniFi] Initialized provider for ${this.isCloudController ? 'CLOUD' : 'LOCAL'} controller`);
    console.log(`[UniFi] Base URL: ${this.baseUrl}`);
    console.log(`[UniFi] Site ID: ${this.credentials.site_id}`);
  }

  /**
   * Make HTTP request to UniFi API with detailed logging
   */
  async makeRequest(method, endpoint, data = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const requestId = Math.random().toString(36).substring(7);

    console.log(`\n[UniFi Request ${requestId}] ========================================`);
    console.log(`[UniFi Request ${requestId}] Method: ${method}`);
    console.log(`[UniFi Request ${requestId}] URL: ${url}`);
    console.log(`[UniFi Request ${requestId}] Controller Type: ${this.isCloudController ? 'CLOUD' : 'LOCAL'}`);

    // Cloud controller uses X-API-KEY header, local uses session or bearer
    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.isCloudController) {
      headers['X-API-KEY'] = this.credentials.api_key;
      console.log(`[UniFi Request ${requestId}] Auth: X-API-KEY header (cloud)`);
    } else {
      headers['Authorization'] = `Bearer ${this.credentials.api_key}`;
      console.log(`[UniFi Request ${requestId}] Auth: Bearer token (local)`);
    }

    const options = {
      method,
      headers
    };

    if (data) {
      options.body = JSON.stringify(data);
      console.log(`[UniFi Request ${requestId}] Body:`, JSON.stringify(data, null, 2));
    }

    try {
      const startTime = Date.now();
      const response = await fetch(url, options);
      const elapsed = Date.now() - startTime;

      console.log(`[UniFi Response ${requestId}] Status: ${response.status} ${response.statusText}`);
      console.log(`[UniFi Response ${requestId}] Time: ${elapsed}ms`);
      console.log(`[UniFi Response ${requestId}] Headers:`, JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2));

      let responseData;
      const contentType = response.headers.get('content-type');

      if (contentType && contentType.includes('application/json')) {
        responseData = await response.json();
        console.log(`[UniFi Response ${requestId}] Body:`, JSON.stringify(responseData, null, 2));
      } else {
        const text = await response.text();
        console.log(`[UniFi Response ${requestId}] Body (non-JSON):`, text);
        responseData = { raw: text };
      }

      if (!response.ok) {
        const errorMsg = responseData.message || responseData.error || `HTTP ${response.status}: ${response.statusText}`;
        console.error(`[UniFi Response ${requestId}] ERROR: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      console.log(`[UniFi Response ${requestId}] SUCCESS ✓`);
      console.log(`[UniFi Request ${requestId}] ========================================\n`);

      return responseData;
    } catch (error) {
      console.error(`[UniFi Response ${requestId}] EXCEPTION: ${error.message}`);
      console.error(`[UniFi Response ${requestId}] Stack:`, error.stack);
      console.log(`[UniFi Request ${requestId}] ========================================\n`);
      throw new Error(`UniFi API request failed: ${error.message}`);
    }
  }

  /**
   * Test connection to UniFi API
   */
  async testConnection() {
    console.log('[UniFi] Testing connection...');
    try {
      // For cloud controller, test with sites endpoint
      // For local controller, test with firewall rules endpoint
      let endpoint;

      if (this.isCloudController) {
        endpoint = `/v1/sites/${this.credentials.site_id}`;
      } else {
        // Local controller uses different path structure
        endpoint = `/api/s/${this.credentials.site_id}/stat/health`;
      }

      const response = await this.makeRequest('GET', endpoint);

      // Check response structure
      if (response) {
        let siteName = 'Unknown';

        if (response.name) siteName = response.name;
        else if (response.data && response.data[0]) siteName = 'Controller';

        console.log('[UniFi] Connection test successful');
        return {
          success: true,
          message: `Connected to UniFi ${this.isCloudController ? 'cloud' : 'local'} controller: ${siteName}`
        };
      }

      console.log('[UniFi] Connection test failed: Unable to verify access');
      return {
        success: false,
        message: 'Unable to verify site access'
      };
    } catch (error) {
      console.error('[UniFi] Connection test failed:', error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Ban an IP address by creating a firewall rule
   */
  async banIP(ip, options = {}) {
    console.log(`[UniFi] Banning IP: ${ip}`);
    try {
      const { reason, duration } = options;

      // Create firewall rule data
      const ruleData = {
        name: `WAF-Ban-${ip}`,
        action: 'drop',  // lowercase for UniFi API
        enabled: true,
        ruleset: 'WAN_IN',  // Apply to WAN incoming traffic
        description: reason || 'Banned by Nginx Proxy Orchestra WAF'
      };

      // Local controller structure
      if (!this.isCloudController) {
        ruleData.rule_index = this.rulePriority;
        ruleData.protocol = 'all';
        ruleData.src_address = ip;
        ruleData.dst_address = 'any';
      } else {
        // Cloud controller structure
        ruleData.priority = this.rulePriority;
        ruleData.ip_sec = {
          match_src_address: ip
        };
        if (this.credentials.network_id) {
          ruleData.network_id = this.credentials.network_id;
        }
      }

      // Add expiration note (UniFi doesn't natively support expiry)
      if (duration) {
        const expiresAt = new Date(Date.now() + duration * 1000).toISOString();
        ruleData.description += ` [Expires: ${expiresAt}]`;
      }

      console.log(`[UniFi] Rule data prepared for ${this.isCloudController ? 'CLOUD' : 'LOCAL'} controller`);

      // Determine endpoint
      const endpoint = this.isCloudController
        ? `/v1/sites/${this.credentials.site_id}/firewall/rules`
        : `/api/s/${this.credentials.site_id}/rest/firewallrule`;

      const response = await this.makeRequest('POST', endpoint, ruleData);

      // Extract rule ID (cloud uses 'id', local uses '_id')
      const ruleId = response.id || response._id || (response.data && response.data[0] && (response.data[0].id || response.data[0]._id));

      console.log(`[UniFi] IP ${ip} banned successfully. Rule ID: ${ruleId}`);

      return {
        success: true,
        message: `IP ${ip} banned successfully`,
        ban_id: ruleId || ip
      };
    } catch (error) {
      console.error(`[UniFi] Failed to ban IP ${ip}:`, error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Unban an IP address by deleting the firewall rule
   */
  async unbanIP(ip, ban_id = null) {
    console.log(`[UniFi] Unbanning IP: ${ip}, ban_id: ${ban_id || 'not provided'}`);
    try {
      // If we have the rule ID, delete it directly
      if (ban_id && ban_id !== ip) {
        const endpoint = this.isCloudController
          ? `/v1/sites/${this.credentials.site_id}/firewall/rules/${ban_id}`
          : `/api/s/${this.credentials.site_id}/rest/firewallrule/${ban_id}`;

        await this.makeRequest('DELETE', endpoint);

        console.log(`[UniFi] IP ${ip} unbanned successfully (direct delete)`);
        return {
          success: true,
          message: `IP ${ip} unbanned successfully`
        };
      }

      // Otherwise, find the rule by IP and delete it
      console.log(`[UniFi] No ban_id provided, searching for rule by IP...`);
      const rules = await this.getBannedIPs();
      const matchingRule = rules.find(r => r.ip === ip);

      if (matchingRule) {
        console.log(`[UniFi] Found matching rule: ${matchingRule.ban_id}`);
        const endpoint = this.isCloudController
          ? `/v1/sites/${this.credentials.site_id}/firewall/rules/${matchingRule.ban_id}`
          : `/api/s/${this.credentials.site_id}/rest/firewallrule/${matchingRule.ban_id}`;

        await this.makeRequest('DELETE', endpoint);

        console.log(`[UniFi] IP ${ip} unbanned successfully`);
        return {
          success: true,
          message: `IP ${ip} unbanned successfully`
        };
      }

      console.log(`[UniFi] No firewall rule found for IP ${ip}`);
      return {
        success: false,
        message: `No firewall rule found for IP ${ip}`
      };
    } catch (error) {
      console.error(`[UniFi] Failed to unban IP ${ip}:`, error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Get list of currently banned IPs
   */
  async getBannedIPs() {
    console.log('[UniFi] Fetching list of banned IPs...');
    try {
      let endpoint = this.isCloudController
        ? `/v1/sites/${this.credentials.site_id}/firewall/rules`
        : `/api/s/${this.credentials.site_id}/rest/firewallrule`;

      // Add network filter for cloud controller
      if (this.isCloudController && this.credentials.network_id) {
        endpoint += `?network_id=${this.credentials.network_id}`;
      }

      const response = await this.makeRequest('GET', endpoint);

      // Response structure differs between cloud and local
      const rules = response.data || response || [];

      console.log(`[UniFi] Retrieved ${rules.length} total firewall rules`);

      // Filter for rules created by our ban system (look for our naming pattern)
      const banRules = rules
        .filter(rule => rule.name && rule.name.startsWith('WAF-Ban-'))
        .map(rule => {
          // Extract IP from different possible fields
          const ip = rule.src_address ||
                    (rule.ip_sec && rule.ip_sec.match_src_address) ||
                    rule.name.replace('WAF-Ban-', '');

          return {
            ip,
            ban_id: rule.id || rule._id,
            banned_at: rule.created_at || rule.timestamp || new Date().toISOString()
          };
        });

      console.log(`[UniFi] Found ${banRules.length} WAF ban rules`);
      return banRules;
    } catch (error) {
      console.error('[UniFi] Error fetching banned IPs:', error.message);
      return [];
    }
  }

  /**
   * Ban multiple IPs in batch
   * UniFi doesn't have a native batch API, so we'll implement sequential with delay
   */
  async batchBanIPs(bans) {
    console.log(`[UniFi] Batch banning ${bans.length} IPs...`);
    const results = {
      success: true,
      message: '',
      banned_count: 0,
      ban_ids: {}
    };

    const failed = [];

    for (let i = 0; i < bans.length; i++) {
      const ban = bans[i];
      console.log(`[UniFi] Batch progress: ${i + 1}/${bans.length} - Banning ${ban.ip}`);

      try {
        const result = await this.banIP(ban.ip, ban);

        if (result.success) {
          results.banned_count++;
          results.ban_ids[ban.ip] = result.ban_id;
        } else {
          failed.push({ ip: ban.ip, error: result.message });
        }

        // Small delay between requests to avoid rate limiting
        if (i < bans.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        failed.push({ ip: ban.ip, error: error.message });
      }
    }

    if (failed.length > 0) {
      results.success = false;
      results.message = `Banned ${results.banned_count}/${bans.length} IPs. Failed: ${failed.map(f => f.ip).join(', ')}`;
      console.error(`[UniFi] Batch ban completed with errors: ${results.message}`);
    } else {
      results.message = `Successfully banned ${results.banned_count} IPs`;
      console.log(`[UniFi] Batch ban completed successfully: ${results.message}`);
    }

    return results;
  }

  /**
   * Unban multiple IPs in batch
   */
  async batchUnbanIPs(unbans) {
    console.log(`[UniFi] Batch unbanning ${unbans.length} IPs...`);
    const results = {
      success: true,
      message: '',
      unbanned_count: 0
    };

    const failed = [];

    for (let i = 0; i < unbans.length; i++) {
      const unban = unbans[i];
      console.log(`[UniFi] Batch progress: ${i + 1}/${unbans.length} - Unbanning ${unban.ip}`);

      try {
        const result = await this.unbanIP(unban.ip, unban.ban_id);

        if (result.success) {
          results.unbanned_count++;
        } else {
          failed.push({ ip: unban.ip, error: result.message });
        }

        // Small delay between requests
        if (i < unbans.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        failed.push({ ip: unban.ip, error: error.message });
      }
    }

    if (failed.length > 0) {
      results.success = false;
      results.message = `Unbanned ${results.unbanned_count}/${unbans.length} IPs. Failed: ${failed.map(f => f.ip).join(', ')}`;
      console.error(`[UniFi] Batch unban completed with errors: ${results.message}`);
    } else {
      results.message = `Successfully unbanned ${results.unbanned_count} IPs`;
      console.log(`[UniFi] Batch unban completed successfully: ${results.message}`);
    }

    return results;
  }

  /**
   * Get provider capabilities
   */
  getCapabilities() {
    return {
      supportsBatch: true,  // We implement sequential batch processing
      supportsExpiry: false,  // UniFi doesn't natively support timed rules
      supportsSync: true
    };
  }
}

module.exports = UniFiProvider;
