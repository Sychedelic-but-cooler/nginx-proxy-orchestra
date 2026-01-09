import api from '../api.js';

let rules = [];

export async function renderDetectionRules(container) {
  // Show loading
  container.innerHTML = '<div class="loading-text">Loading detection rules...</div>';

  try {
    await loadRules();
    renderRulesList(container);
  } catch (error) {
    container.innerHTML = `<div class="error-message">Failed to load detection rules: ${error.message}</div>`;
  }
}

async function loadRules() {
  const response = await api.getDetectionRules();
  rules = response.rules || [];
}

function renderRulesList(container) {
  container.innerHTML = `
    <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 16px 20px; margin-bottom: 24px; border-radius: 4px;">
      <strong>Detection Rules:</strong> Define automatic banning triggers based on WAF events.
      The detection engine checks these rules every 5 seconds and automatically bans IPs that match.
    </div>

    <!-- Rules List -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Detection Rules</h3>
        <div class="card-actions">
          <button id="refreshRulesBtn" class="btn btn-secondary">Refresh</button>
        </div>
      </div>

      ${rules.length === 0 ? `
        <div style="padding: 50px 30px; text-align: center; color: var(--text-secondary);">
          <p style="font-size: 16px; margin-bottom: 8px;">No detection rules configured</p>
          <small>Click "Add Rule" to create your first detection rule</small>
        </div>
      ` : `
        <div style="padding: 20px;">
          <div style="display: grid; gap: 16px;">
            ${rules.map(rule => `
              <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 20px; background: var(--bg-secondary);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                  <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                      <label class="toggle-switch">
                        <input type="checkbox" class="toggle-rule-checkbox" data-id="${rule.id}" ${rule.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                      </label>
                      <h4 style="margin: 0; font-size: 16px;">${escapeHtml(rule.name)}</h4>
                      ${!rule.enabled ? '<span class="badge badge-secondary">Disabled</span>' : '<span class="badge badge-success">Enabled</span>'}
                      <span class="badge badge-${getSeverityColor(rule.ban_severity)}">${rule.ban_severity || 'MEDIUM'} Ban</span>
                    </div>
                    <div style="margin-left: 52px;">
                      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 12px;">
                        <div>
                          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Trigger</div>
                          <div style="font-size: 14px; font-weight: 500;">
                            ${rule.threshold} events in ${rule.time_window}s
                          </div>
                        </div>
                        <div>
                          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Ban Duration</div>
                          <div style="font-size: 14px; font-weight: 500;">${formatBanDuration(rule.ban_duration)}</div>
                        </div>
                        <div>
                          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Attack Types</div>
                          <div style="font-size: 13px;">
                            ${rule.attack_types && rule.attack_types.length > 0 ? rule.attack_types.join(', ') : 'All types'}
                          </div>
                        </div>
                        <div>
                          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Severity Filter</div>
                          <div style="font-size: 13px;">
                            ${rule.severity_filter && rule.severity_filter !== 'ALL' ? rule.severity_filter + '+' : 'All'}
                          </div>
                        </div>
                        <div>
                          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Scope</div>
                          <div style="font-size: 13px;">
                            ${rule.proxy_id ? 'Proxy #' + rule.proxy_id : 'All proxies'}
                          </div>
                        </div>
                        <div>
                          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Stats</div>
                          <div style="font-size: 14px;">
                            <span style="font-weight: 600;">${rule.total_bans || 0}</span> bans
                            <span style="color: var(--text-secondary); margin-left: 8px;">Priority: ${rule.priority || 100}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style="display: flex; gap: 8px;">
                    <button class="btn btn-sm btn-secondary btn-edit-rule" data-id="${rule.id}">
                      Edit
                    </button>
                    <button class="btn btn-sm btn-danger btn-delete-rule" data-id="${rule.id}" data-name="${escapeHtml(rule.name)}">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `}
    </div>
  `;

  // Attach event listeners
  attachEventListeners();
}

function attachEventListeners() {
  // Add Rule button (from header)
  const addRuleBtn = document.getElementById('addRuleBtn');
  if (addRuleBtn) {
    addRuleBtn.addEventListener('click', () => showRuleModal());
  }

  // Refresh button
  const refreshBtn = document.getElementById('refreshRulesBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      const mainContent = document.getElementById('mainContent');
      await renderDetectionRules(mainContent);
    });
  }

  // Toggle rule enabled/disabled
  document.querySelectorAll('.toggle-rule-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      await handleToggleRule(id);
    });
  });

  // Edit buttons
  document.querySelectorAll('.btn-edit-rule').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.currentTarget.dataset.id);
      const rule = rules.find(r => r.id === id);
      if (rule) {
        showRuleModal(rule);
      }
    });
  });

  // Delete buttons
  document.querySelectorAll('.btn-delete-rule').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const name = e.currentTarget.dataset.name;

      if (confirm(`Delete detection rule "${name}"?\n\nThis action cannot be undone.`)) {
        await handleDeleteRule(id);
      }
    });
  });
}

function showRuleModal(existingRule = null) {
  const isEdit = !!existingRule;

  const modalHTML = `
    <div class="modal-overlay" id="ruleModal">
      <div class="modal modal-large">
        <div class="modal-header">
          <h3>${isEdit ? 'Edit' : 'Create'} Detection Rule</h3>
          <button class="modal-close" id="closeRuleModal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="ruleForm">
            <div class="form-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <!-- Left Column -->
              <div>
                <h4 style="margin: 0 0 16px 0; font-size: 14px; color: var(--text-secondary);">Rule Configuration</h4>

                <div class="form-group">
                  <label for="ruleName">Rule Name *</label>
                  <input type="text" id="ruleName" value="${escapeHtml(existingRule?.name || '')}" placeholder="SQL Injection Detection" required>
                </div>

                <div class="form-group">
                  <label for="ruleThreshold">Threshold (Event Count) *</label>
                  <input type="number" id="ruleThreshold" value="${existingRule?.threshold || 10}" min="1" max="1000" required>
                  <small>Number of events required to trigger the ban</small>
                </div>

                <div class="form-group">
                  <label for="ruleTimeWindow">Time Window (seconds) *</label>
                  <input type="number" id="ruleTimeWindow" value="${existingRule?.time_window || 60}" min="1" max="3600" required>
                  <small>Time period to count events (1-3600 seconds)</small>
                </div>

                <div class="form-group">
                  <label for="rulePriority">Priority</label>
                  <input type="number" id="rulePriority" value="${existingRule?.priority || 100}" min="1" max="1000">
                  <small>Lower numbers = higher priority (checked first)</small>
                </div>

                <div class="form-group">
                  <div class="checkbox-group">
                    <input type="checkbox" id="ruleEnabled" ${existingRule?.enabled !== 0 ? 'checked' : ''}>
                    <label for="ruleEnabled">Enabled</label>
                  </div>
                </div>
              </div>

              <!-- Right Column -->
              <div>
                <h4 style="margin: 0 0 16px 0; font-size: 14px; color: var(--text-secondary);">Filters & Ban Action</h4>

                <div class="form-group">
                  <label for="ruleSeverityFilter">Minimum Severity</label>
                  <select id="ruleSeverityFilter">
                    <option value="ALL" ${existingRule?.severity_filter === 'ALL' || !existingRule?.severity_filter ? 'selected' : ''}>All Events</option>
                    <option value="WARNING" ${existingRule?.severity_filter === 'WARNING' ? 'selected' : ''}>Warning+</option>
                    <option value="ERROR" ${existingRule?.severity_filter === 'ERROR' ? 'selected' : ''}>Error+</option>
                    <option value="CRITICAL" ${existingRule?.severity_filter === 'CRITICAL' ? 'selected' : ''}>Critical Only</option>
                  </select>
                  <small>Only count events at or above this severity</small>
                </div>

                <div class="form-group">
                  <label for="ruleAttackTypes">Attack Types (optional)</label>
                  <input type="text" id="ruleAttackTypes" value="${existingRule?.attack_types?.join(', ') || ''}" placeholder="SQL-Injection, XSS, RCE">
                  <small>Comma-separated list (leave blank for all types)</small>
                </div>

                <div class="form-group">
                  <label for="ruleBanSeverity">Ban Severity</label>
                  <select id="ruleBanSeverity">
                    <option value="LOW" ${existingRule?.ban_severity === 'LOW' ? 'selected' : ''}>Low</option>
                    <option value="MEDIUM" ${existingRule?.ban_severity === 'MEDIUM' || !existingRule?.ban_severity ? 'selected' : ''}>Medium</option>
                    <option value="HIGH" ${existingRule?.ban_severity === 'HIGH' ? 'selected' : ''}>High</option>
                    <option value="CRITICAL" ${existingRule?.ban_severity === 'CRITICAL' ? 'selected' : ''}>Critical</option>
                  </select>
                </div>

                <div class="form-group">
                  <label for="ruleBanDuration">Ban Duration</label>
                  <select id="ruleBanDuration">
                    <option value="0" ${existingRule?.ban_duration === 0 ? 'selected' : ''}>Permanent</option>
                    <option value="3600" ${existingRule?.ban_duration === 3600 ? 'selected' : ''}>1 hour</option>
                    <option value="21600" ${existingRule?.ban_duration === 21600 ? 'selected' : ''}>6 hours</option>
                    <option value="86400" ${existingRule?.ban_duration === 86400 ? 'selected' : ''}>24 hours</option>
                    <option value="604800" ${existingRule?.ban_duration === 604800 ? 'selected' : ''}>7 days</option>
                    <option value="2592000" ${existingRule?.ban_duration === 2592000 ? 'selected' : ''}>30 days</option>
                  </select>
                </div>
              </div>
            </div>

            <div id="ruleError" style="color: var(--danger-color); margin-top: 16px; display: none;"></div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="cancelRuleBtn">Cancel</button>
          <button type="submit" form="ruleForm" class="btn btn-primary" id="saveRuleBtn">${isEdit ? 'Update' : 'Create'} Rule</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // Close handlers
  document.getElementById('closeRuleModal').addEventListener('click', closeRuleModal);
  document.getElementById('cancelRuleBtn').addEventListener('click', closeRuleModal);

  // Form submit
  document.getElementById('ruleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleSaveRule(existingRule?.id);
  });
}

