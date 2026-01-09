/**
 * UFW (Uncomplicated Firewall) Ban Provider
 *
 * Uses UFW deny rules to block IPs
 * Common on Ubuntu/Debian systems
 * Requires sudo access for ufw command
 */

const BanProvider = require('./base-provider');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class UFWProvider extends BanProvider {
  constructor(integration) {
    super(integration);

    // Get insert position from config (default: 1 = highest priority)
    this.insertPosition = this.config.insert_position || 1;

    console.log(`[ufw] Initialized provider with insert position: ${this.insertPosition}`);
  }

  /**
   * Execute ufw command
   */
  async executeCommand(command) {
    const requestId = Math.random().toString(36).substring(7);

    console.log(`\n[ufw Request ${requestId}] ========================================`);
    console.log(`[ufw Request ${requestId}] Command: ${command}`);

    try {
      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(command);
      const elapsed = Date.now() - startTime;

      console.log(`[ufw Response ${requestId}] Time: ${elapsed}ms`);
      if (stdout) console.log(`[ufw Response ${requestId}] Stdout:`, stdout.trim());
      if (stderr) console.log(`[ufw Response ${requestId}] Stderr:`, stderr.trim());
      console.log(`[ufw Response ${requestId}] SUCCESS ✓`);
      console.log(`[ufw Request ${requestId}] ========================================\n`);

      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
      console.error(`[ufw Response ${requestId}] ERROR: ${error.message}`);
      console.error(`[ufw Response ${requestId}] Exit code: ${error.code}`);
      if (error.stdout) console.error(`[ufw Response ${requestId}] Stdout:`, error.stdout);
      if (error.stderr) console.error(`[ufw Response ${requestId}] Stderr:`, error.stderr);
      console.log(`[ufw Request ${requestId}] ========================================\n`);
      throw error;
    }
  }

  /**
   * Test connection (check if ufw is installed and enabled)
   */
  async testConnection() {
    console.log('[ufw] Testing connection...');
    try {
      const { stdout } = await this.executeCommand('sudo ufw status');

      if (stdout.includes('Status: active')) {
        console.log('[ufw] Connection test successful');
        return {
          success: true,
          message: 'UFW is active and running'
        };
      }

      if (stdout.includes('Status: inactive')) {
        return {
          success: false,
          message: 'UFW is installed but not enabled. Run: sudo ufw enable'
        };
      }

      return {
        success: false,
        message: 'Unable to determine UFW status'
      };
    } catch (error) {
      console.error('[ufw] Connection test failed:', error.message);
      return {
        success: false,
        message: `UFW not available: ${error.message}`
      };
    }
  }

  /**
   * Ban an IP address using deny rule
   */
  async banIP(ip, options = {}) {
    console.log(`[ufw] Banning IP: ${ip}`);
    try {
      const { reason, duration } = options;

      // UFW doesn't support comments in CLI, but we can add via numbered insert
      let command = `sudo ufw insert ${this.insertPosition} deny from ${ip}`;

      await this.executeCommand(command);

      console.log(`[ufw] IP ${ip} banned successfully`);

      // Note: UFW doesn't support native expiry, so duration is stored in our DB only
      if (duration) {
        console.log(`[ufw] Note: UFW doesn't support native expiry. Duration ${duration}s will be managed by ban system.`);
      }

      return {
        success: true,
        message: `IP ${ip} banned successfully`,
        ban_id: ip  // Use IP as ban_id
      };
    } catch (error) {
      console.error(`[ufw] Failed to ban IP ${ip}:`, error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Unban an IP address by deleting deny rule
   */
  async unbanIP(ip, ban_id = null) {
    console.log(`[ufw] Unbanning IP: ${ip}`);
    try {
      // Delete the deny rule for this IP
      const command = `sudo ufw delete deny from ${ip}`;
      await this.executeCommand(command);

      console.log(`[ufw] IP ${ip} unbanned successfully`);
      return {
        success: true,
        message: `IP ${ip} unbanned successfully`
      };
    } catch (error) {
      // If rule doesn't exist, ufw returns error, but we can still report success
      if (error.message.includes('Could not delete')) {
        console.log(`[ufw] No rule found for ${ip}, considering it already unbanned`);
        return {
          success: true,
          message: `IP ${ip} was not banned (no rule found)`
        };
      }

      console.error(`[ufw] Failed to unban IP ${ip}:`, error.message);
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
    console.log('[ufw] Fetching list of banned IPs...');
    try {
      // Get numbered status to parse rules
      const { stdout } = await this.executeCommand('sudo ufw status numbered');

      const banRules = [];
      const lines = stdout.split('\n');

      // Parse UFW output
      // Format: [ 1] DENY IN    10.0.0.1
      const ruleRegex = /^\[\s*\d+\]\s+DENY\s+(?:IN|OUT|FORWARD)?\s+(?:from\s+)?(\d+\.\d+\.\d+\.\d+)/i;

      for (const line of lines) {
        const match = line.match(ruleRegex);
        if (match) {
          const ip = match[1];
          // Only include if it looks like a single IP ban (not a subnet)
          if (!ip.includes('/')) {
            banRules.push({
              ip,
              ban_id: ip,
              banned_at: new Date().toISOString()  // UFW doesn't track creation time
            });
          }
        }
      }

      console.log(`[ufw] Found ${banRules.length} ban rules`);
      return banRules;
    } catch (error) {
      console.error('[ufw] Error fetching banned IPs:', error.message);
      return [];
    }
  }

  /**
   * Ban multiple IPs in batch
   */
  async batchBanIPs(bans) {
    console.log(`[ufw] Batch banning ${bans.length} IPs...`);
    const results = {
      success: true,
      message: '',
      banned_count: 0,
      ban_ids: {}
    };

    const failed = [];

    for (let i = 0; i < bans.length; i++) {
      const ban = bans[i];
      console.log(`[ufw] Batch progress: ${i + 1}/${bans.length} - Banning ${ban.ip}`);

      try {
        const result = await this.banIP(ban.ip, ban);

        if (result.success) {
          results.banned_count++;
          results.ban_ids[ban.ip] = result.ban_id;
        } else {
          failed.push({ ip: ban.ip, error: result.message });
        }
      } catch (error) {
        failed.push({ ip: ban.ip, error: error.message });
      }
    }

    if (failed.length > 0) {
      results.success = false;
      results.message = `Banned ${results.banned_count}/${bans.length} IPs. Failed: ${failed.map(f => f.ip).join(', ')}`;
      console.error(`[ufw] Batch ban completed with errors: ${results.message}`);
    } else {
      results.message = `Successfully banned ${results.banned_count} IPs`;
      console.log(`[ufw] Batch ban completed successfully: ${results.message}`);
    }

    return results;
  }

  /**
   * Unban multiple IPs in batch
   */
  async batchUnbanIPs(unbans) {
    console.log(`[ufw] Batch unbanning ${unbans.length} IPs...`);
    const results = {
      success: true,
      message: '',
      unbanned_count: 0
    };

    const failed = [];

    for (let i = 0; i < unbans.length; i++) {
      const unban = unbans[i];
      console.log(`[ufw] Batch progress: ${i + 1}/${unbans.length} - Unbanning ${unban.ip}`);

      try {
        const result = await this.unbanIP(unban.ip, unban.ban_id);

        if (result.success) {
          results.unbanned_count++;
        } else {
          failed.push({ ip: unban.ip, error: result.message });
        }
      } catch (error) {
        failed.push({ ip: unban.ip, error: error.message });
      }
    }

    if (failed.length > 0) {
      results.success = false;
      results.message = `Unbanned ${results.unbanned_count}/${unbans.length} IPs. Failed: ${failed.map(f => f.ip).join(', ')}`;
      console.error(`[ufw] Batch unban completed with errors: ${results.message}`);
    } else {
      results.message = `Successfully unbanned ${results.unbanned_count} IPs`;
      console.log(`[ufw] Batch unban completed successfully: ${results.message}`);
    }

    return results;
  }

  /**
   * Get provider capabilities
   */
  getCapabilities() {
    return {
      supportsBatch: true,
      supportsExpiry: false,  // UFW doesn't have native timeout support
      supportsSync: true
    };
  }
}

module.exports = UFWProvider;
