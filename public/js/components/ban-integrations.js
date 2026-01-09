import api from '../api.js';

let integrations = [];
let credentials = [];

export async function renderBanIntegrations(container) {
  // Show loading
  container.innerHTML = '<div class="loading-text">Loading ban integrations...</div>';

  try {
    await loadData();
    renderIntegrationsList(container);
  } catch (error) {
    container.innerHTML = `<div class="error-message">Failed to load integrations: ${error.message}</div>`;
  }
}

async function loadData() {
  const [integrationsResponse, credentialsResponse] = await Promise.all([
    api.getBanIntegrations(),
    api.getCredentials()
  ]);

  integrations = integrationsResponse.integrations || [];
  credentials = credentialsResponse.credentials || [];
}

function renderIntegrationsList(container) {
  container.innerHTML = `
    <div class="info-banner" style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 16px 20px; margin-bottom: 24px; border-radius: 4px;">
      <strong>Important:</strong> Multiple integrations increase system complexity.
      Only one upstream firewall blocker is really needed. Configure only what you actually use.
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Upstream Firewall Integrations</h3>
        <div class="card-actions">
          <button id="refreshIntegrationsBtn" class="btn btn-secondary">Refresh</button>
        </div>
      </div>

      ${integrations.length === 0 ? `
        <div style="padding: 50px 30px; text-align: center; color: var(--text-secondary);">
          <p style="font-size: 16px; margin-bottom: 8px;">No integrations configured</p>
          <small>Click "Add Integration" to connect to upstream firewalls</small>
          <div style="margin-top: 24px; font-size: 14px;">
            <p><strong>Supported Providers:</strong></p>
            <p>UniFi (Ubiquiti), Cloudflare, pfSense, OPNsense, firewalld, UFW, iptables/ipset</p>
          </div>
        </div>
      ` : `
        <div style="padding: 20px;">
          <div style="display: grid; gap: 16px;">
            ${integrations.map(integration => `
              <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 20px; background: var(--bg-secondary);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                  <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                      <label class="toggle-switch">
                        <input type="checkbox" class="toggle-integration-checkbox" data-id="${integration.id}" ${integration.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                      </label>
                      <h4 style="margin: 0; font-size: 16px;">${escapeHtml(integration.name)}</h4>
                      ${!integration.enabled ? '<span class="badge badge-secondary">Disabled</span>' : '<span class="badge badge-success">Enabled</span>'}
                    </div>
                    <div style="margin-left: 52px;">
                      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                        <span class="badge badge-info">${escapeHtml(integration.provider_info?.name || integration.type)}</span>
                        ${integration.provider_info?.supports_batch ? '<span class="badge badge-secondary" title="Supports batch operations">Batch</span>' : ''}
                      </div>
                      <p style="font-size: 13px; color: var(--text-secondary); margin: 0 0 10px 0;">${escapeHtml(integration.provider_info?.description || '')}</p>
                      <div style="display: flex; gap: 20px; font-size: 13px;">
                        ${integration.credential_name ? `
                          <div>
                            <span style="color: var(--text-secondary);">Credential:</span>
                            <span style="font-weight: 500;"> ${escapeHtml(integration.credential_name)}</span>
                          </div>
                        ` : '<div><span style="color: var(--text-secondary);">Credential: None</span></div>'}
                        <div>
                          <span style="color: var(--text-secondary);">Bans Sent:</span>
                          <span style="font-weight: 600;"> ${integration.bans_sent || 0}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style="display: flex; gap: 8px;">
                    <button class="btn btn-sm btn-secondary btn-test-integration" data-id="${integration.id}" ${!integration.credential_id ? 'disabled' : ''}>
                      Test
                    </button>
                    <button class="btn btn-sm btn-secondary btn-edit-integration" data-id="${integration.id}">
                      Edit
                    </button>
                    <button class="btn btn-sm btn-danger btn-delete-integration" data-id="${integration.id}" data-name="${escapeHtml(integration.name)}">
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

    <!-- Information Card -->
    <div class="card" style="margin-top: 24px;">
      <div class="card-header">
        <h3 class="card-title">About Ban Integrations</h3>
      </div>
      <div style="padding: 24px; font-size: 14px; line-height: 1.7;">
        <p><strong>How it works:</strong></p>
        <ul style="margin: 10px 0; padding-left: 24px; line-height: 1.8;">
          <li>Ban/unban operations are queued for each enabled integration</li>
          <li>Rate limited: 1 request per 5 seconds per integration</li>
          <li>Multiple operations are batched when provider supports it</li>
          <li>Failed operations automatically retry (max 3 attempts)</li>
        </ul>

        <p style="margin-top: 20px;"><strong>Provider Status:</strong></p>
        <ul style="margin: 10px 0; padding-left: 24px; line-height: 1.8;">
          <li><strong>Available:</strong> UniFi (Ubiquiti), firewalld, UFW, iptables/ipset</li>
          <li><strong>Coming Soon:</strong> Cloudflare, pfSense, OPNsense</li>
        </ul>
      </div>
    </div>
  `;

  // Attach event listeners
  attachEventListeners();
}

function attachEventListeners() {
  // Add Integration button (from header)
  const addIntegrationBtn = document.getElementById('addIntegrationBtn');
  if (addIntegrationBtn) {
    addIntegrationBtn.addEventListener('click', () => showIntegrationModal());
  }

  // Refresh button
  const refreshBtn = document.getElementById('refreshIntegrationsBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      const mainContent = document.getElementById('mainContent');
      await renderBanIntegrations(mainContent);
    });
  }

  // Toggle integration enabled/disabled
  document.querySelectorAll('.toggle-integration-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      await handleToggleIntegration(id, e.target.checked);
    });
  });

  // Test buttons
  document.querySelectorAll('.btn-test-integration').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      await handleTestIntegration(id);
    });
  });

  // Edit buttons
  document.querySelectorAll('.btn-edit-integration').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.currentTarget.dataset.id);
      const integration = integrations.find(i => i.id === id);
      if (integration) {
        showIntegrationModal(integration);
      }
    });
  });

  // Delete buttons
  document.querySelectorAll('.btn-delete-integration').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const name = e.currentTarget.dataset.name;

      if (confirm(`Delete integration "${name}"?\n\nThis action cannot be undone.`)) {
        await handleDeleteIntegration(id);
      }
    });
  });
}

