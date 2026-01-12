import api from '../api.js';

let currentSettings = null;

export async function renderNotificationSettings(container) {
  // Set page title
  const headerTitle = document.getElementById('headerTitle');
  if (headerTitle) {
    headerTitle.textContent = 'Notification Settings';
  }

  // Show loading
  container.innerHTML = '<div class="loading-text">Loading notification settings...</div>';

  try {
    // Load current settings
    currentSettings = await api.getNotificationSettings();

    container.innerHTML = `
      <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
        <strong>ℹ️ Notification Settings:</strong> Nginx Proxy Orchestra makes use of the Apprise library to send notifications, please check their documentation for setup and support
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">General Settings</h3>
        </div>
        <div style="padding: 20px;">
          <form id="notificationSettingsForm">
            <!-- Enable/Disable -->
            <div class="form-group">
              <div class="checkbox-group">
                <input type="checkbox" id="notificationsEnabled" ${currentSettings.enabled ? 'checked' : ''}>
                <label for="notificationsEnabled" style="font-weight: 600;">Enable Notifications</label>
              </div>
              <small style="display: block; margin-left: 24px; color: var(--text-secondary);">
                Master switch for all notification types
              </small>
            </div>

            <!-- Apprise URLs -->
            <div class="form-group" style="margin-top: 20px;">
              <label for="appriseUrls">Apprise URLs</label>
              <textarea
                id="appriseUrls"
                rows="6"
                placeholder="One URL per line:&#10;discord://webhook_id/webhook_token&#10;slack://bottoken/channel&#10;mailto://user:pass@smtp.example.com?to=admin@example.com&#10;telegram://bot_token/chat_id"
                style="font-family: monospace; font-size: 13px;"
              >${(currentSettings.apprise_urls || []).join('\n')}</textarea>
              <small style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
                <span>📚</span>
                <a href="https://github.com/caronc/apprise/wiki" target="_blank" rel="noopener noreferrer" style="color: var(--primary-color);">
                  View Apprise documentation for URL formats
                </a>
              </small>
            </div>

            <!-- Test Button -->
            <div class="form-group" style="margin-top: 16px;">
              <button type="button" id="testNotificationBtn" class="btn btn-secondary">
                🧪 Send Test Notification
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Notification Triggers -->
      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h3 class="card-title">Notification Triggers</h3>
        </div>
        <div style="padding: 20px;">
          <p style="color: var(--text-secondary); margin-bottom: 20px;">
            Choose which events should trigger notifications
          </p>

          <!-- WAF Notifications -->
          <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <h4 style="margin: 0 0 12px 0; font-size: 16px;">🛡️ WAF Events</h4>

            <div class="form-group">
              <div class="checkbox-group">
                <input type="checkbox" id="notifyWAFBlocks" ${currentSettings.triggers?.waf_blocks ? 'checked' : ''}>
                <label for="notifyWAFBlocks">Notify on blocked attacks</label>
              </div>
              <small style="display: block; margin-left: 24px; color: var(--text-secondary);">
                Alert when WAF blocks malicious requests (with threshold)
              </small>
            </div>

            <div class="form-group" style="margin-top: 12px; margin-left: 28px;">
              <label style="font-size: 14px;">Threshold Alert</label>
              <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
                <input
                  type="number"
                  id="wafThreshold"
                  value="${currentSettings.triggers?.waf_threshold || 10}"
                  min="1"
                  max="1000"
                  style="width: 80px;"
                >
                <span>events in</span>
                <input
                  type="number"
                  id="wafThresholdMinutes"
                  value="${currentSettings.triggers?.waf_threshold_minutes || 5}"
                  min="1"
                  max="60"
                  style="width: 80px;"
                >
                <span>minutes</span>
              </div>
              <small style="color: var(--text-secondary); display: block; margin-top: 4px;">
                Only notify after reaching this threshold to prevent spam
              </small>
            </div>

            <div class="form-group" style="margin-top: 12px;">
              <div class="checkbox-group">
                <input type="checkbox" id="notifyHighSeverity" ${currentSettings.triggers?.waf_high_severity ? 'checked' : ''}>
                <label for="notifyHighSeverity">Notify on high severity events</label>
              </div>
              <small style="display: block; margin-left: 24px; color: var(--text-secondary);">
                Immediate alerts for critical and error-level WAF events
              </small>
            </div>
          </div>

          <!-- System Notifications -->
          <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <h4 style="margin: 0 0 12px 0; font-size: 16px;">System Events</h4>

            <div class="form-group">
              <div class="checkbox-group">
                <input type="checkbox" id="notifySystemErrors" ${currentSettings.triggers?.system_errors ? 'checked' : ''}>
                <label for="notifySystemErrors">Notify on system errors</label>
              </div>
              <small style="display: block; margin-left: 24px; color: var(--text-secondary);">
                Alert when system components encounter errors
              </small>
            </div>

            <div class="form-group" style="margin-top: 12px;">
              <div class="checkbox-group">
                <input type="checkbox" id="notifyProxyChanges" ${currentSettings.triggers?.proxy_changes ? 'checked' : ''}>
                <label for="notifyProxyChanges">Notify on proxy configuration changes</label>
              </div>
              <small style="display: block; margin-left: 24px; color: var(--text-secondary);">
                Alert when proxies are created, modified, or deleted
              </small>
            </div>
          </div>

          <!-- Certificate Notifications -->
          <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
            <h4 style="margin: 0 0 12px 0; font-size: 16px;">Certificate Events</h4>

            <div class="form-group">
              <div class="checkbox-group">
                <input type="checkbox" id="notifyCertExpiry" ${currentSettings.triggers?.cert_expiry ? 'checked' : ''}>
                <label for="notifyCertExpiry">Notify on certificate expiry</label>
              </div>
              <small style="display: block; margin-left: 24px; color: var(--text-secondary);">
                Alert when TLS certificates are about to expire
              </small>
            </div>

            <div class="form-group" style="margin-top: 12px; margin-left: 28px;">
              <label style="font-size: 14px;">Days before expiry</label>
              <input
                type="number"
                id="certExpiryDays"
                value="${currentSettings.triggers?.cert_expiry_days || 7}"
                min="1"
                max="90"
                style="width: 100px; margin-top: 8px;"
              >
              <small style="color: var(--text-secondary); display: block; margin-top: 4px;">
                How many days in advance to send expiry warnings
              </small>
            </div>
          </div>

          <!-- Save Button -->
          <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border-color);">
            <button type="button" id="saveNotificationSettings" class="btn btn-primary">
              Save Notification Settings
            </button>
          </div>
        </div>
      </div>

      <!-- Notification History -->
      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h3 class="card-title">Recent Notifications</h3>
          <small style="color: var(--text-secondary);">Last 10 notifications sent</small>
        </div>
        <div id="notificationHistoryContainer">
          <div class="loading-text" style="padding: 20px;">Loading notification history...</div>
        </div>
      </div>
    `;

    // Setup event listeners
    setupEventListeners();

    // Load notification history
    loadNotificationHistory();

  } catch (error) {
    console.error('Error loading notification settings:', error);
    container.innerHTML = `
      <div class="card">
        <div style="padding: 20px; text-align: center;">
          <p style="color: var(--danger-color); margin-bottom: 16px;">
            Failed to load notification settings: ${error.message}
          </p>
          <button onclick="location.reload()" class="btn btn-secondary">Retry</button>
        </div>
      </div>
    `;
  }
}

