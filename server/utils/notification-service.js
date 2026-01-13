/**
 * Notification Service using Apprise
 *
 * Provides a unified interface for sending notifications to various services
 * (Discord, Slack, Email, Telegram, Pushover, etc.) using Apprise CLI.
 *
 * Installation required: pip3 install apprise
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const { getSetting, setSetting, db } = require('../db');
const { getWAFDb } = require('../waf-db');
const cron = require('node-cron');

const execAsync = promisify(exec);

class NotificationService {
  constructor() {
    this.enabled = false;
    this.appriseUrls = [];
    this.isAppriseInstalled = false;
    this.appriseCheckComplete = false;
    this.scheduledTasks = new Map();
    this.notificationQueue = [];
    this.isProcessingQueue = false;
    this.checkAppriseInstalled();
    this.initializeScheduler();
  }

  /**
   * Check if Apprise is installed
   */
  async checkAppriseInstalled() {
    try {
      await execAsync('which apprise');
      this.isAppriseInstalled = true;
    } catch (error) {
      this.isAppriseInstalled = false;
      console.warn('Apprise not installed. Notifications will be disabled.');
      console.warn('Install with: pip3 install apprise');
    } finally {
      this.appriseCheckComplete = true;
    }
  }

  /**
   * Wait for Apprise check to complete
   */
  async waitForAppriseCheck() {
    // Wait up to 5 seconds for apprise check to complete
    const maxWait = 5000;
    const startTime = Date.now();
    while (!this.appriseCheckComplete && (Date.now() - startTime) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Load notification settings from database
   */
  loadSettings() {
    try {
      this.enabled = getSetting('notifications_enabled') === '1';
      const urlsJson = getSetting('notification_apprise_urls') || '[]';
      this.appriseUrls = JSON.parse(urlsJson);

      this.notifyOnWAFBlocks = getSetting('notification_waf_blocks') === '1';
      this.notifyOnHighSeverity = getSetting('notification_waf_high_severity') === '1';
      this.notifyOnSystemErrors = getSetting('notification_system_errors') === '1';
      this.notifyOnProxyChanges = getSetting('notification_proxy_changes') === '1';
      this.notifyOnCertExpiry = getSetting('notification_cert_expiry') === '1';
      this.notifyOnBanIssued = getSetting('notification_ban_issued') === '1';
      this.notifyOnBanCleared = getSetting('notification_ban_cleared') === '1';

      this.wafThreshold = parseInt(getSetting('notification_waf_threshold') || '10');
      this.wafThresholdMinutes = parseInt(getSetting('notification_waf_threshold_minutes') || '5');
      
      // Enhanced notification settings
      this.matrixEnabled = getSetting('notification_matrix_enabled') === '1';
      this.dailyReportEnabled = getSetting('notification_daily_report_enabled') === '1';
      this.proxyLifecycleEnabled = getSetting('notification_proxy_lifecycle_enabled') === '1';
      this.batchingEnabled = getSetting('notification_batching_enabled') === '1';
      this.batchInterval = parseInt(getSetting('notification_batch_interval') || '300'); // 5 minutes
      this.rateLimit = parseInt(getSetting('notification_rate_limit') || '10');
      this.dailyReportTime = getSetting('notification_daily_report_time') || '23:30';
      this.timezone = getSetting('notification_timezone') || 'UTC';

      return true;
    } catch (error) {
      console.error('Error loading notification settings:', error);
      return false;
    }
  }

  /**
   * Send notification via Apprise
   * @param {Object} options - Notification options
   * @param {string} options.title - Notification title
   * @param {string} options.body - Notification body
   * @param {string} options.type - Notification type (info, success, warning, failure)
   * @param {string} options.tag - Optional tag for filtering
   * @param {string[]} options.urls - Optional specific Apprise URLs (overrides default)
   */
  async send({ title, body, type = 'info', tag = null, urls = null }) {
    // Wait for apprise check to complete if still pending
    await this.waitForAppriseCheck();

    if (!this.isAppriseInstalled) {
      console.log('[Notifications Disabled - Apprise not installed] Would send:', title);
      return { success: false, reason: 'Apprise not installed' };
    }

    if (!this.enabled) {
      console.log('[Notifications Disabled] Would send:', title);
      return { success: false, reason: 'Notifications are disabled in settings' };
    }

    const targetUrls = urls || this.appriseUrls;

    if (!targetUrls || targetUrls.length === 0) {
      console.warn('No Apprise URLs configured');
      return { success: false, reason: 'no_urls' };
    }

    try {
      const { spawn } = require('child_process');

      // Build apprise command args
      const urlArgs = targetUrls;
      const args = ['--notification-type', type];

      if (tag) {
        args.push('--tag', tag);
      }

      args.push('--title', title);
      args.push('--body', body);
      args.push(...urlArgs);

      // Use spawn instead of exec for better handling of special characters
      const appriseProcess = spawn('apprise', args, {
        timeout: 10000,
        shell: false // Don't use shell to avoid escaping issues
      });

      let stdout = '';
      let stderr = '';

      appriseProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      appriseProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      return new Promise((resolve) => {
        appriseProcess.on('close', (code) => {
          if (code === 0) {
            // Log to notification history
            this.logNotification(title, body, type, 'sent', null);

            resolve({
              success: true,
              stdout,
              stderr
            });
          } else {
            // Build comprehensive error message
            const errorParts = [];
            if (stderr && stderr.trim()) {
              errorParts.push(stderr.trim());
            }
            if (stdout && stdout.trim()) {
              errorParts.push(stdout.trim());
            }

            const errorDetails = errorParts.length > 0
              ? errorParts.join(' | ')
              : `Apprise command failed with exit code ${code}. Check Apprise URLs and configuration.`;

            const error = `Apprise exited with code ${code}. ${errorDetails}`;
            console.error('Apprise notification error:', error);
            console.error('Command was: apprise', args.join(' '));
            this.logNotification(title, body, type, 'failed', error);

            resolve({
              success: false,
              error: errorDetails
            });
          }
        });

        appriseProcess.on('error', (error) => {
          console.error('Apprise spawn error:', error);
          this.logNotification(title, body, type, 'failed', error.message);

          resolve({
            success: false,
            error: error.message
          });
        });
      });
    } catch (error) {
      console.error('Apprise notification error:', error);
      this.logNotification(title, body, type, 'failed', error.message);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Log notification to database
   */
  logNotification(title, body, notificationType, status, errorMessage) {
    try {
      if (!db) return;

      const stmt = db.prepare(`
        INSERT INTO notification_history (
          notification_type, event_type, title, message, severity, status, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        'apprise',
        notificationType,
        title,
        body,
        notificationType,
        status,
        errorMessage
      );
    } catch (error) {
      console.error('Error logging notification:', error);
    }
  }

  /**
   * Send WAF block notification
   */
  async notifyWAFBlock(event) {
    this.loadSettings();

    if (!this.notifyOnWAFBlocks) {
      return;
    }

    // Check if we should throttle notifications
    const recentEvents = this.getRecentWAFEvents(this.wafThresholdMinutes);
    if (recentEvents < this.wafThreshold) {
      // Don't spam - only notify when threshold is reached
      return;
    }

    const title = `🛡️ WAF Block Alert`;
    const body = `**Attack Type:** ${event.attack_type}
**Client IP:** ${event.client_ip}
**Request:** ${event.request_method} ${event.request_uri}
**Rule ID:** ${event.rule_id}
**Severity:** ${event.severity}
**Message:** ${event.message}

Recent attacks: ${recentEvents} in the last ${this.wafThresholdMinutes} minutes.`;

    return await this.send({
      title,
      body,
      type: 'warning',
      tag: 'waf'
    });
  }

  /**
   * Initialize notification scheduler for daily reports
   */
  initializeScheduler() {
    if (!db) return;
    
    try {
      // Start daily report scheduler
      this.scheduleDailyReports();
      
      // Start notification queue processor
      if (this.batchingEnabled) {
        this.startQueueProcessor();
      }
      
      console.log('Notification scheduler initialized');
    } catch (error) {
      console.error('Error initializing notification scheduler:', error);
    }
  }

  /**
   * Schedule daily reports based on database settings
   */
  scheduleDailyReports() {
    try {
      const schedules = db.prepare(`
        SELECT * FROM notification_schedules 
        WHERE enabled = 1 AND type = 'daily'
      `).all();
      
      schedules.forEach(schedule => {
        if (this.scheduledTasks.has(schedule.id)) {
          this.scheduledTasks.get(schedule.id).stop();
        }
        
        const task = cron.schedule(schedule.cron_expression, async () => {
          await this.generateDailyReport(schedule);
        }, {
          scheduled: true,
          timezone: this.timezone
        });
        
        this.scheduledTasks.set(schedule.id, task);
        console.log(`Scheduled daily report: ${schedule.name} at ${schedule.cron_expression}`);
      });
    } catch (error) {
      console.error('Error scheduling daily reports:', error);
    }
  }

  /**
   * Start notification queue processor for batching
   */
  startQueueProcessor() {
    setInterval(async () => {
      if (this.isProcessingQueue) return;
      await this.processNotificationQueue();
    }, this.batchInterval * 1000);
  }

  /**
   * Process queued notifications in batches
   */
  async processNotificationQueue() {
    if (!this.batchingEnabled) return;
    
    this.isProcessingQueue = true;
    
    try {
      const queuedNotifications = db.prepare(`
        SELECT * FROM notification_queue 
        WHERE status = 'pending' AND scheduled_for <= datetime('now')
        ORDER BY scheduled_for ASC
        LIMIT 10
      `).all();
      
      for (const notification of queuedNotifications) {
        try {
          const eventData = JSON.parse(notification.event_data);
          await this.send(eventData);
          
          db.prepare(`
            UPDATE notification_queue 
            SET status = 'sent', sent_at = datetime('now')
            WHERE id = ?
          `).run(notification.id);
          
        } catch (error) {
          db.prepare(`
            UPDATE notification_queue 
            SET status = 'failed', attempts = attempts + 1, error_message = ?
            WHERE id = ?
          `).run(error.message, notification.id);
        }
      }
    } catch (error) {
      console.error('Error processing notification queue:', error);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Send high severity WAF event notification
   */
  async notifyHighSeverityEvent(event) {
    this.loadSettings();

    if (!this.notifyOnHighSeverity) {
      return;
    }

    const title = `🚨 High Severity WAF Alert`;
    const body = `**Attack Type:** ${event.attack_type}
**Client IP:** ${event.client_ip}
**Request:** ${event.request_method} ${event.request_uri}
**Rule ID:** ${event.rule_id}
**Severity:** ${event.severity}
**Blocked:** ${event.blocked ? 'YES' : 'NO'}

This attack was classified as high severity and requires attention.`;

    return await this.send({
      title,
      body,
      type: 'failure',
      tag: 'waf-critical'
    });
  }

  /**
   * Send system error notification
   */
  async notifySystemError(component, errorMessage, details = {}) {
    this.loadSettings();

    if (!this.notifyOnSystemErrors) {
      return;
    }

    const title = `❌ System Error: ${component}`;
    const body = `**Component:** ${component}
**Error:** ${errorMessage}
${Object.keys(details).length > 0 ? `**Details:**\n${JSON.stringify(details, null, 2)}` : ''}

Immediate attention may be required.`;

    return await this.send({
      title,
      body,
      type: 'failure',
      tag: 'system-error'
    });
  }

  /**
   * Send proxy configuration change notification
   */
  async notifyProxyChange(action, proxyName, user) {
    this.loadSettings();

    if (!this.notifyOnProxyChanges) {
      return;
    }

    const title = `🔧 Proxy Configuration Change`;
    const body = `**Action:** ${action}
**Proxy:** ${proxyName}
**User:** ${user}
**Time:** ${new Date().toISOString()}`;

    return await this.send({
      title,
      body,
      type: 'info',
      tag: 'proxy-change'
    });
  }

  /**
   * Send certificate expiry notification
   */
  async notifyCertExpiry(certName, domains, daysUntilExpiry) {
    this.loadSettings();

    if (!this.notifyOnCertExpiry) {
      return;
    }

    const title = daysUntilExpiry <= 0
      ? `🔴 Certificate EXPIRED: ${certName}`
      : `⚠️ Certificate Expiring Soon: ${certName}`;

    const body = `**Certificate:** ${certName}
**Domains:** ${domains}
**Days Until Expiry:** ${daysUntilExpiry}
**Status:** ${daysUntilExpiry <= 0 ? 'EXPIRED' : 'Expiring Soon'}

Please renew this certificate immediately to avoid service disruption.`;

    return await this.send({
      title,
      body,
      type: daysUntilExpiry <= 0 ? 'failure' : 'warning',
      tag: 'cert-expiry'
    });
  }

  /**
   * Send ban issued notification (auto and manual)
   */
  async notifyBanIssued(banDetails) {
    this.loadSettings();

    if (!this.notifyOnBanIssued) {
      return;
    }

    const { ip_address, reason, attack_type, event_count, severity, ban_duration, detection_rule, auto_banned, banned_by_username } = banDetails;

    const durationText = ban_duration
      ? `${Math.floor(ban_duration / 3600)} hours`
      : 'Permanent';

    const banType = auto_banned ? 'Auto-Ban' : 'Manual Ban';
    const banIcon = auto_banned ? '🤖' : '👤';

    const title = `🚫 ${banType} Issued`;
    const body = `**IP Address:** ${ip_address}
**Reason:** ${reason}
${attack_type ? `**Attack Type:** ${attack_type}` : ''}
${event_count ? `**Events:** ${event_count} events detected` : ''}
**Severity:** ${severity}
**Ban Duration:** ${durationText}
${detection_rule ? `**Detection Rule:** ${detection_rule}` : ''}
${banned_by_username ? `**Banned By:** ${banned_by_username}` : ''}
**Type:** ${banIcon} ${banType}

This IP has been banned and firewall rules have been applied.`;

    return await this.send({
      title,
      body,
      type: 'warning',
      tag: 'ban-issued'
    });
  }

  /**
   * Send ban cleared notification (auto and manual)
   */
  async notifyBanCleared(banDetails) {
    this.loadSettings();

    if (!this.notifyOnBanCleared) {
      return;
    }

    const { ip_address, reason, banned_at, expires_at, manual, unbanned_by_username, auto_banned } = banDetails;

    const bannedDuration = expires_at
      ? Math.floor((new Date(expires_at) - new Date(banned_at)) / 1000 / 3600)
      : 'N/A';

    const clearType = manual ? 'Manual Unban' : 'Automatic Expiry';
    const clearIcon = manual ? '👤' : '⏰';
    const originalType = auto_banned ? 'Auto-ban' : 'Manual ban';

    const title = `✅ Ban Cleared`;
    const body = `**IP Address:** ${ip_address}
**Original Reason:** ${reason}
**Original Type:** ${originalType}
**Banned At:** ${new Date(banned_at).toLocaleString()}
**Ban Duration:** ${bannedDuration !== 'N/A' ? `${bannedDuration} hours` : 'Was permanent'}
${unbanned_by_username ? `**Unbanned By:** ${unbanned_by_username}` : ''}
**Cleared:** ${clearIcon} ${clearType}

This IP is no longer banned and can access your infrastructure. Firewall rules have been removed.`;

    return await this.send({
      title,
      body,
      type: 'info',
      tag: 'ban-cleared'
    });
  }

  /**
   * Check WAF events against notification matrix and send alerts
   */
  async checkWAFMatrix() {
    this.loadSettings();
    
    if (!this.matrixEnabled) return;
    
    try {
      const matrixConfigs = db.prepare(`
        SELECT * FROM waf_notification_matrix
        WHERE enabled = 1
      `).all();
      
      for (const config of matrixConfigs) {
        await this.checkMatrixThreshold(config);
      }
    } catch (error) {
      console.error('Error checking WAF matrix:', error);
    }
  }

  /**
   * Check individual matrix threshold and send notification if triggered
   */
  async checkMatrixThreshold(config) {
    try {
      const wafDb = getWAFDb();
      if (!wafDb) return;
      
      // Check if we're in cooldown period
      if (config.last_triggered && config.notification_delay > 0) {
        const cooldownEnd = new Date(config.last_triggered);
        cooldownEnd.setMinutes(cooldownEnd.getMinutes() + config.notification_delay);
        if (new Date() < cooldownEnd) {
          return; // Still in cooldown
        }
      }
      
      const cutoffTime = new Date(Date.now() - config.time_window * 60 * 1000).toISOString();
      
      // Map severity levels to database values
      const severityMap = {
        'critical': ['0', '1', '2'],
        'error': ['3'],
        'warning': ['4'], 
        'notice': ['5']
      };
      
      const severityValues = severityMap[config.severity_level] || [];
      const placeholders = severityValues.map(() => '?').join(',');
      
      const eventCount = wafDb.prepare(`
        SELECT COUNT(*) as count FROM waf_events
        WHERE timestamp > ? AND severity IN (${placeholders})
      `).get(cutoffTime, ...severityValues);
      
      if (eventCount.count >= config.count_threshold) {
        await this.sendMatrixNotification(config, eventCount.count, cutoffTime);
        
        // Update last triggered time
        db.prepare(`
          UPDATE waf_notification_matrix 
          SET last_triggered = datetime('now')
          WHERE id = ?
        `).run(config.id);
      }
    } catch (error) {
      console.error('Error checking matrix threshold:', error);
    }
  }

  /**
   * Send matrix-triggered notification
   */
  async sendMatrixNotification(config, actualCount, cutoffTime) {
    try {
      const template = this.getNotificationTemplate('waf_matrix');
      const wafDb = getWAFDb();
      
      // Get attack summary
      const attackSummary = wafDb.prepare(`
        SELECT attack_type, COUNT(*) as count
        FROM waf_events
        WHERE timestamp > ? AND severity IN (SELECT severity FROM waf_events LIMIT 1)
        GROUP BY attack_type
        ORDER BY count DESC
        LIMIT 5
      `).all(cutoffTime);
      
      // Get IP summary
      const ipSummary = wafDb.prepare(`
        SELECT client_ip, COUNT(*) as count
        FROM waf_events  
        WHERE timestamp > ?
        GROUP BY client_ip
        ORDER BY count DESC
        LIMIT 5
      `).all(cutoffTime);
      
      const attackText = attackSummary.map(a => `• ${a.attack_type}: ${a.count} events`).join('\n');
      const ipText = ipSummary.map(ip => `• ${ip.client_ip}: ${ip.count} events`).join('\n');
      
      const title = template.title_template
        .replace('{severity}', config.severity_level.toUpperCase())
        .replace('{count}', actualCount);
        
      const body = template.message_template
        .replace('{count}', actualCount)
        .replace('{severity}', config.severity_level)
        .replace('{window}', config.time_window)
        .replace('{attack_summary}', attackText || 'No attack data available')
        .replace('{ip_summary}', ipText || 'No IP data available');
      
      return await this.send({
        title,
        body,
        type: config.severity_level === 'critical' ? 'failure' : 'warning',
        tag: 'waf-matrix'
      });
    } catch (error) {
      console.error('Error sending matrix notification:', error);
    }
  }

  /**
   * Generate and send daily report
   */
  async generateDailyReport(schedule) {
    try {
      const settings = JSON.parse(schedule.settings);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const dateStr = yesterday.toISOString().split('T')[0];
      
      let reportSections = [];
      
      if (settings.include_waf) {
        const wafSummary = await this.generateWAFSummary(yesterday, today);
        reportSections.push(wafSummary);
      }
      
      if (settings.include_nginx) {
        const nginxSummary = await this.generateNginxSummary(yesterday, today);
        reportSections.push(nginxSummary);
      }
      
      if (settings.include_bans) {
        const banSummary = await this.generateBanSummary(yesterday, today);
        reportSections.push(banSummary);
      }
      
      const template = this.getNotificationTemplate('daily_report');
      const title = template.title_template.replace('{date}', dateStr);
      const body = template.message_template
        .replace('{date}', dateStr)
        .replace('{waf_summary}', reportSections[0] || 'No WAF data')
        .replace('{nginx_summary}', reportSections[1] || 'No traffic data')
        .replace('{notable_events}', reportSections[2] || 'No notable events');
      
      await this.send({
        title,
        body,
        type: 'info',
        tag: 'daily-report'
      });
      
      // Update schedule last run time
      db.prepare(`
        UPDATE notification_schedules
        SET last_run = datetime('now'), next_run = datetime('now', '+1 day')
        WHERE id = ?
      `).run(schedule.id);
      
    } catch (error) {
      console.error('Error generating daily report:', error);
    }
  }

  /**
   * Generate WAF summary for daily report
   */
  async generateWAFSummary(startDate, endDate) {
    try {
      const wafDb = getWAFDb();
      if (!wafDb) return 'WAF database unavailable';
      
      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();
      
      const stats = wafDb.prepare(`
        SELECT 
          COUNT(*) as total_events,
          SUM(blocked) as blocked_events,
          COUNT(DISTINCT client_ip) as unique_ips,
          COUNT(DISTINCT attack_type) as attack_types
        FROM waf_events
        WHERE timestamp BETWEEN ? AND ?
      `).get(startStr, endStr);
      
      const topAttacks = wafDb.prepare(`
        SELECT attack_type, COUNT(*) as count
        FROM waf_events
        WHERE timestamp BETWEEN ? AND ?
        GROUP BY attack_type
        ORDER BY count DESC
        LIMIT 3
      `).all(startStr, endStr);
      
      const attackText = topAttacks.map(a => `  • ${a.attack_type}: ${a.count}`).join('\n');
      
      return `Total Events: ${stats.total_events || 0}
Blocked: ${stats.blocked_events || 0}
Unique IPs: ${stats.unique_ips || 0}
Top Attacks:\n${attackText || '  • No attacks detected'}`;
    } catch (error) {
      return 'Error generating WAF summary';
    }
  }

  /**
   * Generate Nginx summary for daily report
   */
  async generateNginxSummary(startDate, endDate) {
    try {
      // This would integrate with your existing nginx statistics service
      // For now, returning a placeholder
      return 'Total Requests: N/A\nSuccess Rate: N/A\nTop IPs: N/A';
    } catch (error) {
      return 'Error generating Nginx summary';
    }
  }

  /**
   * Generate ban summary for daily report 
   */
  async generateBanSummary(startDate, endDate) {
    try {
      const startStr = startDate.toISOString();
      const endStr = endDate.toISOString();
      
      const banStats = db.prepare(`
        SELECT COUNT(*) as new_bans
        FROM ips_banned
        WHERE banned_at BETWEEN ? AND ?
      `).get(startStr, endStr);
      
      const clearStats = db.prepare(`
        SELECT COUNT(*) as cleared_bans
        FROM ips_banned
        WHERE unbanned_at BETWEEN ? AND ? AND unbanned_at IS NOT NULL
      `).get(startStr, endStr);
      
      return `New Bans: ${banStats.new_bans || 0}\nCleared Bans: ${clearStats.cleared_bans || 0}`;
    } catch (error) {
      return 'Error generating ban summary';
    }
  }

  /**
   * Send proxy lifecycle notification  
   */
  async notifyProxyLifecycle(action, proxyData, user) {
    this.loadSettings();
    
    if (!this.proxyLifecycleEnabled) return;
    
    try {
      const template = this.getNotificationTemplate(`proxy_${action}`);
      if (!template) {
        // Fallback to old method
        return await this.notifyProxyChange(action, proxyData.name, user);
      }
      
      const title = template.title_template;
      const body = template.message_template
        .replace('{proxy_name}', proxyData.name)
        .replace('{domains}', proxyData.domain_names)
        .replace('{status}', proxyData.enabled ? 'Enabled' : 'Disabled')
        .replace('{user}', user);
      
      return await this.send({
        title,
        body,
        type: action === 'deleted' ? 'warning' : 'info',
        tag: 'proxy-lifecycle'
      });
    } catch (error) {
      console.error('Error sending proxy lifecycle notification:', error);
      // Fallback to old method
      return await this.notifyProxyChange(action, proxyData.name, user);
    }
  }

  /**
   * Get notification template by type
   */
  getNotificationTemplate(type) {
    try {
      return db.prepare(`
        SELECT * FROM notification_templates
        WHERE type = ? AND enabled = 1
        LIMIT 1
      `).get(type);
    } catch (error) {
      console.error('Error getting notification template:', error);
      return null;
    }
  }

  /**
   * Add notification to queue for batched sending
   */
  queueNotification(notificationData, scheduledFor = new Date()) {
    if (!this.batchingEnabled) {
      return this.send(notificationData);
    }
    
    try {
      db.prepare(`
        INSERT INTO notification_queue (notification_type, event_data, scheduled_for)
        VALUES (?, ?, ?)
      `).run(
        notificationData.type || 'info',
        JSON.stringify(notificationData),
        scheduledFor.toISOString()
      );
    } catch (error) {
      console.error('Error queuing notification:', error);
      // Fallback to immediate send
      return this.send(notificationData);
    }
  }

  /**
   * Get count of recent WAF events
   */
  getRecentWAFEvents(minutes) {
    try {
      const wafDb = getWAFDb();
      if (!wafDb) return 0;

      const cutoffTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();
      const result = wafDb.prepare(`
        SELECT COUNT(*) as count FROM waf_events
        WHERE timestamp > ? AND blocked = 1
      `).get(cutoffTime);

      return result?.count || 0;
    } catch (error) {
      console.error('Error getting recent WAF events:', error);
      return 0;
    }
  }

  /**
   * Test notification configuration
   */
  async testNotification(urls = null) {
    // Load latest settings from database
    this.loadSettings();

    const title = '🧪 Test Notification - Nginx Proxy Orchestra';
    const body = `This is a test notification from Nginx Proxy Orchestra.

**Time:** ${new Date().toISOString()}
**Status:** ✅ Notifications are working correctly!

If you received this message, your notification configuration is set up properly.`;

    return await this.send({
      title,
      body,
      type: 'success',
      tag: 'test',
      urls
    });
  }
}

// Singleton instance
let instance = null;

function getNotificationService() {
  if (!instance) {
    instance = new NotificationService();
    instance.loadSettings();
  }
  return instance;
}

// Convenience functions
async function notifyWAFBlock(event) {
  return await getNotificationService().notifyWAFBlock(event);
}

async function notifyHighSeverityEvent(event) {
  return await getNotificationService().notifyHighSeverityEvent(event);
}

async function notifySystemError(component, errorMessage, details) {
  return await getNotificationService().notifySystemError(component, errorMessage, details);
}

async function notifyProxyChange(action, proxyName, user) {
  return await getNotificationService().notifyProxyChange(action, proxyName, user);
}

async function notifyCertExpiry(certName, domains, daysUntilExpiry) {
  return await getNotificationService().notifyCertExpiry(certName, domains, daysUntilExpiry);
}

async function sendTestNotification(urls = null) {
  return await getNotificationService().testNotification(urls);
}

async function notifyBanIssued(banDetails) {
  return await getNotificationService().notifyBanIssued(banDetails);
}

async function notifyBanCleared(banDetails) {
  return await getNotificationService().notifyBanCleared(banDetails);
}

async function checkWAFMatrix() {
  return await getNotificationService().checkWAFMatrix();
}

async function notifyProxyLifecycle(action, proxyData, user) {
  return await getNotificationService().notifyProxyLifecycle(action, proxyData, user);
}

async function queueNotification(notificationData, scheduledFor) {
  return await getNotificationService().queueNotification(notificationData, scheduledFor);
}

module.exports = {
  getNotificationService,
  notifyWAFBlock,
  notifyHighSeverityEvent,
  notifySystemError,
  notifyProxyChange,
  notifyCertExpiry,
  sendTestNotification,
  notifyBanIssued,
  notifyBanCleared,
  checkWAFMatrix,
  notifyProxyLifecycle,
  queueNotification
};
