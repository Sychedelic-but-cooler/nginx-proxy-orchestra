import api from '../api.js';

let profiles = [];

export async function renderWAFProfiles(container) {
  // Set page title
  const headerTitle = document.getElementById('headerTitle');
  if (headerTitle) {
    headerTitle.textContent = 'WAF Profiles';
  }

  // Show loading
  container.innerHTML = '<div class="loading-text">Loading WAF profiles...</div>';

  try {
    // Load profiles
    const response = await api.getWAFProfiles();
    profiles = response.profiles || [];

    // Load exclusion counts for each profile
    for (const profile of profiles) {
      try {
        const exclusionsResponse = await api.getWAFExclusions(profile.id);
        profile.exclusion_count = exclusionsResponse.exclusions?.length || 0;
      } catch (error) {
        console.warn(`Failed to load exclusions for profile ${profile.id}:`, error);
        profile.exclusion_count = 0;
      }
    }

    container.innerHTML = `
      <div class="waf-profiles">
        <!-- Header with actions -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <div>
            <h2 style="margin: 0 0 8px 0;">WAF Profiles</h2>
            <p style="margin: 0; color: var(--text-secondary);">
              Manage ModSecurity/OWASP CRS protection profiles for your proxies
            </p>
          </div>
          <button id="createProfileBtn" class="btn btn-primary">+ Create Profile</button>
        </div>

        <!-- Profiles Grid -->
        <div id="profilesGrid" class="profiles-grid">
          ${profiles.length === 0 ? renderEmptyState() : renderProfilesGrid()}
        </div>
      </div>

      <style>
        .profiles-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
          gap: 20px;
          align-items: stretch;
        }

        .profile-card {
          background: white;
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 20px;
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .profile-card:hover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          transform: translateY(-2px);
        }

        .profile-card.default {
          border-color: #1e293b;
          border-width: 2px;
          background: linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%);
        }

        .profile-header {
          display: flex;
          justify-content: space-between;
          align-items: start;
          margin-bottom: 16px;
        }

        .profile-title {
          flex: 1;
        }

        .profile-name {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0 0 4px 0;
        }

        .profile-description {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0;
          min-height: 36px;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .profile-badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .badge-default {
          background: #1e293b;
          color: white;
        }

        .profile-details {
          display: grid;
          gap: 12px;
          margin-bottom: 16px;
          flex-grow: 1;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background: #f8f9fa;
          border-radius: 6px;
          font-size: 13px;
        }

        .detail-label {
          color: var(--text-secondary);
          font-weight: 500;
        }

        .detail-value {
          color: var(--text-primary);
          font-weight: 600;
        }

        .paranoia-level {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }

        .paranoia-dots {
          display: flex;
          gap: 2px;
        }

        .paranoia-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #ddd;
        }

        .paranoia-dot.active {
          background: #f44336;
        }

        .profile-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding-top: 16px;
          border-top: 1px solid var(--border-color);
          margin-top: auto;
        }

        .profile-actions .btn {
          padding: 8px 12px;
          font-size: 13px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          border: 1px solid var(--border-color);
          background: white;
          color: var(--text-primary);
          font-weight: 500;
        }

        .profile-actions .btn-secondary {
          background: #f1f5f9;
          color: #1e293b;
          border: 1px solid #cbd5e1;
        }

        .profile-actions .btn-secondary:hover {
          background: #e2e8f0;
          border-color: #1e293b;
        }

        .profile-actions .btn-danger {
          background: white;
          color: #ef4444;
          border: 1px solid #fca5a5;
        }

        .profile-actions .btn-danger:hover {
          background: #fef2f2;
          border-color: #ef4444;
        }

        .empty-state {
          text-align: center;
          padding: 60px 20px;
          background: white;
          border: 2px dashed var(--border-color);
          border-radius: 12px;
        }

        .empty-state-icon {
          font-size: 64px;
          margin-bottom: 16px;
        }

        .empty-state h3 {
          margin: 0 0 8px 0;
          color: var(--text-primary);
        }

        .empty-state p {
          margin: 0 0 24px 0;
          color: var(--text-secondary);
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 20px;
        }

        .modal-large {
          background: white;
          border-radius: 12px;
          width: 100%;
          max-width: 800px;
          max-height: 90vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .modal-large .modal-body {
          overflow-y: auto;
          padding: 24px;
        }

        .form-section {
          margin-bottom: 24px;
          padding-bottom: 24px;
          border-bottom: 1px solid var(--border-color);
        }

        .form-section:last-child {
          border-bottom: none;
          margin-bottom: 0;
          padding-bottom: 0;
        }

        .form-section-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 16px 0;
        }

        .checkbox-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 12px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          padding: 8px;
          border-radius: 6px;
          transition: background 0.2s;
        }

        .checkbox-label:hover {
          background: #f8f9fa;
        }

        .checkbox-label input[type="checkbox"] {
          cursor: pointer;
        }
      </style>
    `;

    // Setup event listeners
    setupEventListeners();

  } catch (error) {
    console.error('Error loading WAF profiles:', error);
    container.innerHTML = `
      <div class="card">
        <div style="padding: 20px; text-align: center;">
          <p style="color: var(--danger-color); margin-bottom: 16px;">
            Failed to load WAF profiles: ${error.message}
          </p>
          <button id="retryLoadBtn" class="btn btn-secondary">Retry</button>
        </div>
      </div>
    `;

    document.getElementById('retryLoadBtn')?.addEventListener('click', () => {
      location.reload();
    });
  }
}

