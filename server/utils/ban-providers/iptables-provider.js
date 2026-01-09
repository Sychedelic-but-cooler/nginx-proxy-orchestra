/**
 * iptables/ipset Ban Provider
 *
 * Uses ipset for efficient IP blocking with iptables
 * Most universal Linux firewall solution
 * Requires sudo access for iptables and ipset commands
 */

const BanProvider = require('./base-provider');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class IptablesProvider extends BanProvider {
  constructor(integration) {
    super(integration);

    // Get config
    this.ipsetName = this.config.ipset_name || 'waf_blocklist';
    this.chain = this.config.chain || 'INPUT';
    this.action = this.config.action || 'DROP';

    console.log(`[iptables] Initialized provider`);
    console.log(`[iptables] IPSet: ${this.ipsetName}`);
    console.log(`[iptables] Chain: ${this.chain}`);
    console.log(`[iptables] Action: ${this.action}`);
  }

  /**
   * Execute command
   */
  async executeCommand(command) {
    const requestId = Math.random().toString(36).substring(7);

    console.log(`\n[iptables Request ${requestId}] ========================================`);
    console.log(`[iptables Request ${requestId}] Command: ${command}`);

    try {
      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(command);
      const elapsed = Date.now() - startTime;

      console.log(`[iptables Response ${requestId}] Time: ${elapsed}ms`);
      if (stdout) console.log(`[iptables Response ${requestId}] Stdout:`, stdout.trim());
      if (stderr) console.log(`[iptables Response ${requestId}] Stderr:`, stderr.trim());
      console.log(`[iptables Response ${requestId}] SUCCESS ✓`);
      console.log(`[iptables Request ${requestId}] ========================================\n`);

      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
      console.error(`[iptables Response ${requestId}] ERROR: ${error.message}`);
      console.error(`[iptables Response ${requestId}] Exit code: ${error.code}`);
      if (error.stdout) console.error(`[iptables Response ${requestId}] Stdout:`, error.stdout);
      if (error.stderr) console.error(`[iptables Response ${requestId}] Stderr:`, error.stderr);
      console.log(`[iptables Request ${requestId}] ========================================\n`);
      throw error;
    }
  }

  /**
   * Ensure ipset exists
   */
  async ensureIpset() {
    try {
      // Check if ipset exists
      await this.executeCommand(`sudo ipset list ${this.ipsetName} -n 2>/dev/null`);
      console.log(`[iptables] IPSet ${this.ipsetName} already exists`);
    } catch (error) {
      // Create ipset if it doesn't exist
      console.log(`[iptables] Creating IPSet ${this.ipsetName}...`);
      await this.executeCommand(
        `sudo ipset create ${this.ipsetName} hash:ip timeout 0 comment`
      );
      console.log(`[iptables] IPSet ${this.ipsetName} created`);
    }

    // Ensure iptables rule exists to check ipset
    try {
      const { stdout } = await this.executeCommand(`sudo iptables -L ${this.chain} -n --line-numbers`);

      if (!stdout.includes(this.ipsetName)) {
        console.log(`[iptables] Adding iptables rule to check ${this.ipsetName}...`);
        await this.executeCommand(
          `sudo iptables -I ${this.chain} 1 -m set --match-set ${this.ipsetName} src -j ${this.action}`
        );
        console.log(`[iptables] iptables rule added`);
      }
    } catch (error) {
      console.error(`[iptables] Error ensuring iptables rule:`, error.message);
    }
  }

  /**
   * Test connection (check if iptables and ipset are available)
   */
  async testConnection() {
    console.log('[iptables] Testing connection...');
    try {
      // Check iptables
      await this.executeCommand('sudo iptables --version');

      // Check ipset
      await this.executeCommand('sudo ipset --version');

      // Ensure ipset and rule exist
      await this.ensureIpset();

      console.log('[iptables] Connection test successful');
      return {
        success: true,
        message: `iptables/ipset available. Using ipset: ${this.ipsetName}, chain: ${this.chain}`
      };
    } catch (error) {
      console.error('[iptables] Connection test failed:', error.message);
      return {
        success: false,
        message: `iptables/ipset not available: ${error.message}`
      };
    }
  }

  /**
   * Ban an IP address by adding to ipset
   */
  async banIP(ip, options = {}) {
    console.log(`[iptables] Banning IP: ${ip}`);
    try {
      const { reason, duration } = options;

      // Ensure ipset exists
      await this.ensureIpset();

      // Build ipset add command
      let command = `sudo ipset add ${this.ipsetName} ${ip}`;

      // Add timeout if duration specified
      if (duration && duration > 0) {
        command += ` timeout ${duration}`;
        console.log(`[iptables] Adding IP with ${duration}s timeout`);
      } else {
        console.log(`[iptables] Adding permanent IP ban`);
      }

      // Add comment if reason provided (requires ipset with comment support)
      if (reason) {
        const sanitizedReason = reason.replace(/"/g, '\\"').substring(0, 255);
        command += ` comment "${sanitizedReason}"`;
      }

      // Add to ipset (use -exist flag to not fail if already exists)
      await this.executeCommand(command + ' -exist');

      console.log(`[iptables] IP ${ip} banned successfully`);

      return {
        success: true,
        message: `IP ${ip} banned successfully`,
        ban_id: ip
      };
    } catch (error) {
      console.error(`[iptables] Failed to ban IP ${ip}:`, error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Unban an IP address by removing from ipset
   */
  async unbanIP(ip, ban_id = null) {
    console.log(`[iptables] Unbanning IP: ${ip}`);
    try {
      // Delete from ipset (won't fail if not exists)
      await this.executeCommand(`sudo ipset del ${this.ipsetName} ${ip} -exist`);

      console.log(`[iptables] IP ${ip} unbanned successfully`);
      return {
        success: true,
        message: `IP ${ip} unbanned successfully`
      };
    } catch (error) {
      console.error(`[iptables] Failed to unban IP ${ip}:`, error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Get list of currently banned IPs from ipset
   */
  async getBannedIPs() {
    console.log('[iptables] Fetching list of banned IPs...');
    try {
      const { stdout } = await this.executeCommand(`sudo ipset list ${this.ipsetName}`);

      const banRules = [];
      const lines = stdout.split('\n');
      let inMembers = false;

      // Parse ipset output
      for (const line of lines) {
        if (line.includes('Members:')) {
          inMembers = true;
          continue;
        }

        if (inMembers && line.trim()) {
          // Format: IP [timeout VALUE] [comment "COMMENT"]
          const parts = line.trim().split(/\s+/);
          const ip = parts[0];

          if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
            banRules.push({
              ip,
              ban_id: ip,
              banned_at: new Date().toISOString()
            });
          }
        }
      }

      console.log(`[iptables] Found ${banRules.length} banned IPs in ipset`);
      return banRules;
    } catch (error) {
      console.error('[iptables] Error fetching banned IPs:', error.message);
      return [];
    }
  }

  /**
   * Ban multiple IPs in batch using ipset restore
   */
  async batchBanIPs(bans) {
    console.log(`[iptables] Batch banning ${bans.length} IPs...`);
    const results = {
      success: true,
      message: '',
      banned_count: 0,
      ban_ids: {}
    };

    try {
      // Ensure ipset exists
      await this.ensureIpset();

      // Build ipset commands for batch restore
      let commands = [];

      for (const ban of bans) {
        let cmd = `add ${this.ipsetName} ${ban.ip}`;

        if (ban.duration && ban.duration > 0) {
          cmd += ` timeout ${ban.duration}`;
        }

        if (ban.reason) {
          const sanitizedReason = ban.reason.replace(/"/g, '\\"').substring(0, 255);
          cmd += ` comment "${sanitizedReason}"`;
        }

        cmd += ' -exist';
        commands.push(cmd);
      }

      // Execute batch add using ipset restore
      const batchScript = commands.join('\n');
      await this.executeCommand(`echo "${batchScript}" | sudo ipset restore`);

      results.banned_count = bans.length;
      bans.forEach(ban => {
        results.ban_ids[ban.ip] = ban.ip;
      });

      results.message = `Successfully banned ${results.banned_count} IPs`;
      console.log(`[iptables] Batch ban completed successfully: ${results.message}`);

      return results;
    } catch (error) {
      console.error(`[iptables] Batch ban failed:`, error.message);

      // Fallback to individual bans
      console.log(`[iptables] Falling back to individual ban operations...`);
      const failed = [];

      for (let i = 0; i < bans.length; i++) {
        const ban = bans[i];
        console.log(`[iptables] Batch progress: ${i + 1}/${bans.length} - Banning ${ban.ip}`);

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
      } else {
        results.message = `Successfully banned ${results.banned_count} IPs`;
      }

      return results;
    }
  }

  /**
   * Unban multiple IPs in batch
   */
  async batchUnbanIPs(unbans) {
    console.log(`[iptables] Batch unbanning ${unbans.length} IPs...`);
    const results = {
      success: true,
      message: '',
      unbanned_count: 0
    };

    try {
      // Build ipset commands for batch restore
      const commands = unbans.map(unban => `del ${this.ipsetName} ${unban.ip} -exist`);

      // Execute batch delete using ipset restore
      const batchScript = commands.join('\n');
      await this.executeCommand(`echo "${batchScript}" | sudo ipset restore`);

      results.unbanned_count = unbans.length;
      results.message = `Successfully unbanned ${results.unbanned_count} IPs`;
      console.log(`[iptables] Batch unban completed successfully: ${results.message}`);

      return results;
    } catch (error) {
      console.error(`[iptables] Batch unban failed:`, error.message);

      // Fallback to individual unbans
      console.log(`[iptables] Falling back to individual unban operations...`);
      const failed = [];

      for (let i = 0; i < unbans.length; i++) {
        const unban = unbans[i];
        console.log(`[iptables] Batch progress: ${i + 1}/${unbans.length} - Unbanning ${unban.ip}`);

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
      } else {
        results.message = `Successfully unbanned ${results.unbanned_count} IPs`;
      }

      return results;
    }
  }

  /**
   * Get provider capabilities
   */
  getCapabilities() {
    return {
      supportsBatch: true,  // Uses ipset restore for efficient batch operations
      supportsExpiry: true,  // ipset has native timeout support
      supportsSync: true
    };
  }
}

module.exports = IptablesProvider;
