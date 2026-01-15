import api from '../api.js';

let currentSettings = null;
let wafMatrix = null;

export async function renderNotificationSettings(container) {
  // Set page title
  const headerTitle = document.getElementById('headerTitle');
  if (headerTitle) {
    headerTitle.textContent = 'Enhanced Notification Settings';
  }

  // Show loading
  container.innerHTML = '<div class="loading-text">Loading notification settings...</div>';

  try {
    // Load current settings and WAF matrix
    const [settingsResult, matrixResult] = await Promise.all([
      api.getNotificationSettings(),
      api.getWAFMatrix().catch(() => ({ matrix: [] })) // Graceful fallback
    ]);
    
    currentSettings = settingsResult;
    wafMatrix = matrixResult.matrix || [];

    container.innerHTML = `
      <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
        <strong>Enhanced Notification Settings</strong><br>
        Configure advanced notification controls including WAF matrix alerts, daily reports, and modular notification types.
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">General Settings</h3>
        </div>
        <div style="padding: 20px;">
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
              rows="4"
              placeholder="discord://webhook_id/webhook_token&#10;slack://bottoken/channel&#10;telegram://bot_token/chat_id"
              style="font-family: monospace; font-size: 13px;"
            >${(currentSettings.apprise_urls || []).join('\n')}</textarea>
            <small style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
              <span>📚</span>
              <a href="https://github.com/caronc/apprise/wiki" target="_blank" rel="noopener noreferrer" style="color: var(--primary-color);">
                View Apprise documentation
              </a>
            </small>
          </div>

          <!-- Test Button -->
          <div class="form-group" style="margin-top: 16px;">
            <button type="button" id="testNotificationBtn" class="btn btn-secondary">
              🧪 Send Test Notification
            </button>
          </div>
        </div>
      </div>

      <!-- Enhanced Features -->
      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h3 class="card-title">+Enhanced Features</h3>
          <small style="color: var(--text-secondary);">Advanced notification controls and scheduling</small>
        </div>
        <div style="padding: 20px;">
          <div class="enhanced-features-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            
            <!-- WAF Matrix -->
            <div class="feature-card" style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
              <div class="form-group">
                <div class="checkbox-group">
                  <input type="checkbox" id="matrixEnabled" ${currentSettings.enhanced?.matrix_enabled ? 'checked' : ''}>
                  <label for="matrixEnabled" style="font-weight: 600;">WAF Notification Matrix</label>
                </div>
                <small style="display: block; margin-top: 4px; color: var(--text-secondary);">
                  Smart WAF alerts based on severity frequency combinations
                </small>
                <button type="button" id="configureMatrixBtn" class="btn btn-sm btn-outline" style="margin-top: 8px;">
                  Configure Matrix
                </button>
              </div>
            </div>

            <!-- Daily Reports -->
            <div class="feature-card" style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
              <div class="form-group">
                <div class="checkbox-group">
                  <input type="checkbox" id="dailyReportEnabled" ${currentSettings.enhanced?.daily_report_enabled ? 'checked' : ''}>
                  <label for="dailyReportEnabled" style="font-weight: 600;">Daily Reports</label>
                </div>
                <small style="display: block; margin-top: 4px; color: var(--text-secondary);">
                  Automated daily summaries at specified time
                </small>
                <div style="margin-top: 8px;">
                  <input
                    type="time"
                    id="dailyReportTime"
                    value="${currentSettings.enhanced?.daily_report_time || '23:30'}"
                    style="width: 120px;"
                  >
                </div>
              </div>
            </div>

            <!-- Proxy Lifecycle -->
            <div class="feature-card" style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
              <div class="form-group">
                <div class="checkbox-group">
                  <input type="checkbox" id="proxyLifecycleEnabled" ${currentSettings.enhanced?.proxy_lifecycle_enabled ? 'checked' : ''}>
                  <label for="proxyLifecycleEnabled" style="font-weight: 600;">Enhanced Proxy Alerts</label>
                </div>
                <small style="display: block; margin-top: 4px; color: var(--text-secondary);">
                  Detailed proxy creation/deletion notifications
                </small>
              </div>
            </div>

            <!-- Notification Batching -->
            <div class="feature-card" style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
              <div class="form-group">
                <div class="checkbox-group">
                  <input type="checkbox" id="batchingEnabled" ${currentSettings.enhanced?.batching_enabled ? 'checked' : ''}>
                  <label for="batchingEnabled" style="font-weight: 600;">Smart Batching</label>
                </div>
                <small style="display: block; margin-top: 4px; color: var(--text-secondary);">
                  Batch similar notifications to reduce spam
                </small>
                <div style="margin-top: 8px;">
                  <input
                    type="number"
                    id="batchInterval"
                    value="${currentSettings.enhanced?.batch_interval || 300}"
                    min="60"
                    max="3600"
                    style="width: 80px;"
                  >
                  <span style="margin-left: 4px; font-size: 12px;">sec</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- WAF Matrix Configuration -->
      <div class="card" style="margin-top: 20px; display: none;" id="wafMatrixCard">
        <div class="card-header">
          <h3 class="card-title"> WAF Notification Matrix</h3>
          <small style="color: var(--text-secondary);">Configure notifications based on event severity and frequency</small>
        </div>
        <div style="padding: 20px;">
          ${renderWAFMatrix()}
        </div>
      </div>

      <!-- Legacy Notification Triggers -->
      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h3 class="card-title">Basic Notification Triggers</h3>
          <small style="color: var(--text-secondary);">Traditional notification settings</small>
        </div>
        <div style="padding: 20px;">
          
          <!-- WAF Basic -->
          <div class="notification-section" style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <h4 style="margin: 0 0 12px 0; font-size: 16px; display: flex; align-items: center; gap: 8px;">
              WAF Events
              <span style="background: #ffa726; color: white; font-size: 10px; padding: 2px 6px; border-radius: 4px;">LEGACY</span>
            </h4>
            
            <div class="form-group">
              <div class="checkbox-group">
                <input type="checkbox" id="notifyWAFBlocks" ${currentSettings.triggers?.waf_blocks ? 'checked' : ''}>
                <label for="notifyWAFBlocks">Notify on blocked attacks (threshold-based)</label>
              </div>
              <div style="margin-left: 28px; margin-top: 8px; display: flex; gap: 8px; align-items: center;">
                <input type="number" id="wafThreshold" value="${currentSettings.triggers?.waf_threshold || 10}" min="1" max="1000" style="width: 70px;">
                <span>events in</span>
                <input type="number" id="wafThresholdMinutes" value="${currentSettings.triggers?.waf_threshold_minutes || 5}" min="1" max="60" style="width: 70px;">
                <span>minutes</span>
              </div>
            </div>

            <div class="form-group" style="margin-top: 12px;">
              <div class="checkbox-group">
                <input type="checkbox" id="notifyHighSeverity" ${currentSettings.triggers?.waf_high_severity ? 'checked' : ''}>
                <label for="notifyHighSeverity">Notify on high severity events (immediate)</label>
              </div>
            </div>
          </div>

          <!-- System Events -->
          <div class="notification-section" style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <h4 style="margin: 0 0 12px 0; font-size: 16px;">System Events</h4>
            
            <div class="form-group">
              <div class="checkbox-group">
                <input type="checkbox" id="notifySystemErrors" ${currentSettings.triggers?.system_errors ? 'checked' : ''}>
                <label for="notifySystemErrors">System error notifications</label>
              </div>
            </div>

            <div class="form-group" style="margin-top: 8px;">
              <div class="checkbox-group">
                <input type="checkbox" id="notifyProxyChanges" ${currentSettings.triggers?.proxy_changes ? 'checked' : ''}>
                <label for="notifyProxyChanges">Basic proxy change notifications</label>
              </div>
            </div>
          </div>

          <!-- Certificate Events -->
          <div class="notification-section" style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
            <h4 style="margin: 0 0 12px 0; font-size: 16px;">Certificate Events</h4>
            
            <div class="form-group">
              <div class="checkbox-group">
                <input type="checkbox" id="notifyCertExpiry" ${currentSettings.triggers?.cert_expiry ? 'checked' : ''}>
                <label for="notifyCertExpiry">Certificate expiry warnings</label>
              </div>
              <div style="margin-left: 28px; margin-top: 8px;">
                <input type="number" id="certExpiryDays" value="${currentSettings.triggers?.cert_expiry_days || 7}" min="1" max="90" style="width: 80px;">
                <span style="margin-left: 4px;">days before expiry</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Save Actions -->
      <div class="card" style="margin-top: 20px;">
        <div style="padding: 20px; display: flex; gap: 12px; justify-content: flex-start;">
          <button type="button" id="saveAllSettings" class="btn btn-primary">
            Save All Settings
          </button>
          <button type="button" id="saveMatrixOnly" class="btn btn-secondary" style="display: none;">
            Save Matrix Only
          </button>
        </div>
      </div>

      <!-- Notification History -->
      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h3 class="card-title">Recent Notifications</h3>
          <small style="color: var(--text-secondary);">Last 25 notifications sent</small>
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
          <button id="retryLoadBtn" class="btn btn-secondary">Retry</button>
        </div>
      </div>
    `;
    
    // Attach retry event listener
    const retryBtn = document.getElementById('retryLoadBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => location.reload());
    }
  }
}