function renderEmptyState() {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">🛡️</div>
      <h3>No WAF Profiles Yet</h3>
      <p>Create your first WAF profile to start protecting your proxies</p>
      <button id="createFirstProfileBtn" class="btn btn-primary">
        Create First Profile
      </button>
    </div>
  `;
}

function renderProfilesGrid() {
  return profiles.map(profile => {
    const isDefault = profile.is_default;
    const paranoiaLevel = profile.paranoia_level || 1;

    // Parse config_json to get blocking_mode
    let blockingMode = 'anomaly_scoring'; // default
    try {
      const config = typeof profile.config_json === 'string'
        ? JSON.parse(profile.config_json)
        : profile.config_json;
      blockingMode = config.blocking_mode || 'anomaly_scoring';
    } catch (e) {
      console.warn('Failed to parse config_json for profile', profile.id);
    }

    const blockingModeText = blockingMode === 'anomaly_scoring' ? 'Anomaly Scoring' : 'Self-Contained';

    return `
      <div class="profile-card ${isDefault ? 'default' : ''}" data-profile-id="${profile.id}">
        <div class="profile-header">
          <div class="profile-title">
            <h3 class="profile-name">${escapeHtml(profile.name)}</h3>
            <p class="profile-description">${escapeHtml(profile.description || 'No description')}</p>
          </div>
          ${isDefault ? '<span class="profile-badge badge-default">Default</span>' : ''}
        </div>

        <div class="profile-details">
          <div class="detail-row">
            <span class="detail-label">Ruleset</span>
            <span class="detail-value">${escapeHtml(profile.ruleset || 'OWASP CRS 4.0')}</span>
          </div>

          <div class="detail-row">
            <span class="detail-label">Paranoia Level</span>
            <span class="detail-value paranoia-level">
              ${paranoiaLevel}
              <span class="paranoia-dots">
                ${[1, 2, 3, 4].map(i => `
                  <span class="paranoia-dot ${i <= paranoiaLevel ? 'active' : ''}"></span>
                `).join('')}
              </span>
            </span>
          </div>

          <div class="detail-row">
            <span class="detail-label">Blocking Mode</span>
            <span class="detail-value">${blockingModeText}</span>
          </div>

          <div class="detail-row">
            <span class="detail-label">Proxies Using</span>
            <span class="detail-value">${profile.proxy_count || 0}</span>
          </div>
        </div>

        <div class="profile-actions">
          <button class="btn btn-secondary btn-edit-profile" data-profile-id="${profile.id}">Edit</button>
          <button class="btn btn-secondary btn-view-config" data-profile-id="${profile.id}">View Config</button>
          <button class="btn btn-secondary btn-view-exclusions" data-profile-id="${profile.id}">Exclusions (${profile.exclusion_count || 0})</button>
          <button class="btn btn-danger btn-delete-profile" data-profile-id="${profile.id}" data-proxy-count="${profile.proxy_count || 0}">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function setupEventListeners() {
  // Create profile button
  document.getElementById('createProfileBtn').addEventListener('click', () => {
    showProfileModal();
  });

  // Create first profile button (in empty state)
  const createFirstBtn = document.getElementById('createFirstProfileBtn');
  if (createFirstBtn) {
    createFirstBtn.addEventListener('click', () => {
      document.getElementById('createProfileBtn').click();
    });
  }

  // Profile action buttons - use event delegation on container
  const profilesGrid = document.getElementById('profilesGrid');
  if (profilesGrid) {
    profilesGrid.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.btn-edit-profile');
      const viewBtn = e.target.closest('.btn-view-config');
      const exclusionsBtn = e.target.closest('.btn-view-exclusions');
      const deleteBtn = e.target.closest('.btn-delete-profile');

      if (editBtn) {
        const profileId = parseInt(editBtn.dataset.profileId);
        showProfileModal(profileId);
      } else if (viewBtn) {
        const profileId = parseInt(viewBtn.dataset.profileId);
        const profile = profiles.find(p => p.id === profileId);
        if (profile) {
          showProfileConfigModal(profileId, profile.name);
        }
      } else if (exclusionsBtn) {
        const profileId = parseInt(exclusionsBtn.dataset.profileId);
        const profile = profiles.find(p => p.id === profileId);
        if (profile) {
          showProfileExclusionsModal(profileId, profile.name);
        }
      } else if (deleteBtn) {
        const profileId = parseInt(deleteBtn.dataset.profileId);
        const proxyCount = parseInt(deleteBtn.dataset.proxyCount);
        deleteProfile(profileId, proxyCount);
      }
    });
  }
}

