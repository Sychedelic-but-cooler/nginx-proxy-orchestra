/**
 * firewalld (RHEL/CentOS/Fedora) Firewall Ban Provider
 *
 * Uses firewalld rich rules to block IPs
 * Requires sudo access for firewall-cmd
 */

const BanProvider = require('./base-provider');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class FirewalldProvider extends BanProvider {
  constructor(integration) {
    super(integration);

    // Get zone from config (default: public)
    this.zone = this.config.zone || 'public';

    console.log(`[firewalld] Initialized provider for zone: ${this.zone}`);
  }

  /**
   * Execute firewall-cmd command
   */
  async executeCommand(command) {
    const requestId = Math.random().toString(36).substring(7);

    console.log(`\n[firewalld Request ${requestId}] ========================================`);
    console.log(`[firewalld Request ${requestId}] Command: ${command}`);

    try {
      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(command);
      const elapsed = Date.now() - startTime;

      console.log(`[firewalld Response ${requestId}] Time: ${elapsed}ms`);
      if (stdout) console.log(`[firewalld Response ${requestId}] Stdout:`, stdout.trim());
      if (stderr) console.log(`[firewalld Response ${requestId}] Stderr:`, stderr.trim());
      console.log(`[firewalld Response ${requestId}] SUCCESS ✓`);
      console.log(`[firewalld Request ${requestId}] ========================================\n`);

      return { stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
      console.error(`[firewalld Response ${requestId}] ERROR: ${error.message}`);
      console.error(`[firewalld Response ${requestId}] Exit code: ${error.code}`);
      if (error.stdout) console.error(`[firewalld Response ${requestId}] Stdout:`, error.stdout);
      if (error.stderr) console.error(`[firewalld Response ${requestId}] Stderr:`, error.stderr);
      console.log(`[firewalld Request ${requestId}] ========================================\n`);
      throw error;
    }
  }

  /**
   * Test connection (check if firewalld is running)
   */
  async testConnection() {
    console.log('[firewalld] Testing connection...');
    try {
      const { stdout } = await this.executeCommand('sudo firewall-cmd --state');

      if (stdout.includes('running')) {
        console.log('[firewalld] Connection test successful');
        return {
          success: true,
          message: `firewalld is running on zone: ${this.zone}`
        };
      }

      return {
        success: false,
        message: 'firewalld is not running'
      };
    } catch (error) {
      console.error('[firewalld] Connection test failed:', error.message);
      return {
        success: false,
        message: `firewalld not available: ${error.message}`
      };
    }
  }

  /**
   * Ban an IP address using rich rule
   */
  async banIP(ip, options = {}) {
    console.log(`[firewalld] Banning IP: ${ip}`);
    try {
      const { reason, duration } = options;

      // Create rich rule to drop traffic from IP
      const rule = `rule family="ipv4" source address="${ip}" drop`;

      // Add rule with optional timeout
      let command = `sudo firewall-cmd --zone=${this.zone} --add-rich-rule='${rule}'`;

      // firewalld supports native timeout (in seconds)
      if (duration && duration > 0) {
        command += ` --timeout=${duration}`;
        console.log(`[firewalld] Adding rule with ${duration}s timeout`);
      } else {
        command += ' --permanent';
        console.log(`[firewalld] Adding permanent rule`);
      }

      await this.executeCommand(command);

      // Reload firewall to apply permanent rules
      if (!duration || duration === 0) {
        await this.executeCommand('sudo firewall-cmd --reload');
      }

      console.log(`[firewalld] IP ${ip} banned successfully`);

      return {
        success: true,
        message: `IP ${ip} banned successfully`,
        ban_id: ip  // Use IP as ban_id since we identify by IP
      };
    } catch (error) {
      console.error(`[firewalld] Failed to ban IP ${ip}:`, error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Unban an IP address by removing rich rule
   */
  async unbanIP(ip, ban_id = null) {
    console.log(`[firewalld] Unbanning IP: ${ip}`);
    try {
      const rule = `rule family="ipv4" source address="${ip}" drop`;

      // Try to remove from runtime first
      try {
        await this.executeCommand(`sudo firewall-cmd --zone=${this.zone} --remove-rich-rule='${rule}'`);
        console.log(`[firewalld] Removed runtime rule for ${ip}`);
      } catch (e) {
        console.log(`[firewalld] No runtime rule found for ${ip}`);
      }

      // Try to remove permanent rule
      try {
        await this.executeCommand(`sudo firewall-cmd --zone=${this.zone} --permanent --remove-rich-rule='${rule}'`);
        await this.executeCommand('sudo firewall-cmd --reload');
        console.log(`[firewalld] Removed permanent rule for ${ip}`);
      } catch (e) {
        console.log(`[firewalld] No permanent rule found for ${ip}`);
      }

      console.log(`[firewalld] IP ${ip} unbanned successfully`);
      return {
        success: true,
        message: `IP ${ip} unbanned successfully`
      };
    } catch (error) {
      console.error(`[firewalld] Failed to unban IP ${ip}:`, error.message);
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
    console.log('[firewalld] Fetching list of banned IPs...');
    try {
      // Get runtime rules
      const { stdout: runtime } = await this.executeCommand(
        `sudo firewall-cmd --zone=${this.zone} --list-rich-rules`
      );

      // Get permanent rules
      const { stdout: permanent } = await this.executeCommand(
        `sudo firewall-cmd --zone=${this.zone} --permanent --list-rich-rules`
      );

      const allRules = new Set([
        ...runtime.split('\n').filter(r => r.trim()),
        ...permanent.split('\n').filter(r => r.trim())
      ]);

      const banRules = [];
      const ipRegex = /source address="([^"]+)"/;

      for (const rule of allRules) {
        if (rule.includes('drop') || rule.includes('reject')) {
          const match = rule.match(ipRegex);
          if (match) {
            banRules.push({
              ip: match[1],
              ban_id: match[1],
              banned_at: new Date().toISOString()  // firewalld doesn't track creation time
            });
          }
        }
      }

      console.log(`[firewalld] Found ${banRules.length} ban rules`);
      return banRules;
    } catch (error) {
      console.error('[firewalld] Error fetching banned IPs:', error.message);
      return [];
    }
  }

  /**
   * Ban multiple IPs in batch
   */
  async batchBanIPs(bans) {
    console.log(`[firewalld] Batch banning ${bans.length} IPs...`);
    const results = {
      success: true,
      message: '',
      banned_count: 0,
      ban_ids: {}
    };

    const failed = [];

    for (let i = 0; i < bans.length; i++) {
      const ban = bans[i];
      console.log(`[firewalld] Batch progress: ${i + 1}/${bans.length} - Banning ${ban.ip}`);

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
      console.error(`[firewalld] Batch ban completed with errors: ${results.message}`);
    } else {
      results.message = `Successfully banned ${results.banned_count} IPs`;
      console.log(`[firewalld] Batch ban completed successfully: ${results.message}`);
    }

    return results;
  }

  /**
   * Unban multiple IPs in batch
   */
  async batchUnbanIPs(unbans) {
    console.log(`[firewalld] Batch unbanning ${unbans.length} IPs...`);
    const results = {
      success: true,
      message: '',
      unbanned_count: 0
    };

    const failed = [];

    for (let i = 0; i < unbans.length; i++) {
      const unban = unbans[i];
      console.log(`[firewalld] Batch progress: ${i + 1}/${unbans.length} - Unbanning ${unban.ip}`);

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
      console.error(`[firewalld] Batch unban completed with errors: ${results.message}`);
    } else {
      results.message = `Successfully unbanned ${results.unbanned_count} IPs`;
      console.log(`[firewalld] Batch unban completed successfully: ${results.message}`);
    }

    return results;
  }

  /**
   * Get provider capabilities
   */
  getCapabilities() {
    return {
      supportsBatch: true,
      supportsExpiry: true,  // firewalld has native timeout support
      supportsSync: true
    };
  }
}

module.exports = FirewalldProvider;