function renderWAFMatrix() {
  if (!wafMatrix || wafMatrix.length === 0) {
    return `
      <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
        <p>WAF Matrix not available</p>
        <small>Matrix will be available after database migration</small>
      </div>
    `;
  }

  // Group by severity
  const severityGroups = {
    'critical': [],
    'error': [],
    'warning': [],
    'notice': []
  };

  wafMatrix.forEach(item => {
    if (severityGroups[item.severity_level]) {
      severityGroups[item.severity_level].push(item);
    }
  });

  let matrixHtml = `
    <div class="waf-matrix-container">
      <p style="margin-bottom: 16px; color: var(--text-secondary);">
        Configure notification thresholds for different combinations of event severity and frequency.
      </p>
      <div class="matrix-grid" style="display: grid; gap: 16px;">
  `;

  Object.entries(severityGroups).forEach(([severity, items]) => {
    if (items.length === 0) return;

    const severityColors = {
      'critical': '#f44336',
      'error': '#ff9800', 
      'warning': '#ffc107',
      'notice': '#4caf50'
    };

    const severityIcons = {
      'critical': '🚨',
      'error': '⚠️',
      'warning': '⚡',
      'notice': 'ℹ️'
    };

    matrixHtml += `
      <div class="severity-group" style="border: 2px solid ${severityColors[severity]}; border-radius: 8px; padding: 16px;">
        <h4 style="margin: 0 0 12px 0; color: ${severityColors[severity]}; display: flex; align-items: center; gap: 8px;">
          ${severityIcons[severity]} ${severity.toUpperCase()} Events
        </h4>
        <div class="threshold-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
    `;

    items.forEach(item => {
      matrixHtml += `
        <div class="threshold-item" style="border: 1px solid var(--border-color); border-radius: 4px; padding: 12px; background: var(--bg-secondary);">
          <div class="checkbox-group">
            <input type="checkbox" id="matrix_${item.id}" ${item.enabled ? 'checked' : ''}>
            <label for="matrix_${item.id}" style="font-weight: 500;">
              ${item.count_threshold}+ events in ${item.time_window}m
            </label>
          </div>
          <div style="margin-top: 8px; font-size: 12px;">
            <label for="matrix_delay_${item.id}" style="color: var(--text-secondary);">Cooldown:</label>
            <input 
              type="number" 
              id="matrix_delay_${item.id}" 
              value="${item.notification_delay || 0}" 
              min="0" 
              max="1440" 
              style="width: 60px; margin-left: 4px;"
            > min
          </div>
        </div>
      `;
    });

    matrixHtml += `
        </div>
      </div>
    `;
  });

  matrixHtml += `
      </div>
    </div>
  `;

  return matrixHtml;
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
        showToast('Test notification sent successfully!', 'success');
      } else {
        button.textContent = 'Failed';
        button.style.background = 'var(--danger-color)';
        showToast(`Failed to send: ${result.error || 'Unknown error'}`, 'error');
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

  // Configure matrix button
  const configureMatrixBtn = document.getElementById('configureMatrixBtn');
  if (configureMatrixBtn) {
    configureMatrixBtn.addEventListener('click', () => {
      const matrixCard = document.getElementById('wafMatrixCard');
      const isVisible = matrixCard.style.display !== 'none';
      matrixCard.style.display = isVisible ? 'none' : 'block';
      configureMatrixBtn.textContent = isVisible ? 'Configure Matrix' : 'Hide Matrix';
      
      if (!isVisible) {
        document.getElementById('saveMatrixOnly').style.display = 'inline-block';
      }
    });
  }

  // Matrix enabled checkbox
  document.getElementById('matrixEnabled').addEventListener('change', (e) => {
    if (e.target.checked) {
      document.getElementById('wafMatrixCard').style.display = 'block';
      document.getElementById('saveMatrixOnly').style.display = 'inline-block';
    }
  });

  // Save all settings
  document.getElementById('saveAllSettings').addEventListener('click', async () => {
    await saveAllSettings();
  });

  // Save matrix only
  const saveMatrixBtn = document.getElementById('saveMatrixOnly');
  if (saveMatrixBtn) {
    saveMatrixBtn.addEventListener('click', async () => {
      await saveWAFMatrix();
    });
  }
}