async function deleteProfile(profileId, proxyCount) {
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return;

  if (proxyCount > 0) {
    alert(`Cannot delete profile "${profile.name}".\n\nThis profile is currently assigned to ${proxyCount} proxy/proxies.\n\nPlease remove the profile from all proxies first.`);
    return;
  }

  if (!confirm(`Delete WAF profile "${profile.name}"?\n\nThis action cannot be undone.`)) {
    return;
  }

  try {
    await api.deleteWAFProfile(profileId);
    await renderWAFProfiles(document.getElementById('mainContent'));
    showToast('Profile deleted successfully', 'success');
  } catch (error) {
    alert(`Failed to delete profile: ${error.message}`);
  }
}

function showProfileModal(profileId = null) {
  const isEdit = profileId !== null;
  const profile = isEdit ? profiles.find(p => p.id === profileId) : null;

  // Parse config_json if editing
  let config = {};
  if (isEdit && profile && profile.config_json) {
    try {
      config = typeof profile.config_json === 'string'
        ? JSON.parse(profile.config_json)
        : profile.config_json;
    } catch (e) {
      console.error('Failed to parse profile config_json:', e);
      config = {};
    }
  }

  const modalHTML = `
    <div class="modal-overlay" id="profileModal">
      <div class="modal-large">
        <div class="modal-header">
          <h3>${isEdit ? 'Edit WAF Profile' : 'Create WAF Profile'}</h3>
          <button class="modal-close" id="closeProfileModal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="profileForm">
            <!-- Basic Information -->
            <div class="form-section">
              <h4 class="form-section-title">Basic Information</h4>

              <div class="form-group">
                <label for="profileName">Profile Name *</label>
                <input type="text" id="profileName" required
                  value="${isEdit ? escapeHtml(profile.name) : ''}"
                  placeholder="e.g., High Security, Medium Protection">
              </div>

              <div class="form-group">
                <label for="profileDescription">Description</label>
                <textarea id="profileDescription" rows="2"
                  placeholder="Describe when to use this profile">${isEdit ? escapeHtml(profile.description || '') : ''}</textarea>
              </div>
            </div>

            <!-- Core Settings -->
            <div class="form-section">
              <h4 class="form-section-title">Core Settings</h4>

              <div class="form-group">
                <label for="profileRuleset">Ruleset</label>
                <select id="profileRuleset">
                  <option value="owasp-crs-4.0" ${isEdit && profile.ruleset === 'owasp-crs-4.0' ? 'selected' : ''}>OWASP CRS 4.0</option>
                  <option value="owasp-crs-3.3" ${isEdit && profile.ruleset === 'owasp-crs-3.3' ? 'selected' : ''}>OWASP CRS 3.3</option>
                </select>
              </div>

              <div class="form-group">
                <label for="paranoiaLevel">Paranoia Level (1-4) *</label>
                <select id="paranoiaLevel">
                  <option value="1" ${isEdit && profile.paranoia_level === 1 ? 'selected' : ''}>Level 1 - Basic (Recommended for most sites)</option>
                  <option value="2" ${isEdit && profile.paranoia_level === 2 ? 'selected' : ''}>Level 2 - Elevated (More aggressive)</option>
                  <option value="3" ${isEdit && profile.paranoia_level === 3 ? 'selected' : ''}>Level 3 - High (Risk of false positives)</option>
                  <option value="4" ${isEdit && profile.paranoia_level === 4 ? 'selected' : ''}>Level 4 - Paranoid (Expect false positives)</option>
                </select>
                <small style="color: var(--text-secondary); display: block; margin-top: 4px;">
                  Higher levels provide more protection but may block legitimate traffic
                </small>
              </div>

              <div class="form-group">
                <label for="blockingMode">Blocking Mode</label>
                <select id="blockingMode">
                  <option value="anomaly_scoring" ${isEdit && config.blocking_mode === 'anomaly_scoring' ? 'selected' : ''}>
                    Anomaly Scoring (Recommended)
                  </option>
                  <option value="self_contained" ${isEdit && config.blocking_mode === 'self_contained' ? 'selected' : ''}>
                    Self-Contained (Block on first match)
                  </option>
                </select>
              </div>
            </div>

            <!-- Anomaly Thresholds -->
            <div class="form-section">
              <h4 class="form-section-title">Anomaly Thresholds</h4>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                <div class="form-group">
                  <label for="inboundThreshold">Inbound Threshold *</label>
                  <input type="number" id="inboundThreshold" required min="1" max="100"
                    value="${isEdit ? (config.anomaly_threshold_inbound || 5) : 5}">
                  <small>Score needed to block incoming requests (default: 5)</small>
                </div>

                <div class="form-group">
                  <label for="outboundThreshold">Outbound Threshold *</label>
                  <input type="number" id="outboundThreshold" required min="1" max="100"
                    value="${isEdit ? (config.anomaly_threshold_outbound || 4) : 4}">
                  <small>Score needed to block outgoing responses (default: 4)</small>
                </div>
              </div>
            </div>

            <!-- Rule Groups -->
            <div class="form-section">
              <h4 class="form-section-title">Enable Rule Groups</h4>
              <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 16px;">
                Select which types of attacks to protect against
              </p>

              <div class="checkbox-grid">
                ${renderRuleGroupCheckboxes(config)}
              </div>
            </div>

            <!-- Advanced Settings -->
            <div class="form-section">
              <h4 class="form-section-title">Advanced Settings</h4>

              <div class="form-group">
                <label for="ruleEngineMode">Rule Engine Mode</label>
                <select id="ruleEngineMode">
                  <option value="DetectionOnly" ${isEdit && config.rule_engine_mode === 'DetectionOnly' ? 'selected' : ''}>
                    DetectionOnly - Log attacks but don't block (Recommended for testing)
                  </option>
                  <option value="On" ${isEdit && config.rule_engine_mode === 'On' ? 'selected' : ''}>
                    On - Block malicious requests (Production mode)
                  </option>
                  <option value="Off" ${isEdit && config.rule_engine_mode === 'Off' ? 'selected' : ''}>
                    Off - Disable WAF completely
                  </option>
                </select>
                <small style="color: var(--text-secondary); display: block; margin-top: 4px;">
                  <strong>DetectionOnly:</strong> Logs all attacks without blocking (test mode)<br>
                  <strong>On:</strong> Actively blocks malicious requests with HTTP 403<br>
                  <strong>Off:</strong> Completely disables ModSecurity for this site
                </small>
              </div>

              <div class="form-group">
                <label for="logLevel">Log Level</label>
                <select id="logLevel">
                  <option value="debug" ${isEdit && config.log_level === 'debug' ? 'selected' : ''}>Debug</option>
                  <option value="info" ${isEdit && config.log_level === 'info' ? 'selected' : ''}>Info</option>
                  <option value="warn" ${isEdit && config.log_level === 'warn' ? 'selected' : ''}>Warning (Recommended)</option>
                  <option value="error" ${isEdit && config.log_level === 'error' ? 'selected' : ''}>Error</option>
                </select>
              </div>
            </div>

            <div id="profileError" style="color: var(--danger-color); margin-top: 16px; display: none;"></div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="cancelProfileBtn">Cancel</button>
          <button type="submit" form="profileForm" class="btn btn-primary" id="saveProfileBtn">
            ${isEdit ? 'Update Profile' : 'Create Profile'}
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modalContainer').innerHTML = modalHTML;

  // Close handlers
  document.getElementById('closeProfileModal').addEventListener('click', closeProfileModal);
  document.getElementById('cancelProfileBtn').addEventListener('click', closeProfileModal);

  // Form submit handler
  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveProfile(profileId);
  });
}

function renderRuleGroupCheckboxes(config) {
  const ruleGroups = [
    { id: 'sql_injection', label: 'SQL Injection (SQLi)' },
    { id: 'xss', label: 'Cross-Site Scripting (XSS)' },
    { id: 'rce', label: 'Remote Code Execution (RCE)' },
    { id: 'rfi', label: 'Remote File Inclusion (RFI)' },
    { id: 'lfi', label: 'Local File Inclusion (LFI)' },
    { id: 'php_injection', label: 'PHP Code Injection' },
    { id: 'java_injection', label: 'Java Code Injection' },
    { id: 'session_fixation', label: 'Session Fixation' },
    { id: 'multipart_attack', label: 'Multipart/Form-Data Attack' },
    { id: 'generic_attack', label: 'Generic Application Attack' },
    { id: 'protocol_attack', label: 'Protocol Attack' },
    { id: 'protocol_enforcement', label: 'Protocol Enforcement' },
    { id: 'request_limits', label: 'Request Limits' },
    { id: 'scanner_detection', label: 'Scanner/Bot Detection' }
  ];

  // config.rule_groups is an object like { sql_injection: true, xss: false, ... }
  // Default to all enabled if no config provided
  const ruleGroupsConfig = config?.rule_groups || {};
  const hasExistingConfig = config && Object.keys(ruleGroupsConfig).length > 0;

  return ruleGroups.map(group => {
    // If editing with existing config, use the saved value
    // Otherwise default to checked for common protections
    const isChecked = hasExistingConfig
      ? (ruleGroupsConfig[group.id] === true)
      : ['sql_injection', 'xss', 'rce', 'php_injection', 'protocol_enforcement', 'protocol_attack', 'request_limits', 'scanner_detection'].includes(group.id);

    return `
      <label class="checkbox-label">
        <input type="checkbox" name="ruleGroup" value="${group.id}"
          ${isChecked ? 'checked' : ''}>
        <span>${group.label}</span>
      </label>
    `;
  }).join('');
}

async function saveProfile(profileId) {
  const errorDiv = document.getElementById('profileError');
  const saveBtn = document.getElementById('saveProfileBtn');

  // Collect form data
  const name = document.getElementById('profileName').value.trim();
  const description = document.getElementById('profileDescription').value.trim();
  const ruleset = document.getElementById('profileRuleset').value;
  const paranoiaLevel = parseInt(document.getElementById('paranoiaLevel').value);
  const blockingMode = document.getElementById('blockingMode').value;
  const inboundThreshold = parseInt(document.getElementById('inboundThreshold').value);
  const outboundThreshold = parseInt(document.getElementById('outboundThreshold').value);
  const ruleEngineMode = document.getElementById('ruleEngineMode').value;
  const logLevel = document.getElementById('logLevel').value;

  // Collect enabled rule groups as an object with boolean values
  // All rule groups must be present with true/false values
  const allRuleGroups = [
    'sql_injection', 'xss', 'rce', 'rfi', 'lfi', 'php_injection', 'java_injection',
    'session_fixation', 'multipart_attack', 'generic_attack',
    'protocol_attack', 'protocol_enforcement', 'request_limits', 'scanner_detection'
  ];

  const checkedGroups = Array.from(document.querySelectorAll('input[name="ruleGroup"]:checked'))
    .map(cb => cb.value);

  const ruleGroupsObject = {};
  allRuleGroups.forEach(group => {
    ruleGroupsObject[group] = checkedGroups.includes(group);
  });

  console.log('Saving profile with rule groups:', ruleGroupsObject);

  // Validation
  if (!name) {
    errorDiv.textContent = 'Profile name is required';
    errorDiv.style.display = 'block';
    return;
  }

  if (paranoiaLevel < 1 || paranoiaLevel > 4) {
    errorDiv.textContent = 'Paranoia level must be between 1 and 4';
    errorDiv.style.display = 'block';
    return;
  }

  if (inboundThreshold < 1 || outboundThreshold < 1) {
    errorDiv.textContent = 'Anomaly thresholds must be greater than 0';
    errorDiv.style.display = 'block';
    return;
  }

  errorDiv.style.display = 'none';
  saveBtn.disabled = true;
  saveBtn.textContent = profileId ? 'Updating...' : 'Creating...';

  try {
    // Structure data correctly: settings go inside config_json
    const data = {
      name,
      description,
      ruleset,
      paranoia_level: paranoiaLevel,
      config_json: {
        blocking_mode: blockingMode,
        anomaly_threshold_inbound: inboundThreshold,
        anomaly_threshold_outbound: outboundThreshold,
        rule_groups: ruleGroupsObject,
        rule_engine_mode: ruleEngineMode,
        log_level: logLevel
      }
    };

    if (profileId) {
      await api.updateWAFProfile(profileId, data);
    } else {
      await api.createWAFProfile(data);
    }

    closeProfileModal();
    await renderWAFProfiles(document.getElementById('mainContent'));
    showToast(`Profile ${profileId ? 'updated' : 'created'} successfully`, 'success');

  } catch (error) {
    errorDiv.textContent = error.message || 'Failed to save profile';
    errorDiv.style.display = 'block';
    saveBtn.disabled = false;
    saveBtn.textContent = profileId ? 'Update Profile' : 'Create Profile';
  }
}

function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) modal.remove();
}


async function showProfileConfigModal(profileId, profileName) {
  try {
    const response = await api.getWAFProfileConfig(profileId);

    const modalHTML = `
      <div class="modal-overlay" id="configViewModal">
        <div class="modal-large">
          <div class="modal-header">
            <h3>ModSecurity Configuration: ${escapeHtml(profileName)}</h3>
            <button class="modal-close" id="closeConfigModal">&times;</button>
          </div>
          <div class="modal-body">
            <div style="margin-bottom: 12px; padding: 8px 12px; background: #e3f2fd; border-radius: 4px; font-size: 13px;">
              <strong>File:</strong> <code>${escapeHtml(response.config_path)}</code>
            </div>
            <div style="background: #1e1e1e; border-radius: 4px; overflow: hidden;">
              <pre style="margin: 0; padding: 16px; color: #d4d4d4; font-family: 'Consolas', 'Monaco', monospace; font-size: 12px; line-height: 1.5; max-height: 600px; overflow-y: auto;">${escapeHtml(response.config_content)}</pre>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="closeConfigModalBtn">Close</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Setup event listeners
    document.getElementById('closeConfigModal').addEventListener('click', closeConfigModal);
    document.getElementById('closeConfigModalBtn').addEventListener('click', closeConfigModal);

    // Close on overlay click
    document.getElementById('configViewModal').addEventListener('click', (e) => {
      if (e.target.id === 'configViewModal') {
        closeConfigModal();
      }
    });

  } catch (error) {
    console.error('Failed to load config:', error);
    showToast('Failed to load configuration: ' + error.message, 'error');
  }
}