function showIntegrationModal(existingIntegration = null) {
  const isEdit = !!existingIntegration;

  const modalHTML = `
    <div class="modal-overlay" id="integrationModal">
      <div class="modal modal-large">
        <div class="modal-header">
          <h3>${isEdit ? 'Edit' : 'Add'} Ban Integration</h3>
          <button class="modal-close" id="closeIntegrationModal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="integrationForm">
            <div class="form-group">
              <label for="integrationName">Integration Name *</label>
              <input type="text" id="integrationName" value="${escapeHtml(existingIntegration?.name || '')}" placeholder="My UniFi Gateway" required>
              <small>A descriptive name for this integration</small>
            </div>

            <div class="form-group">
              <label for="integrationType">Provider Type *</label>
              <select id="integrationType" ${isEdit ? 'disabled' : ''}>
                <option value="">Select a provider...</option>
                <option value="unifi" ${existingIntegration?.type === 'unifi' ? 'selected' : ''}>UniFi (Ubiquiti)</option>
                <option value="firewalld" ${existingIntegration?.type === 'firewalld' ? 'selected' : ''}>firewalld (RHEL/CentOS/Fedora)</option>
                <option value="ufw" ${existingIntegration?.type === 'ufw' ? 'selected' : ''}>UFW (Ubuntu/Debian)</option>
                <option value="iptables" ${existingIntegration?.type === 'iptables' ? 'selected' : ''}>iptables/ipset (Universal)</option>
                <option value="cloudflare" disabled>Cloudflare (Coming Soon)</option>
                <option value="pfsense" disabled>pfSense (Coming Soon)</option>
                <option value="opnsense" disabled>OPNsense (Coming Soon)</option>
              </select>
              <small>The firewall platform to integrate with</small>
            </div>

            <div id="providerFields" style="display: none;">
              <!-- UniFi Fields -->
              <div id="unifiFields" style="display: none;">
                <h4 style="margin: 20px 0 12px 0; padding-top: 20px; border-top: 1px solid var(--border-color); font-size: 14px; color: var(--text-secondary);">
                  UniFi Configuration
                </h4>

                <div class="form-group">
                  <label for="unifiCredential">UniFi Credentials</label>
                  <select id="unifiCredential">
                    <option value="">-- Create New Credential --</option>
                    ${credentials
                      .filter(c => c.credential_type === 'firewall' && c.provider === 'unifi')
                      .map(c => `<option value="${c.id}" ${existingIntegration?.credential_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
                      .join('')}
                  </select>
                  <small>Select existing credentials or create new ones below</small>
                </div>

                <div id="newUnifiCredentials" style="display: ${existingIntegration?.credential_id ? 'none' : 'block'};">
                  <div class="form-group">
                    <label for="unifiCredName">Credential Name</label>
                    <input type="text" id="unifiCredName" placeholder="UniFi API Credentials">
                    <small>Name for these credentials</small>
                  </div>

                  <div class="form-group">
                    <label for="unifiApiUrl">API URL *</label>
                    <input type="url" id="unifiApiUrl" placeholder="https://api.ui.com/ea">
                    <small>UniFi Site Manager API URL</small>
                  </div>

                  <div class="form-group">
                    <label for="unifiApiKey">API Key *</label>
                    <input type="password" id="unifiApiKey" placeholder="Your UniFi API key">
                    <small>API key from UniFi console</small>
                  </div>

                  <div class="form-group">
                    <label for="unifiSiteId">Site ID *</label>
                    <input type="text" id="unifiSiteId" placeholder="site-id-12345">
                    <small>Your UniFi site identifier</small>
                  </div>

                  <div class="form-group">
                    <label for="unifiNetworkId">Network ID *</label>
                    <input type="text" id="unifiNetworkId" placeholder="network-id-67890">
                    <small>Network where firewall rules will be created</small>
                  </div>
                </div>

                <div class="form-group">
                  <label for="unifiRulePriority">Firewall Rule Priority</label>
                  <input type="number" id="unifiRulePriority" value="${existingIntegration?.config?.rule_priority || 1}" min="1" max="1000">
                  <small>Priority for firewall rules (1 = highest priority)</small>
                </div>
              </div>

              <!-- firewalld Fields -->
              <div id="firewalldFields" style="display: none;">
                <h4 style="margin: 20px 0 12px 0; padding-top: 20px; border-top: 1px solid var(--border-color); font-size: 14px; color: var(--text-secondary);">
                  firewalld Configuration
                </h4>
                <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 16px;">
                  Runs locally on this server. Requires sudo access for firewall-cmd.
                </p>

                <div class="form-group">
                  <label for="firewalldZone">Firewall Zone</label>
                  <input type="text" id="firewalldZone" value="${existingIntegration?.config?.zone || 'public'}" placeholder="public">
                  <small>firewalld zone where rules will be created (e.g., public, dmz, internal)</small>
                </div>
              </div>

              <!-- UFW Fields -->
              <div id="ufwFields" style="display: none;">
                <h4 style="margin: 20px 0 12px 0; padding-top: 20px; border-top: 1px solid var(--border-color); font-size: 14px; color: var(--text-secondary);">
                  UFW Configuration
                </h4>
                <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 16px;">
                  Runs locally on this server. Requires sudo access for ufw command.
                </p>

                <div class="form-group">
                  <label for="ufwInsertPosition">Rule Insert Position</label>
                  <input type="number" id="ufwInsertPosition" value="${existingIntegration?.config?.insert_position || 1}" min="1">
                  <small>Where to insert ban rules (1 = highest priority)</small>
                </div>
              </div>

              <!-- iptables Fields -->
              <div id="iptablesFields" style="display: none;">
                <h4 style="margin: 20px 0 12px 0; padding-top: 20px; border-top: 1px solid var(--border-color); font-size: 14px; color: var(--text-secondary);">
                  iptables/ipset Configuration
                </h4>
                <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 16px;">
                  Runs locally on this server. Requires sudo access for iptables and ipset commands. Most efficient for large blocklists.
                </p>

                <div class="form-group">
                  <label for="iptablesIpsetName">IPSet Name</label>
                  <input type="text" id="iptablesIpsetName" value="${existingIntegration?.config?.ipset_name || 'waf_blocklist'}" placeholder="waf_blocklist">
                  <small>Name of ipset to create/use for storing banned IPs</small>
                </div>

                <div class="form-group">
                  <label for="iptablesChain">iptables Chain</label>
                  <input type="text" id="iptablesChain" value="${existingIntegration?.config?.chain || 'INPUT'}" placeholder="INPUT">
                  <small>iptables chain (INPUT, FORWARD, or OUTPUT)</small>
                </div>

                <div class="form-group">
                  <label for="iptablesAction">Action</label>
                  <select id="iptablesAction">
                    <option value="DROP" ${existingIntegration?.config?.action === 'DROP' || !existingIntegration?.config?.action ? 'selected' : ''}>DROP (Silent)</option>
                    <option value="REJECT" ${existingIntegration?.config?.action === 'REJECT' ? 'selected' : ''}>REJECT (Send response)</option>
                  </select>
                  <small>What to do with packets from banned IPs</small>
                </div>
              </div>
            </div>

            <div class="form-group" style="margin-top: 20px;">
              <div class="checkbox-group">
                <input type="checkbox" id="integrationEnabled" ${existingIntegration?.enabled !== 0 ? 'checked' : ''}>
                <label for="integrationEnabled">Enable this integration</label>
              </div>
              <small style="display: block; margin-left: 24px;">When enabled, ban/unban operations will be sent to this firewall</small>
            </div>

            <div id="integrationError" style="color: var(--danger-color); margin-top: 16px; display: none;"></div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="cancelIntegrationBtn">Cancel</button>
          <button type="submit" form="integrationForm" class="btn btn-primary" id="saveIntegrationBtn">${isEdit ? 'Update' : 'Create'} Integration</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // Setup event listeners
  const typeSelect = document.getElementById('integrationType');
  const providerFields = document.getElementById('providerFields');
  const unifiFields = document.getElementById('unifiFields');
  const credentialSelect = document.getElementById('unifiCredential');
  const newCredFields = document.getElementById('newUnifiCredentials');

  // Show/hide provider-specific fields based on type
  const firewalldFields = document.getElementById('firewalldFields');
  const ufwFields = document.getElementById('ufwFields');
  const iptablesFields = document.getElementById('iptablesFields');

  typeSelect.addEventListener('change', () => {
    const type = typeSelect.value;
    providerFields.style.display = type ? 'block' : 'none';

    // Hide all provider fields
    unifiFields.style.display = 'none';
    firewalldFields.style.display = 'none';
    ufwFields.style.display = 'none';
    iptablesFields.style.display = 'none';

    // Show selected provider fields
    if (type === 'unifi') unifiFields.style.display = 'block';
    else if (type === 'firewalld') firewalldFields.style.display = 'block';
    else if (type === 'ufw') ufwFields.style.display = 'block';
    else if (type === 'iptables') iptablesFields.style.display = 'block';
  });

  // Show/hide credential creation fields
  if (credentialSelect) {
    credentialSelect.addEventListener('change', () => {
      newCredFields.style.display = credentialSelect.value ? 'none' : 'block';
    });
  }

  // Trigger initial display
  if (existingIntegration) {
    typeSelect.dispatchEvent(new Event('change'));
  }

  // Close handlers
  document.getElementById('closeIntegrationModal').addEventListener('click', closeIntegrationModal);
  document.getElementById('cancelIntegrationBtn').addEventListener('click', closeIntegrationModal);

  // Form submit
  document.getElementById('integrationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleSaveIntegration(existingIntegration?.id);
  });
}