async function saveAllSettings() {
  const button = document.getElementById('saveAllSettings');
  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = 'Saving...';

  try {
    // Collect basic settings
    const appriseUrls = document.getElementById('appriseUrls').value
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0);

    const settings = {
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
      },
      enhanced: {
        matrix_enabled: document.getElementById('matrixEnabled').checked,
        daily_report_enabled: document.getElementById('dailyReportEnabled').checked,
        proxy_lifecycle_enabled: document.getElementById('proxyLifecycleEnabled').checked,
        batching_enabled: document.getElementById('batchingEnabled').checked,
        batch_interval: parseInt(document.getElementById('batchInterval').value),
        daily_report_time: document.getElementById('dailyReportTime').value
      }
    };

    // Validate
    if (settings.enabled && appriseUrls.length === 0) {
      showToast('Please add at least one Apprise URL or disable notifications', 'error');
      button.disabled = false;
      button.textContent = originalText;
      return;
    }

    // Save general settings
    await api.updateNotificationSettings(settings);
    
    // Save WAF matrix if enabled
    if (settings.enhanced.matrix_enabled && wafMatrix.length > 0) {
      await saveWAFMatrix(false); // Don't show toast for matrix save
    }

    button.textContent = 'Saved!';
    button.style.background = 'var(--success-color)';
    showToast('All notification settings saved successfully', 'success');

    setTimeout(() => {
      button.disabled = false;
      button.textContent = originalText;
      button.style.background = '';
    }, 2000);

  } catch (error) {
    console.error('Error saving settings:', error);
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

async function saveWAFMatrix(showToastMsg = true) {
  if (!wafMatrix || wafMatrix.length === 0) {
    if (showToastMsg) {
      showToast('No WAF matrix configuration available', 'warning');
    }
    return;
  }

  try {
    // Collect matrix settings
    const matrixData = wafMatrix.map(item => ({
      id: item.id,
      enabled: document.getElementById(`matrix_${item.id}`)?.checked || false,
      count_threshold: item.count_threshold, // Keep existing values
      time_window: item.time_window,
      notification_delay: parseInt(document.getElementById(`matrix_delay_${item.id}`)?.value || 0)
    }));

    await api.updateWAFMatrix({ matrix: matrixData });
    
    if (showToastMsg) {
      showToast('WAF Matrix settings saved successfully', 'success');
    }

  } catch (error) {
    console.error('Error saving WAF matrix:', error);
    if (showToastMsg) {
      showToast(`Failed to save WAF matrix: ${error.message}`, 'error');
    }
  }
}

async function loadNotificationHistory() {
  const container = document.getElementById('notificationHistoryContainer');

  try {
    const historyData = await api.getNotificationHistory();
    
    if (historyData.history && historyData.history.length > 0) {
      const historyHtml = historyData.history.map(item => {
        const statusColor = item.status === 'sent' ? 'var(--success-color)' : 
                           item.status === 'failed' ? 'var(--danger-color)' : 
                           'var(--warning-color)';
        
        const timeStr = new Date(item.sent_at).toLocaleString();
        
        return `
          <div style="border-bottom: 1px solid var(--border-color); padding: 12px 0;">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 4px;">
              <strong style="font-size: 14px;">${item.title}</strong>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="color: ${statusColor}; font-size: 12px; text-transform: uppercase; font-weight: bold;">
                  ${item.status}
                </span>
                <small style="color: var(--text-secondary);">${timeStr}</small>
              </div>
            </div>
            <p style="margin: 0; font-size: 13px; color: var(--text-secondary); line-height: 1.4;">
              ${item.message.length > 150 ? item.message.substring(0, 150) + '...' : item.message}
            </p>
            ${item.error_message ? `<small style="color: var(--danger-color);">Error: ${item.error_message}</small>` : ''}
          </div>
        `;
      }).join('');

      container.innerHTML = `
        <div style="padding: 20px;">
          ${historyHtml}
          ${historyData.total > historyData.history.length ? 
            `<div style="text-align: center; margin-top: 16px; color: var(--text-secondary);">
               <small>Showing ${historyData.history.length} of ${historyData.total} notifications</small>
             </div>` : ''
          }
        </div>
      `;
    } else {
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--text-secondary);">
          <p>No notifications sent yet</p>
          <small>Send a test notification to see it appear here</small>
        </div>
      `;
    }

  } catch (error) {
    console.error('Error loading notification history:', error);
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--text-secondary);">
        <p>Notification history coming soon</p>
        <small>History tracking will be available after system updates</small>
      </div>
    `;
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? 'var(--success-color)' : type === 'error' ? 'var(--danger-color)' : 'var(--primary-color)'};
    color: white;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    animation: slideInRight 0.3s ease-out;
    max-width: 350px;
    font-size: 14px;
    line-height: 1.4;
  `;
  toast.textContent = message;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}