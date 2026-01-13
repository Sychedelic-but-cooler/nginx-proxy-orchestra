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
      
      // Load error pages UI
      await loadErrorPagesSection(settings);

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

    <div class="card" id="errorPagesCard" style="margin-top: 20px;"></div>
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

          <div id="uaBlockRules" style="background: var(--bg-color); padding: 16px; border-radius: 4px; margin-bottom: 12px;">
            ${uaRules.length > 0 ? `
              <strong>Currently blocked: ${uaRules.length} user-agent(s)</strong>
              <ul style="margin: 8px 0 0 20px;">
                ${uaRules.map(rule => `
                  <li>${rule.rule_value}${rule.description ? ` - ${rule.description}` : ''}
                    <button type="button" class="btn-link delete-rule" data-id="${rule.id}" style="color: var(--danger-color); margin-left: 8px;">Remove</button>
                  </li>
                `).join('')}
              </ul>
            ` : '<p style="color: var(--text-secondary); margin: 0;">No user-agents currently blocked.</p>'}
          </div>
          <button type="button" class="btn btn-sm btn-secondary" id="addUABtn">+ Add User-Agent Block</button>
        </div>

        <div class="form-actions" style="margin-top: 30px;">
          <button type="submit" class="btn btn-primary">Save Security Settings</button>
        </div>
      </form>
    </div>
  `;
}

async function loadErrorPagesSection(settings) {
  const card = document.getElementById('errorPagesCard');
  if (!card) return;

  card.innerHTML = `<div class="loading">Loading error pages...</div>`;
  try {
    const resp = await import('../api-error-pages.js').then(m => m.getErrorPages());
    const pages = resp.pages || {};
    const allowed = resp.allowed || ['404', '502', '503'];

    card.innerHTML = `
      <h2>Custom Error Pages</h2>
      <p class="form-help">Upload custom HTML for common error responses. These are served globally (default catch-all) and can be wired into proxy templates.</p>
      <div class="error-pages-grid">
        ${allowed.map(code => renderErrorPagePanel(code, pages[code])).join('')}
      </div>
    `;

    allowed.forEach(code => {
      const form = card.querySelector(`#errorForm_${code}`);
      if (!form) return;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textarea = form.querySelector('textarea');
        const html = textarea.value;
        if (!html.trim()) {
          alert('HTML content cannot be empty');
          return;
        }
        try {
          await import('../api-error-pages.js').then(m => m.saveErrorPage(code, html));
          showSuccess(`Saved custom ${code} page`);
        } catch (err) {
          showError(err.message || `Failed to save ${code} page`);
        }
      });
    });
  } catch (error) {
    card.innerHTML = `<div class="error">Failed to load error pages</div>`;
  }
}

function renderErrorPagePanel(code, page) {
  const content = page && page.content ? page.content : '';
  return `
    <div class="error-page-panel">
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="badge">${code}</span>
        <strong>Custom ${code} Page</strong>
      </div>
      <form id="errorForm_${code}" class="error-form">
        <textarea rows="6" placeholder="Paste custom HTML for ${code}">${content || ''}</textarea>
        <div class="form-actions" style="margin-top:8px; display:flex; justify-content: flex-end; gap:8px;">
          <button type="submit" class="btn btn-primary">Save ${code}</button>
        </div>
      </form>
    </div>
  `;
}