function closeRuleModal() {
  const modal = document.getElementById('ruleModal');
  if (modal) modal.remove();
}

async function handleSaveRule(existingId = null) {
  const errorDiv = document.getElementById('ruleError');
  const saveBtn = document.getElementById('saveRuleBtn');

  const name = document.getElementById('ruleName').value.trim();
  const threshold = parseInt(document.getElementById('ruleThreshold').value);
  const timeWindow = parseInt(document.getElementById('ruleTimeWindow').value);
  const priority = parseInt(document.getElementById('rulePriority').value);
  const enabled = document.getElementById('ruleEnabled').checked;
  const severityFilter = document.getElementById('ruleSeverityFilter').value;
  const attackTypesStr = document.getElementById('ruleAttackTypes').value.trim();
  const banSeverity = document.getElementById('ruleBanSeverity').value;
  const banDuration = parseInt(document.getElementById('ruleBanDuration').value);

  if (!name || !threshold || !timeWindow) {
    errorDiv.textContent = 'Name, threshold, and time window are required';
    errorDiv.style.display = 'block';
    return;
  }

  const attackTypes = attackTypesStr ? attackTypesStr.split(',').map(t => t.trim()).filter(t => t) : null;

  errorDiv.style.display = 'none';
  saveBtn.disabled = true;
  saveBtn.textContent = existingId ? 'Updating...' : 'Creating...';

  try {
    const data = {
      name,
      threshold,
      time_window: timeWindow,
      priority,
      enabled,
      severity_filter: severityFilter,
      attack_types: attackTypes,
      ban_severity: banSeverity,
      ban_duration: banDuration
    };

    if (existingId) {
      await api.updateDetectionRule(existingId, data);
      showToast('Detection rule updated successfully', 'success');
    } else {
      await api.createDetectionRule(data);
      showToast('Detection rule created successfully', 'success');
    }

    closeRuleModal();

    // Reload rules list
    const mainContent = document.getElementById('mainContent');
    await renderDetectionRules(mainContent);
  } catch (error) {
    errorDiv.textContent = error.message || 'Failed to save rule';
    errorDiv.style.display = 'block';
    saveBtn.disabled = false;
    saveBtn.textContent = existingId ? 'Update Rule' : 'Create Rule';
  }
}

