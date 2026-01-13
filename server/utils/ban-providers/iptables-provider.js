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
const { validateIP, validateIdentifier, sanitizeComment } = require('../input-validator');

class IptablesProvider extends BanProvider {
  constructor(integration) {
    super(integration);

    // Get config and validate
    this.ipsetName = this.config.ipset_name || 'waf_blocklist';
    this.chain = this.config.chain || 'INPUT';
    this.action = this.config.action || 'DROP';

    // SECURITY: Validate configuration values to prevent injection
    try {
      this.ipsetName = validateIdentifier(this.ipsetName);
      this.chain = validateIdentifier(this.chain);
      this.action = validateIdentifier(this.action);
    } catch (error) {
      throw new Error(`Invalid iptables configuration: ${error.message}`);
    }

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
      // SECURITY: Validate IP address to prevent command injection
      const validatedIP = validateIP(ip);
      
      const { reason, duration } = options;

      // Ensure ipset exists
      await this.ensureIpset();

      // Build ipset add command
      let command = `sudo ipset add ${this.ipsetName} ${validatedIP}`;

      // Add timeout if duration specified
      if (duration && duration > 0) {
        command += ` timeout ${parseInt(duration, 10)}`;
        console.log(`[iptables] Adding IP with ${duration}s timeout`);
      } else {
        console.log(`[iptables] Adding permanent IP ban`);
      }

      // Add comment if reason provided (requires ipset with comment support)
      // SECURITY: Sanitize comment to prevent command injection
      if (reason) {
        const sanitizedReason = sanitizeComment(reason, 255);
        if (sanitizedReason) {
          command += ` comment "${sanitizedReason}"`;
        }
      }

      // Add to ipset (use -exist flag to not fail if already exists)
      await this.executeCommand(command + ' -exist');

      console.log(`[iptables] IP ${validatedIP} banned successfully`);

      return {
        success: true,
        message: `IP ${validatedIP} banned successfully`,
        ban_id: validatedIP
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
      // SECURITY: Validate IP address to prevent command injection
      const validatedIP = validateIP(ip);
      
      // Delete from ipset (won't fail if not exists)
      await this.executeCommand(`sudo ipset del ${this.ipsetName} ${validatedIP} -exist`);

      console.log(`[iptables] IP ${validatedIP} unbanned successfully`);
      return {
        success: true,
        message: `IP ${validatedIP} unbanned successfully`
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
   * SECURITY: Uses stdin instead of echo to avoid command injection
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
      // SECURITY: Validate all IPs before building batch
      let commands = [];

      for (const ban of bans) {
        try {
          // SECURITY: Validate IP address
          const validatedIP = validateIP(ban.ip);
          
          let cmd = `add ${this.ipsetName} ${validatedIP}`;

          if (ban.duration && ban.duration > 0) {
            cmd += ` timeout ${parseInt(ban.duration, 10)}`;
          }

          // SECURITY: Sanitize comment
          if (ban.reason) {
            const sanitizedReason = sanitizeComment(ban.reason, 255);
            if (sanitizedReason) {
              cmd += ` comment "${sanitizedReason}"`;
            }
          }

          cmd += ' -exist';
          commands.push(cmd);
        } catch (error) {
          console.error(`[iptables] Skipping invalid IP ${ban.ip}: ${error.message}`);
          continue;
        }
      }

      if (commands.length === 0) {
        throw new Error('No valid IPs to ban');
      }

      // SECURITY: Use child_process.spawn with stdin instead of echo
      // This prevents command injection through the batch script
      const { spawn } = require('child_process');
      const batchScript = commands.join('\n');
      
      await new Promise((resolve, reject) => {
        const ipsetProcess = spawn('sudo', ['ipset', 'restore'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        ipsetProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        ipsetProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ipsetProcess.on('close', (code) => {
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(`ipset restore exited with code ${code}: ${stderr}`));
          }
        });

        ipsetProcess.on('error', (error) => {
          reject(error);
        });

        // Write batch script to stdin
        ipsetProcess.stdin.write(batchScript);
        ipsetProcess.stdin.end();
      });

      results.banned_count = commands.length;
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
   * SECURITY: Uses stdin instead of echo to avoid command injection
   */
  async batchUnbanIPs(unbans) {
    console.log(`[iptables] Batch unbanning ${unbans.length} IPs...`);
    const results = {
      success: true,
      message: '',
      unbanned_count: 0
    };

    try {
      // SECURITY: Validate all IPs and build commands
      const commands = [];
      
      for (const unban of unbans) {
        try {
          const validatedIP = validateIP(unban.ip);
          commands.push(`del ${this.ipsetName} ${validatedIP} -exist`);
        } catch (error) {
          console.error(`[iptables] Skipping invalid IP ${unban.ip}: ${error.message}`);
          continue;
        }
      }

      if (commands.length === 0) {
        throw new Error('No valid IPs to unban');
      }

      // SECURITY: Use child_process.spawn with stdin instead of echo
      const { spawn } = require('child_process');
      const batchScript = commands.join('\n');
      
      await new Promise((resolve, reject) => {
        const ipsetProcess = spawn('sudo', ['ipset', 'restore'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        ipsetProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        ipsetProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ipsetProcess.on('close', (code) => {
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(new Error(`ipset restore exited with code ${code}: ${stderr}`));
          }
        });

        ipsetProcess.on('error', (error) => {
          reject(error);
        });

        // Write batch script to stdin
        ipsetProcess.stdin.write(batchScript);
        ipsetProcess.stdin.end();
      });

      results.unbanned_count = commands.length;
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
