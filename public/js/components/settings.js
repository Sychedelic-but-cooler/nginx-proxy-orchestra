import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess } from '../app.js';

export async function renderSettings(container, tab = 'general') {
  showLoading();

  try {
    if (tab === 'general') {
      const [settings, certificates] = await Promise.all([
        api.getSettings(),
        api.getCertificates()
      ]);

      container.innerHTML = `
        <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
          <strong>ℹ️ General Settings:</strong> Configure system-wide settings for your proxy hosts.
        </div>
        ${renderGeneralSettings(settings, certificates)}
      `;

      setupGeneralSettingsHandlers(settings, certificates);

    } else if (tab === 'security') {
      const [securitySettings, securityRules] = await Promise.all([
        api.getSecuritySettings(),
        api.getSecurityRules()
      ]);

      container.innerHTML = `
        <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
          <strong>ℹ️ Security Settings:</strong> Configure security features that protect your proxy hosts from threats.
        </div>
        ${renderSecuritySettings(securitySettings, securityRules)}
      `;

      setupSecuritySettingsHandlers();
    }

  } catch (error) {
    showError(error.message);
    container.innerHTML = '<div class="empty-state"><h2>Failed to load settings</h2></div>';
  } finally {
    hideLoading();
  }
}

function renderGeneralSettings(settings, certificates) {
  return `
    <div class="card">
      <h2>System Settings</h2>
      <form id="generalSettingsForm">
        <div class="form-group">
          <label for="defaultBehavior">Default Server Behavior</label>
          <p class="form-help">Choose what happens when someone accesses a disabled or non-existent proxy host</p>
          <select id="defaultBehavior" class="form-control" required>
            <option value="drop" ${settings.default_server_behavior === 'drop' ? 'selected' : ''}>Drop Connection (444)</option>
            <option value="404" ${settings.default_server_behavior === '404' ? 'selected' : ''}>Return 404 Not Found</option>
            <option value="custom" ${settings.default_server_behavior === 'custom' ? 'selected' : ''}>Redirect to Custom URL</option>
          </select>
        </div>

        <div class="form-group" id="customUrlGroup" style="display: ${settings.default_server_behavior === 'custom' ? 'block' : 'none'};">
          <label for="customUrl">Custom Redirect URL</label>
          <p class="form-help">Enter the full URL where users should be redirected (e.g., https://example.com/unavailable)</p>
          <input
            type="url"
            id="customUrl"
            class="form-control"
            placeholder="https://example.com/unavailable"
            value="${settings.default_server_custom_url || ''}"
          >
        </div>

        <div class="info-banner" style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
          <strong>ℹ️ About Default Server Behavior:</strong>
          <ul style="margin: 8px 0 0 20px; padding: 0;">
            <li><strong>Drop Connection (444):</strong> Nginx closes the connection immediately without sending a response. Most secure option.</li>
            <li><strong>Return 404:</strong> Returns a standard 404 Not Found error to the browser. Clear indication that the host doesn't exist.</li>
            <li><strong>Redirect to Custom URL:</strong> Redirects users to a custom page where you can explain the situation or show branding.</li>
          </ul>
        </div>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid var(--border-color);">

        <h3 style="margin-bottom: 16px;">Admin Interface Certificate</h3>

        <div class="form-group">
          <label for="adminCert">TLS Certificate for Admin Interface</label>
          <p class="form-help">Select a certificate to use for the admin interface HTTPS. Leave unselected to use the self-signed certificate.</p>
          ${certificates.length === 0 ? `
            <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 12px; border-radius: 4px;">
              <strong>ℹ️ No certificates available.</strong> Upload a certificate on the <a href="#/certificates" style="color: var(--primary-color); text-decoration: underline;">TLS Certificates</a> tab first.
            </div>
          ` : ''}
          <select id="adminCert" class="form-control">
            <option value="">Self-Signed Certificate (Default)</option>
            ${certificates.map(cert => `
              <option value="${cert.id}" ${settings.admin_cert_id == cert.id ? 'selected' : ''}>
                ${cert.name} - ${cert.domain_names}
              </option>
            `).join('')}
          </select>
        </div>

        <div class="info-banner" style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
          <strong>⚠️ Important:</strong> Changing the admin interface certificate requires a server restart to take effect. You will need to manually restart the Node.js server after saving.
        </div>

        <button type="submit" class="btn btn-primary">Save Settings</button>
      </form>
    </div>
  `;
}