function closeIntegrationModal() {
  const modal = document.getElementById('integrationModal');
  if (modal) modal.remove();
}

async function handleSaveIntegration(existingId = null) {
  const errorDiv = document.getElementById('integrationError');
  const saveBtn = document.getElementById('saveIntegrationBtn');

  const name = document.getElementById('integrationName').value.trim();
  const type = document.getElementById('integrationType').value;
  const enabled = document.getElementById('integrationEnabled').checked;

  if (!name || !type) {
    errorDiv.textContent = 'Name and provider type are required';
    errorDiv.style.display = 'block';
    return;
  }

  errorDiv.style.display = 'none';
  saveBtn.disabled = true;
  saveBtn.textContent = existingId ? 'Updating...' : 'Creating...';

  try {
    let credentialId = null;
    let config = {};

    // Handle UniFi-specific fields
    if (type === 'unifi') {
      credentialId = document.getElementById('unifiCredential').value;

      // If creating new credentials
      if (!credentialId) {
        const credName = document.getElementById('unifiCredName').value.trim() || `${name} Credentials`;
        const apiUrl = document.getElementById('unifiApiUrl').value.trim();
        const apiKey = document.getElementById('unifiApiKey').value.trim();
        const siteId = document.getElementById('unifiSiteId').value.trim();
        const networkId = document.getElementById('unifiNetworkId').value.trim();

        if (!apiUrl || !apiKey || !siteId || !networkId) {
          throw new Error('All UniFi credential fields are required');
        }

        // Create credential
        const credResult = await api.createCredential({
          name: credName,
          credential_type: 'firewall',
          provider: 'unifi',
          credentials: {
            api_url: apiUrl,
            api_key: apiKey,
            site_id: siteId,
            network_id: networkId
          }
        });

        credentialId = credResult.id;
      }

      // Get config
      const rulePriority = parseInt(document.getElementById('unifiRulePriority').value);
      config = { rule_priority: rulePriority };
    } else if (type === 'firewalld') {
      // firewalld - no credentials needed (local)
      const zone = document.getElementById('firewalldZone').value.trim() || 'public';
      config = { zone };
    } else if (type === 'ufw') {
      // UFW - no credentials needed (local)
      const insertPosition = parseInt(document.getElementById('ufwInsertPosition').value) || 1;
      config = { insert_position: insertPosition };
    } else if (type === 'iptables') {
      // iptables - no credentials needed (local)
      const ipsetName = document.getElementById('iptablesIpsetName').value.trim() || 'waf_blocklist';
      const chain = document.getElementById('iptablesChain').value.trim() || 'INPUT';
      const action = document.getElementById('iptablesAction').value || 'DROP';
      config = { ipset_name: ipsetName, chain, action };
    }

    // Create or update integration
    const data = {
      name,
      type,
      credential_id: credentialId,
      config_json: JSON.stringify(config),
      enabled
    };

    if (existingId) {
      await api.updateBanIntegration(existingId, data);
      showToast('Integration updated successfully', 'success');
    } else {
      await api.createBanIntegration(data);
      showToast('Integration created successfully', 'success');
    }

    closeIntegrationModal();

    // Reload integrations list
    const mainContent = document.getElementById('mainContent');
    await renderBanIntegrations(mainContent);
  } catch (error) {
    errorDiv.textContent = error.message || 'Failed to save integration';
    errorDiv.style.display = 'block';
    saveBtn.disabled = false;
    saveBtn.textContent = existingId ? 'Update Integration' : 'Create Integration';
  }
}