function closeConfigModal() {
  const modal = document.getElementById('configViewModal');
  if (modal) modal.remove();
}

async function showProfileExclusionsModal(profileId, profileName) {
  try {
    const response = await api.getWAFExclusions(profileId);
    const exclusions = response.exclusions || [];

    const modalHTML = `
      <div class="modal-overlay" id="exclusionsModal">
        <div class="modal-large">
          <div class="modal-header">
            <h3>WAF Exclusions: ${escapeHtml(profileName)}</h3>
            <button class="modal-close" id="closeExclusionsModal">&times;</button>
          </div>
          <div class="modal-body">
            ${exclusions.length === 0 ? `
              <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
                <h4 style="margin: 0 0 8px 0;">No exclusions configured for this profile</h4>
                <p style="margin: 0; font-size: 14px;">Exclusions can be created from WAF Events when you detect false positives</p>
              </div>
            ` : `
              <div style="margin-bottom: 16px; padding: 12px; background: #e3f2fd; border-radius: 4px; font-size: 13px;">
                <strong>ℹ️ Profile-Level Exclusions:</strong> These exclusions apply to all ${exclusions[0]?.proxy_count || 'proxies'} using this WAF profile.
              </div>
              <div style="overflow-x: auto;">
                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                  <thead>
                    <tr style="background: #f8f9fa; border-bottom: 2px solid var(--border-color);">
                      <th style="padding: 12px; text-align: left; font-weight: 600;">Rule ID</th>
                      <th style="padding: 12px; text-align: left; font-weight: 600;">Scope</th>
                      <th style="padding: 12px; text-align: left; font-weight: 600;">Pattern/Parameter</th>
                      <th style="padding: 12px; text-align: left; font-weight: 600;">Reason</th>
                      <th style="padding: 12px; text-align: left; font-weight: 600;">Created</th>
                      <th style="padding: 12px; text-align: center; font-weight: 600;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${exclusions.map(ex => `
                      <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 12px; font-family: monospace; font-size: 13px; color: #d32f2f;">${escapeHtml(ex.rule_id)}</td>
                        <td style="padding: 12px; font-size: 13px;">
                          <span style="display: inline-block; padding: 2px 8px; background: #e3f2fd; border-radius: 4px; font-size: 12px;">
                            ${getScopeLabel(ex)}
                          </span>
                        </td>
                        <td style="padding: 12px; font-size: 12px; font-family: monospace; color: var(--text-secondary);">
                          ${ex.path_pattern ? `<div style="margin-bottom: 4px;"><strong>Path:</strong> ${escapeHtml(ex.path_pattern)}</div>` : ''}
                          ${ex.parameter_name ? `<div><strong>Param:</strong> ${escapeHtml(ex.parameter_name)}</div>` : ''}
                          ${!ex.path_pattern && !ex.parameter_name ? '<span style="color: #999;">Global (all requests)</span>' : ''}
                        </td>
                        <td style="padding: 12px; font-size: 13px; max-width: 250px;">${escapeHtml(ex.reason || 'No reason provided')}</td>
                        <td style="padding: 12px; font-size: 12px; white-space: nowrap; color: var(--text-secondary);">${formatDate(ex.created_at)}</td>
                        <td style="padding: 12px; text-align: center;">
                          <button class="btn btn-danger btn-sm btn-delete-exclusion" data-exclusion-id="${ex.id}" style="padding: 4px 12px; font-size: 12px;">
                            Delete
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="closeExclusionsModalBtn">Close</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Close handlers
    document.getElementById('closeExclusionsModal').addEventListener('click', closeExclusionsModal);
    document.getElementById('closeExclusionsModalBtn').addEventListener('click', closeExclusionsModal);

    // Close on overlay click
    document.getElementById('exclusionsModal').addEventListener('click', (e) => {
      if (e.target.id === 'exclusionsModal') {
        closeExclusionsModal();
      }
    });

    // Delete handlers
    document.querySelectorAll('.btn-delete-exclusion').forEach(btn => {
      btn.addEventListener('click', async () => {
        const exclusionId = btn.dataset.exclusionId;
        if (confirm('Delete this exclusion?\n\nThe rule will be re-enabled for all proxies using this profile.')) {
          await deleteExclusion(exclusionId, profileId, profileName);
        }
      });
    });

  } catch (error) {
    console.error('Failed to load exclusions:', error);
    showToast('Failed to load exclusions: ' + error.message, 'error');
  }
}

function closeExclusionsModal() {
  const modal = document.getElementById('exclusionsModal');
  if (modal) modal.remove();
}

function getScopeLabel(exclusion) {
  if (exclusion.path_pattern && exclusion.parameter_name) {
    return 'Path + Parameter';
  }
  if (exclusion.path_pattern) {
    return 'Path';
  }
  if (exclusion.parameter_name) {
    return 'Parameter';
  }
  return 'Global';
}

async function deleteExclusion(exclusionId, profileId, profileName) {
  try {
    await api.deleteWAFExclusion(exclusionId);
    showToast('Exclusion deleted successfully', 'success');

    // Refresh modal to show updated list
    closeExclusionsModal();
    showProfileExclusionsModal(profileId, profileName);

    // Refresh profiles grid to update exclusion counts
    await renderWAFProfiles(document.getElementById('mainContent'));
  } catch (error) {
    console.error('Failed to delete exclusion:', error);
    showToast('Failed to delete exclusion: ' + error.message, 'error');
  }
}

function formatDate(dateString) {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    return dateString;
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

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}