function setupEventListeners() {
  // Test notification button
  document.getElementById('testNotificationBtn').addEventListener('click', async () => {
    const button = document.getElementById('testNotificationBtn');
    const originalText = button.textContent;

    button.disabled = true;
    button.textContent = 'Sending...';

    try {
      const result = await api.testNotification();

      if (result.success) {
        button.textContent = 'Sent!';
        button.style.background = 'var(--success-color)';
        showToast('Test notification sent successfully! Check your notification channels.', 'success');
      } else {
        button.textContent = 'Failed';
        button.style.background = 'var(--danger-color)';
        const errorMsg = result.error || result.reason || 'Unknown error';
        showToast(`Failed to send: ${errorMsg}`, 'error');
      }

      setTimeout(() => {
        button.disabled = false;
        button.textContent = originalText;
        button.style.background = '';
      }, 3000);

    } catch (error) {
      button.textContent = 'Error';
      button.style.background = 'var(--danger-color)';
      showToast(`Error: ${error.message}`, 'error');

      setTimeout(() => {
        button.disabled = false;
        button.textContent = originalText;
        button.style.background = '';
      }, 3000);
    }
  });

  // Save settings button
  document.getElementById('saveNotificationSettings').addEventListener('click', async () => {
    await saveNotificationSettings();
  });
}

async function saveNotificationSettings() {
  const button = document.getElementById('saveNotificationSettings');
  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = 'Saving...';

  try {
    // Collect form data
    const appriseUrls = document.getElementById('appriseUrls').value
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0);

    const data = {
      enabled: document.getElementById('notificationsEnabled').checked,
      apprise_urls: appriseUrls,
      triggers: {
        waf_blocks: document.getElementById('notifyWAFBlocks').checked,
        waf_high_severity: document.getElementById('notifyHighSeverity').checked,
        waf_threshold: parseInt(document.getElementById('wafThreshold').value),
        waf_threshold_minutes: parseInt(document.getElementById('wafThresholdMinutes').value),
        system_errors: document.getElementById('notifySystemErrors').checked,
        proxy_changes: document.getElementById('notifyProxyChanges').checked,
        cert_expiry: document.getElementById('notifyCertExpiry').checked,
        cert_expiry_days: parseInt(document.getElementById('certExpiryDays').value)
      }
    };

    // Validate
    if (data.enabled && appriseUrls.length === 0) {
      showToast('Please add at least one Apprise URL or disable notifications', 'error');
      button.disabled = false;
      button.textContent = originalText;
      return;
    }

    // Save settings
    await api.updateNotificationSettings(data);

    button.textContent = 'Saved!';
    button.style.background = 'var(--success-color)';
    showToast('Notification settings saved successfully', 'success');

    // Update current settings
    currentSettings = data;

    setTimeout(() => {
      button.disabled = false;
      button.textContent = originalText;
      button.style.background = '';
    }, 2000);

  } catch (error) {
    console.error('Error saving notification settings:', error);
    button.textContent = 'Failed';
    button.style.background = 'var(--danger-color)';
    showToast(`Failed to save: ${error.message}`, 'error');

    setTimeout(() => {
      button.disabled = false;
      button.textContent = originalText;
      button.style.background = '';
    }, 3000);
  }
}

async function loadNotificationHistory() {
  const container = document.getElementById('notificationHistoryContainer');

  try {
    // Note: We don't have a history endpoint yet, so we'll show a placeholder
    // In the future, we can add GET /api/notifications/history
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--text-secondary);">
        <p>Notification history tracking coming soon</p>
        <small>For now, check your notification channels directly</small>
      </div>
    `;

  } catch (error) {
    console.error('Error loading notification history:', error);
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--danger-color);">
        <p>Failed to load notification history</p>
      </div>
    `;
  }
}

function showToast(message, type = 'info') {
  // Simple toast notification
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? 'var(--success-color)' : type === 'error' ? 'var(--danger-color)' : 'var(--primary-color)'};
    color: white;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    animation: slideInRight 0.3s ease-out;
  `;
  toast.textContent = message;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