function renderSecuritySettings(securitySettings, securityRules) {
  const ipRules = securityRules.rules.filter(r => r.rule_type === 'ip_blacklist');
  const geoRules = securityRules.rules.filter(r => r.rule_type === 'geo_block');
  const uaRules = securityRules.rules.filter(r => r.rule_type === 'user_agent_filter');

  return `
    <div class="card">
      <h2>Security Features</h2>
      <p style="color: var(--text-secondary); margin-bottom: 24px;">
        Control which traffic is blocked across all your proxy hosts. These settings apply globally.
      </p>

      <form id="securitySettingsForm">
        <!-- IP Blacklist Section -->
        <div class="security-section">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
            <label style="margin: 0; font-weight: 600; font-size: 16px;">
              <input type="checkbox" id="ipBlacklistEnabled" ${securitySettings.security_ip_blacklist_enabled ? 'checked' : ''} style="margin-right: 8px;">
              IP Blacklist
            </label>
          </div>
          <p class="form-help" style="margin: 0 0 16px 0;">
            Block specific IP addresses or ranges from accessing any proxy host. Useful for blocking known attackers.
          </p>

          <div id="ipBlacklistRules" style="background: var(--bg-color); padding: 16px; border-radius: 4px; margin-bottom: 12px;">
            ${ipRules.length > 0 ? `
              <strong>Currently blocked: ${ipRules.length} IP(s)</strong>
              <ul style="margin: 8px 0 0 20px;">
                ${ipRules.slice(0, 5).map(rule => `
                  <li>${rule.rule_value}${rule.description ? ` - ${rule.description}` : ''}
                    <button type="button" class="btn-link delete-rule" data-id="${rule.id}" style="color: var(--danger-color); margin-left: 8px;">Remove</button>
                  </li>
                `).join('')}
                ${ipRules.length > 5 ? `<li style="color: var(--text-secondary);">... and ${ipRules.length - 5} more</li>` : ''}
              </ul>
            ` : '<p style="color: var(--text-secondary); margin: 0;">No IPs currently blacklisted.</p>'}
          </div>
          <button type="button" class="btn btn-sm btn-secondary" id="addIPBtn">+ Add IP to Blacklist</button>
        </div>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid var(--border-color);">

        <!-- Geo-Blocking Section -->
        <div class="security-section">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
            <label style="margin: 0; font-weight: 600; font-size: 16px;">
              <input type="checkbox" id="geoBlockingEnabled" ${securitySettings.security_geo_blocking_enabled ? 'checked' : ''} style="margin-right: 8px;">
              Geo-Blocking
            </label>
          </div>
          <p class="form-help" style="margin: 0 0 16px 0;">
            Block traffic from specific countries. Requires GeoIP module to be installed on your server.
          </p>

          <div class="info-banner" style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; margin-bottom: 16px; border-radius: 4px;">
            <strong>⚠️ Note:</strong> Geo-blocking requires the nginx GeoIP module. If not installed, this feature won't work. <a href="https://nginx.org/en/docs/http/ngx_http_geoip_module.html" target="_blank" style="color: var(--primary-color);">Learn more</a>
          </div>

          <div id="geoBlockRules" style="background: var(--bg-color); padding: 16px; border-radius: 4px; margin-bottom: 12px;">
            ${geoRules.length > 0 ? `
              <strong>Currently blocked: ${geoRules.length} country/countries</strong>
              <ul style="margin: 8px 0 0 20px;">
                ${geoRules.map(rule => `
                  <li>${rule.rule_value}${rule.description ? ` - ${rule.description}` : ''}
                    <button type="button" class="btn-link delete-rule" data-id="${rule.id}" style="color: var(--danger-color); margin-left: 8px;">Remove</button>
                  </li>
                `).join('')}
              </ul>
            ` : '<p style="color: var(--text-secondary); margin: 0;">No countries currently blocked.</p>'}
          </div>
          <button type="button" class="btn btn-sm btn-secondary" id="addGeoBtn">+ Add Country Block</button>
        </div>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid var(--border-color);">

        <!-- User-Agent Filtering Section -->
        <div class="security-section">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
            <label style="margin: 0; font-weight: 600; font-size: 16px;">
              <input type="checkbox" id="userAgentFilteringEnabled" ${securitySettings.security_user_agent_filtering_enabled ? 'checked' : ''} style="margin-right: 8px;">
              User-Agent Filtering
            </label>
          </div>
          <p class="form-help" style="margin: 0 0 16px 0;">
            Block specific bots and crawlers by their user-agent string. Good for blocking scrapers and bad bots.
          </p>

          <div id="uaFilterRules" style="background: var(--bg-color); padding: 16px; border-radius: 4px; margin-bottom: 12px;">
            ${uaRules.length > 0 ? `
              <strong>Currently blocked: ${uaRules.length} user-agent pattern(s)</strong>
              <ul style="margin: 8px 0 0 20px;">
                ${uaRules.slice(0, 5).map(rule => `
                  <li><code>${rule.rule_value}</code>${rule.description ? ` - ${rule.description}` : ''}
                    <button type="button" class="btn-link delete-rule" data-id="${rule.id}" style="color: var(--danger-color); margin-left: 8px;">Remove</button>
                  </li>
                `).join('')}
                ${uaRules.length > 5 ? `<li style="color: var(--text-secondary);">... and ${uaRules.length - 5} more</li>` : ''}
              </ul>
            ` : '<p style="color: var(--text-secondary); margin: 0;">No user-agents currently filtered.</p>'}
          </div>
          <button type="button" class="btn btn-sm btn-secondary" id="addUABtn">+ Add User-Agent Filter</button>
        </div>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid var(--border-color);">

        <button type="submit" class="btn btn-primary">Save Security Settings</button>
      </form>
    </div>
  `;
}

