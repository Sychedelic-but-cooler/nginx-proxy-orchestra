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
const { getSetting, db } = require('../db');

const execAsync = promisify(exec);

class NotificationService {
  constructor() {
    this.enabled = false;
    this.appriseUrls = [];
    this.isAppriseInstalled = false;
    this.appriseCheckComplete = false;
    this.checkAppriseInstalled();
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
      console.warn('⚠️  Apprise not installed. Notifications will be disabled.');
      console.warn('   Install with: pip3 install apprise');
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

      this.wafThreshold = parseInt(getSetting('notification_waf_threshold') || '10');
      this.wafThresholdMinutes = parseInt(getSetting('notification_waf_threshold_minutes') || '5');

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
   * Get count of recent WAF events
   */
  getRecentWAFEvents(minutes) {
    try {
      if (!db) return 0;

      const cutoffTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();
      const result = db.prepare(`
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

module.exports = {
  getNotificationService,
  notifyWAFBlock,
  notifyHighSeverityEvent,
  notifySystemError,
  notifyProxyChange,
  notifyCertExpiry,
  sendTestNotification
};