async function handleToggleRule(id) {
  try {
    await api.toggleDetectionRule(id);

    // Update local state
    const rule = rules.find(r => r.id === parseInt(id));
    if (rule) {
      rule.enabled = rule.enabled ? 0 : 1;
    }

    showToast(`Detection rule ${rule.enabled ? 'enabled' : 'disabled'}`, 'success');
  } catch (error) {
    showToast(`Failed to toggle rule: ${error.message}`, 'error');

    // Reload to restore state
    const mainContent = document.getElementById('mainContent');
    await renderDetectionRules(mainContent);
  }
}

async function handleDeleteRule(id) {
  try {
    await api.deleteDetectionRule(id);
    showToast('Detection rule deleted successfully', 'success');

    // Reload rules list
    const mainContent = document.getElementById('mainContent');
    await renderDetectionRules(mainContent);
  } catch (error) {
    showToast(`Failed to delete rule: ${error.message}`, 'error');
  }
}

// Helper functions
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getSeverityColor(severity) {
  const colors = {
    'LOW': 'info',
    'MEDIUM': 'warning',
    'HIGH': 'danger',
    'CRITICAL': 'danger'
  };
  return colors[severity] || 'info';
}

function formatBanDuration(seconds) {
  if (!seconds || seconds === 0) return 'Permanent';

  const hours = seconds / 3600;
  if (hours < 1) return `${seconds / 60}m`;
  if (hours < 24) return `${hours}h`;
  return `${hours / 24}d`;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196F3'};
    color: white;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