function setupGeneralSettingsHandlers(settings, certificates) {
  const form = document.getElementById('generalSettingsForm');
  const behaviorSelect = document.getElementById('defaultBehavior');
  const customUrlGroup = document.getElementById('customUrlGroup');
  const customUrlInput = document.getElementById('customUrl');
  const adminCertSelect = document.getElementById('adminCert');

  // Show/hide custom URL field based on selection
  behaviorSelect.addEventListener('change', () => {
    if (behaviorSelect.value === 'custom') {
      customUrlGroup.style.display = 'block';
      customUrlInput.required = true;
    } else {
      customUrlGroup.style.display = 'none';
      customUrlInput.required = false;
    }
  });

  // Form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const behavior = behaviorSelect.value;
    const customUrl = customUrlInput.value.trim();
    const adminCertId = adminCertSelect.value;

    // Validate custom URL if behavior is custom
    if (behavior === 'custom' && !customUrl) {
      showError('Please enter a custom URL');
      return;
    }

    showLoading();

    try {
      const result = await api.updateSettings({
        default_server_behavior: behavior,
        default_server_custom_url: customUrl,
        admin_cert_id: adminCertId
      });

      hideLoading();

      // Show different message if restart is required
      if (result.requiresRestart) {
        showSuccess(result.restartMessage);
      } else {
        showSuccess('Settings updated successfully. Nginx has been reloaded.');
      }
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  });
}