async function handleToggleIntegration(id, enabled) {
  try {
    await api.updateBanIntegration(id, { enabled });

    // Update local state
    const integration = integrations.find(i => i.id === parseInt(id));
    if (integration) {
      integration.enabled = enabled ? 1 : 0;
    }

    showToast(`Integration ${enabled ? 'enabled' : 'disabled'}`, 'success');
  } catch (error) {
    showToast(`Failed to toggle integration: ${error.message}`, 'error');

    // Reload to restore state
    const mainContent = document.getElementById('mainContent');
    await renderBanIntegrations(mainContent);
  }
}

async function handleTestIntegration(id) {
  const integration = integrations.find(i => i.id === parseInt(id));
  if (!integration) return;

  showToast(`Testing connection to ${integration.name}...`, 'info');

  try {
    const result = await api.testBanIntegration(id);

    if (result.success) {
      showToast(`Connection successful: ${result.message}`, 'success');
    } else {
      showToast(`Connection failed: ${result.message}`, 'error');
    }
  } catch (error) {
    showToast(`Test failed: ${error.message}`, 'error');
  }
}

async function handleDeleteIntegration(id) {
  try {
    await api.deleteBanIntegration(id);
    showToast('Integration deleted successfully', 'success');

    // Reload integrations list
    const mainContent = document.getElementById('mainContent');
    await renderBanIntegrations(mainContent);
  } catch (error) {
    showToast(`Failed to delete integration: ${error.message}`, 'error');
  }
}

// Helper functions
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