function setupGeneralSettingsHandlers(settings, certificates) {
  const form = document.getElementById('generalSettingsForm');
  const behaviorSelect = document.getElementById('defaultBehavior');
  const customUrlGroup = document.getElementById('customUrlGroup');

  behaviorSelect.addEventListener('change', () => {
    if (behaviorSelect.value === 'custom') {
      customUrlGroup.style.display = 'block';
    } else {
      customUrlGroup.style.display = 'none';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const updateData = {
      default_server_behavior: behaviorSelect.value,
      default_server_custom_url: document.getElementById('customUrl').value,
      admin_cert_id: document.getElementById('adminCert').value
    };

    showLoading();
    try {
      const result = await api.updateSettings(updateData);
      
      if (result.requiresRestart) {
        showSuccess(result.restartMessage, 10000); // Show for longer
      } else {
        showSuccess('Settings updated successfully');
      }
      
      // Reload settings to ensure UI is in sync
      await renderSettings(document.getElementById('mainContent'), 'general');
    } catch (error) {
      showError(error.message);
    } finally {
      hideLoading();
    }
  });
}

function setupSecuritySettingsHandlers() {
  const form = document.getElementById('securitySettingsForm');

  // Handle delete rule buttons
  document.querySelectorAll('.delete-rule').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to remove this rule?')) return;
      
      showLoading();
      try {
        await api.deleteSecurityRule(parseInt(btn.dataset.id));
        showSuccess('Rule removed successfully');
        await renderSettings(document.getElementById('mainContent'), 'security');
      } catch (error) {
        showError(error.message);
        hideLoading();
      }
    });
  });

  // Handle add buttons
  document.getElementById('addIPBtn').addEventListener('click', () => showAddRuleModal('ip_blacklist'));
  document.getElementById('addGeoBtn').addEventListener('click', () => showAddRuleModal('geo_block'));
  document.getElementById('addUABtn').addEventListener('click', () => showAddRuleModal('user_agent_filter'));

  // Handle settings save
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const updateData = {
      security_ip_blacklist_enabled: document.getElementById('ipBlacklistEnabled').checked,
      security_geo_blocking_enabled: document.getElementById('geoBlockingEnabled').checked,
      security_user_agent_filtering_enabled: document.getElementById('userAgentFilteringEnabled').checked
    };

    showLoading();
    try {
      await api.updateSecuritySettings(updateData);
      showSuccess('Security settings updated successfully');
    } catch (error) {
      showError(error.message);
    } finally {
      hideLoading();
    }
  });
}

function showAddRuleModal(type) {
  const modal = document.getElementById('modalContainer');
  let title = '';
  let placeholder = '';
  let helpText = '';

  switch (type) {
    case 'ip_blacklist':
      title = 'Block IP Address';
      placeholder = '192.168.1.1 or 10.0.0.0/24';
      helpText = 'Enter a single IP address (IPv4/IPv6) or a CIDR range.';
      break;
    case 'geo_block':
      title = 'Block Country';
      placeholder = 'CN';
      helpText = 'Enter the 2-letter ISO country code (e.g., CN, RU, US).';
      break;
    case 'user_agent_filter':
      title = 'Block User-Agent';
      placeholder = 'SemrushBot';
      helpText = 'Enter a string to match against the User-Agent header (regex supported).';
      break;
  }

  modal.innerHTML = `
    <div class="modal-overlay" id="addRuleModal">
      <div class="modal">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" id="closeRuleModal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="addRuleForm">
            <div class="form-group">
              <label for="ruleValue">Value</label>
              <input type="text" id="ruleValue" required placeholder="${placeholder}">
              <small>${helpText}</small>
            </div>
            <div class="form-group">
              <label for="ruleDescription">Description (Optional)</label>
              <input type="text" id="ruleDescription" placeholder="Why are we blocking this?">
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="cancelRuleBtn">Cancel</button>
              <button type="submit" class="btn btn-primary">Add Block Rule</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  modal.style.display = 'flex';

  const closeBtn = document.getElementById('closeRuleModal');
  const cancelBtn = document.getElementById('cancelRuleBtn');
  const form = document.getElementById('addRuleForm');

  const close = () => {
    modal.style.display = 'none';
    modal.innerHTML = '';
  };

  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = document.getElementById('ruleValue').value;
    const description = document.getElementById('ruleDescription').value;

    showLoading();
    try {
      await api.createSecurityRule({
        rule_type: type,
        rule_value: value,
        description
      });
      close();
      showSuccess('Rule added successfully');
      await renderSettings(document.getElementById('mainContent'), 'security');
    } catch (error) {
      showError(error.message);
      hideLoading();
    }
  });
}