function setupSecuritySettingsHandlers() {
  const form = document.getElementById('securitySettingsForm');

  // Delete rule buttons
  document.querySelectorAll('.delete-rule').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id);
      if (confirm('Are you sure you want to delete this security rule?')) {
        showLoading();
        try {
          await api.deleteSecurityRule(id);
          hideLoading();
          showSuccess('Security rule deleted successfully');
          // Reload the security settings page
          await renderSettings(document.getElementById('mainContent'), 'security');
        } catch (error) {
          hideLoading();
          showError(error.message);
        }
      }
    });
  });

  // Add IP button
  document.getElementById('addIPBtn')?.addEventListener('click', () => showAddRuleModal('ip_blacklist'));

  // Add Geo button
  document.getElementById('addGeoBtn')?.addEventListener('click', () => showAddRuleModal('geo_block'));

  // Add UA button
  document.getElementById('addUABtn')?.addEventListener('click', () => showAddRuleModal('user_agent_filter'));

  // Form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const ipEnabled = document.getElementById('ipBlacklistEnabled').checked;
    const geoEnabled = document.getElementById('geoBlockingEnabled').checked;
    const uaEnabled = document.getElementById('userAgentFilteringEnabled').checked;

    showLoading();

    try {
      await api.updateSecuritySettings({
        security_ip_blacklist_enabled: ipEnabled,
        security_geo_blocking_enabled: geoEnabled,
        security_user_agent_filtering_enabled: uaEnabled
      });

      hideLoading();
      showSuccess('Security settings updated successfully');
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  });
}

function showAddRuleModal(ruleType) {
  const modal = document.getElementById('modalContainer');

  const typeInfo = {
    'ip_blacklist': {
      title: 'Block IP Address',
      label: 'IP Address or Range',
      placeholder: 'e.g., 192.168.1.100 or 10.0.0.0/8',
      help: 'Enter a single IP address or CIDR notation for a range'
    },
    'geo_block': {
      title: 'Block Country',
      label: 'Country Code',
      placeholder: 'e.g., CN, RU, KP',
      help: 'Enter 2-letter ISO country code (e.g., CN for China, RU for Russia)'
    },
    'user_agent_filter': {
      title: 'Block User-Agent',
      label: 'User-Agent Pattern',
      placeholder: 'e.g., BadBot or .*scraper.*',
      help: 'Enter user-agent string or pattern to block. Supports wildcards.'
    }
  };

  const info = typeInfo[ruleType];

  modal.innerHTML = `
    <div class="modal-overlay" id="addRuleModal">
      <div class="modal">
        <div class="modal-header">
          <h3>${info.title}</h3>
          <button class="modal-close" id="closeAddRuleModal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="addRuleForm">
            <div class="form-group">
              <label for="ruleValue">${info.label} *</label>
              <input type="text" id="ruleValue" required placeholder="${info.placeholder}">
              <small>${info.help}</small>
            </div>

            <div class="form-group">
              <label for="ruleDescription">Reason (optional)</label>
              <input type="text" id="ruleDescription" placeholder="e.g., Known attacker">
              <small>Help yourself remember why you added this rule</small>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="cancelRuleBtn">Cancel</button>
              <button type="submit" class="btn btn-primary">Add Rule</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  // Close button handlers
  const closeModal = () => {
    document.getElementById('addRuleModal')?.remove();
  };

  document.getElementById('closeAddRuleModal').addEventListener('click', closeModal);
  document.getElementById('cancelRuleBtn').addEventListener('click', closeModal);

  // Click outside to close
  document.getElementById('addRuleModal').addEventListener('click', (e) => {
    if (e.target.id === 'addRuleModal') {
      closeModal();
    }
  });

  // Form submit handler
  document.getElementById('addRuleForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const ruleValue = document.getElementById('ruleValue').value.trim();
    const description = document.getElementById('ruleDescription').value.trim();

    showLoading();
    try {
      await api.createSecurityRule({
        rule_type: ruleType,
        rule_value: ruleValue,
        action: 'deny',
        description: description || null,
        enabled: 1
      });

      closeModal();
      hideLoading();
      showSuccess('Security rule added successfully');

      // Reload the security settings page
      await renderSettings(document.getElementById('mainContent'), 'security');
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  });
}
