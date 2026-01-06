import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess } from '../app.js';
import state from '../state.js';
import { escapeHtml } from '../utils/sanitize.js';

export async function renderProxies(container) {
  showLoading();
  
  try {
    const proxies = await api.getProxies();
    state.set('proxies', proxies);
    
    if (proxies.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h2>No Proxy Hosts</h2>
          <p>Create your first reverse proxy host to get started</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="card">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Domain(s)</th>
                <th>Forward To</th>
                <th>TLS</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${proxies.map(proxy => {
                // Determine status badge
                let statusBadge, statusText, statusClass;
                if (proxy.config_status === 'error') {
                  statusClass = 'badge-danger';
                  statusText = 'Error';
                } else if (proxy.config_status === 'pending') {
                  statusClass = 'badge-warning';
                  statusText = 'Pending';
                } else if (proxy.enabled) {
                  statusClass = 'badge-success';
                  statusText = 'Active';
                } else {
                  statusClass = 'badge-secondary';
                  statusText = 'Disabled';
                }

                // Build URL for the proxy (if applicable)
                const firstDomain = proxy.domain_names.split(',')[0].trim();
                const proxyUrl = (proxy.type === 'reverse' && firstDomain !== 'N/A')
                  ? `${proxy.ssl_enabled ? 'https' : 'http'}://${firstDomain}`
                  : null;

                return `
                <tr ${proxy.config_status === 'error' ? 'style="background-color: rgba(220, 53, 69, 0.05);"' : ''}>
                  <td>
                    ${proxyUrl ? `
                      <a href="${proxyUrl}" target="_blank" rel="noopener noreferrer" title="Open ${proxyUrl}" style="display: inline-block; vertical-align: middle; margin-right: 8px; color: var(--primary-color); text-decoration: none;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                          <polyline points="15 3 21 3 21 9"></polyline>
                          <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                      </a>
                    ` : ''}
                    <strong>${escapeHtml(proxy.name)}</strong>
                    ${proxy.config_error ? `<br><small style="color: var(--danger-color);" title="${escapeHtml(proxy.config_error)}">⚠️ ${escapeHtml(proxy.config_error)}</small>` : ''}
                  </td>
                  <td><span class="badge badge-info">${escapeHtml(proxy.type)}</span></td>
                  <td>${escapeHtml(proxy.domain_names)}</td>
                  <td>${escapeHtml(proxy.forward_scheme)}://${escapeHtml(proxy.forward_host)}:${proxy.forward_port}</td>
                  <td>
                    ${proxy.ssl_enabled ?
                      `<span class="badge badge-success">✓ ${escapeHtml(proxy.ssl_cert_name || 'Enabled')}</span>` :
                      '<span class="badge badge-danger">✗</span>'}
                  </td>
                  <td>
                    <span class="badge ${statusClass}" title="${proxy.config_error || ''}">
                      ${statusText}
                    </span>
                  </td>
                  <td class="action-buttons">
                    <button class="btn btn-sm btn-secondary toggle-proxy" data-id="${proxy.id}">
                      ${proxy.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button class="btn btn-sm btn-primary edit-proxy" data-id="${proxy.id}">Edit</button>
                    <button class="btn btn-sm btn-danger delete-proxy" data-id="${proxy.id}">Delete</button>
                  </td>
                </tr>
              `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;

      // Event listeners
      document.querySelectorAll('.toggle-proxy').forEach(btn => {
        btn.addEventListener('click', () => handleToggleProxy(parseInt(btn.dataset.id), container));
      });

      document.querySelectorAll('.edit-proxy').forEach(btn => {
        btn.addEventListener('click', () => handleEditProxy(parseInt(btn.dataset.id)));
      });

      document.querySelectorAll('.delete-proxy').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteProxy(parseInt(btn.dataset.id), container));
      });
    }

    // Add proxy button handler
    document.getElementById('addProxyBtn')?.addEventListener('click', () => showProxyForm());

  } catch (error) {
    showError(error.message);
    container.innerHTML = '<div class="empty-state"><h2>Failed to load proxies</h2></div>';
  } finally {
    hideLoading();
  }
}

async function handleToggleProxy(id, container) {
  showLoading();
  try {
    await api.toggleProxy(id);
    showSuccess('Proxy status updated');
    await renderProxies(container);
  } catch (error) {
    hideLoading();
    showError(error.message);
  }
}

async function handleDeleteProxy(id, container) {
  if (!confirm('Are you sure you want to delete this proxy host?')) return;
  
  showLoading();
  try {
    await api.deleteProxy(id);
    showSuccess('Proxy deleted successfully');
    await renderProxies(container);
  } catch (error) {
    hideLoading();
    showError(error.message);
  }
}

function handleEditProxy(id) {
  showProxyForm(id);
}

async function showProxyForm(id = null) {
  showLoading();
  
  try {
    const [modules, certificates] = await Promise.all([
      api.getModules(),
      api.getCertificates()
    ]);

    let proxy = null;
    if (id) {
      proxy = await api.getProxy(id);
    }

    const modal = document.getElementById('modalContainer');
    modal.innerHTML = `
      <div class="modal-overlay" id="proxyModal">
        <div class="modal">
          <div class="modal-header">
            <h3>${id ? 'Edit' : 'Add'} Proxy Host</h3>
            <button class="modal-close" id="closeProxyModal">&times;</button>
          </div>

          <!-- Tabs -->
          <div class="tabs">
            <button class="tab active" data-tab="basic">Basic</button>
            <button class="tab" data-tab="advanced">Advanced</button>
          </div>

          <div class="modal-body">

          <!-- Basic Tab -->
          <div id="basicTab" class="tab-content active">
          <form id="proxyForm">
            <div class="form-group">
              <label for="proxyName">Name *</label>
              <input type="text" id="proxyName" required value="${proxy?.name || ''}">
            </div>
            
            <div class="form-group">
              <label for="proxyType">Type</label>
              <select id="proxyType">
                <option value="reverse" ${!proxy || proxy.type === 'reverse' ? 'selected' : ''}>Reverse Proxy</option>
                <option value="stream" ${proxy?.type === 'stream' ? 'selected' : ''}>Stream (TCP/UDP)</option>
                <option value="404" ${proxy?.type === '404' ? 'selected' : ''}>404 Host</option>
              </select>
            </div>

            <div class="form-group">
              <label for="domainNames">Domain Names * (comma-separated)</label>
              <input type="text" id="domainNames" required value="${proxy?.domain_names || ''}" placeholder="example.com, www.example.com">
            </div>

            <div class="form-group">
              <label for="forwardScheme">Forward Scheme</label>
              <select id="forwardScheme">
                <option value="http" ${!proxy || proxy.forward_scheme === 'http' ? 'selected' : ''}>http</option>
                <option value="https" ${proxy?.forward_scheme === 'https' ? 'selected' : ''}>https</option>
              </select>
            </div>

            <div class="form-group">
              <label for="forwardHost">Forward Host *</label>
              <input type="text" id="forwardHost" required value="${proxy?.forward_host || ''}" placeholder="192.168.1.100 or hostname">
            </div>

            <div class="form-group">
              <label for="forwardPort">Forward Port *</label>
              <input type="number" id="forwardPort" required value="${proxy?.forward_port || '80'}" min="1" max="65535">
            </div>

            <div class="checkbox-group">
              <input type="checkbox" id="sslEnabled" ${proxy?.ssl_enabled ? 'checked' : ''}>
              <label for="sslEnabled">Enable TLS</label>
            </div>

            <div class="form-group" id="sslCertGroup" style="${proxy?.ssl_enabled ? '' : 'display: none;'}">
              <label for="sslCert">TLS Certificate</label>
              <select id="sslCert">
                <option value="">-- Select Certificate --</option>
                ${certificates.map(cert => `
                  <option value="${cert.id}" ${proxy?.ssl_cert_id === cert.id ? 'selected' : ''}>
                    ${cert.name} (${cert.domain_names})
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="form-group">
              <label>Modules</label>
              ${modules.map(module => `
                <div class="checkbox-group">
                  <input type="checkbox" id="module_${module.id}" value="${module.id}" 
                    ${proxy?.modules?.some(m => m.id === module.id) ? 'checked' : ''}>
                  <label for="module_${module.id}">${module.name} - ${module.description || ''}</label>
                </div>
              `).join('')}
            </div>

            <div class="form-group">
              <label for="advancedConfig">Advanced Configuration (optional)</label>
              <textarea id="advancedConfig" placeholder="# Additional nginx directives">${proxy?.advanced_config || ''}</textarea>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="cancelBtn">Cancel</button>
              <button type="submit" class="btn btn-primary" id="saveBasicBtn">Save</button>
            </div>
          </form>
          </div>

          <!-- Advanced Tab -->
          <div id="advancedTab" class="tab-content">
            <div class="advanced-editor-container">
              <p style="color: var(--text-secondary); margin-bottom: 15px;">
                ⚠️ <strong>Note:</strong> You must test the configuration before saving. The save button will only appear after a successful test.
              </p>

              <div class="form-group">
                <label for="advancedConfigEditor">Nginx Configuration *</label>
                <textarea
                  id="advancedConfigEditor"
                  style="min-height: 400px; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.5;"
                  placeholder="# Enter your nginx configuration here"
                ></textarea>
                <small>Edit the raw nginx configuration. Click "Generate from Basic" to start with the form data.</small>
              </div>

              <!-- Test Results -->
              <div id="advancedTestResults" style="display: none;"></div>

              <!-- Action Buttons -->
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" id="cancelAdvancedBtn">Cancel</button>
                <button type="button" class="btn btn-secondary" id="generateBtn">
                  Generate from Basic
                </button>
                <button type="button" class="btn btn-warning" id="testAdvancedBtn">
                  Test Configuration
                </button>
                <button
                  type="button"
                  class="btn btn-primary"
                  id="saveAdvancedBtn"
                  style="display: none;"
                  disabled
                >
                  Save Configuration
                </button>
              </div>
            </div>
          </div>

          </div>
        </div>
      </div>
    `;

    // Close button handlers
    const closeModal = () => {
      document.getElementById('proxyModal')?.remove();
    };

    document.getElementById('closeProxyModal').addEventListener('click', closeModal);

    // Click outside to close
    document.getElementById('proxyModal').addEventListener('click', (e) => {
      if (e.target.id === 'proxyModal') {
        closeModal();
      }
    });

    // TLS checkbox handler
    document.getElementById('sslEnabled').addEventListener('change', (e) => {
      document.getElementById('sslCertGroup').style.display = e.target.checked ? 'block' : 'none';
    });

    // Load existing config if editing
    if (id) {
      try {
        const response = await fetch(`/api/config/raw/${id}`, {
          headers: {
            'Authorization': `Bearer ${api.getToken()}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.config) {
            document.getElementById('advancedConfigEditor').value = data.config;
          }
        }
      } catch (error) {
        console.error('Failed to load config:', error);
      }
    }

    // Tab switching
    let advancedTestPassed = false;
    let advancedConfigLoaded = !!id; // Track if config has been loaded/generated
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        // Update tab active states
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update content active states
        tabContents.forEach(content => content.classList.remove('active'));
        document.getElementById(`${tabName}Tab`).classList.add('active');

        // Auto-generate config when switching to Advanced tab for the first time
        if (tabName === 'advanced' && !advancedConfigLoaded) {
          const currentConfig = document.getElementById('advancedConfigEditor').value.trim();
          if (!currentConfig) {
            // Automatically generate from basic form (silently, no error messages)
            generateConfigFromBasic(false);
            advancedConfigLoaded = true;
          }
        }

        // Sync Basic form from Advanced config when switching back to Basic
        if (tabName === 'basic' && advancedConfigLoaded) {
          const advancedConfig = document.getElementById('advancedConfigEditor').value.trim();
          if (advancedConfig) {
            parseConfigToBasicForm(advancedConfig);
          }
        }
      });
    });

    // Function to parse nginx config and populate basic form
    const parseConfigToBasicForm = (config) => {
      try {
        // Extract server_name
        const serverNameMatch = config.match(/server_name\s+([^;]+);/);
        if (serverNameMatch) {
          document.getElementById('domainNames').value = serverNameMatch[1].trim();
        }

        // Extract listen directives to determine TLS
        const hasTLS = /listen\s+443\s+ssl/.test(config);
        document.getElementById('sslEnabled').checked = hasTLS;
        document.getElementById('sslCertGroup').style.display = hasTLS ? 'block' : 'none';

        // Extract proxy_pass from the root location (/) only
        // Match location / { ... proxy_pass ... } specifically
        const locationRootMatch = config.match(/location\s+\/\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s);
        if (locationRootMatch) {
          const locationContent = locationRootMatch[1];
          const proxyPassMatch = locationContent.match(/proxy_pass\s+(https?):\/\/([^:/]+):(\d+)/);
          if (proxyPassMatch) {
            document.getElementById('forwardScheme').value = proxyPassMatch[1];
            document.getElementById('forwardHost').value = proxyPassMatch[2];
            document.getElementById('forwardPort').value = proxyPassMatch[3];
          }
        } else {
          // Fallback: try to extract any proxy_pass if no location / found
          const proxyPassMatch = config.match(/proxy_pass\s+(https?):\/\/([^:/]+):(\d+)/);
          if (proxyPassMatch) {
            document.getElementById('forwardScheme').value = proxyPassMatch[1];
            document.getElementById('forwardHost').value = proxyPassMatch[2];
            document.getElementById('forwardPort').value = proxyPassMatch[3];
          }
        }

        // Try to extract name from comment
        const nameMatch = config.match(/#\s*Proxy:\s*(.+)/);
        if (nameMatch && !id) {
          // Only set name if creating new (not editing)
          document.getElementById('proxyName').value = nameMatch[1].trim();
        }

        return true;
      } catch (error) {
        console.error('Failed to parse config:', error);
        return false;
      }
    };

    // Function to generate config from basic form
    const generateConfigFromBasic = (showMessage = true) => {
      const name = document.getElementById('proxyName').value.trim();
      const type = document.getElementById('proxyType').value;
      const domainNames = document.getElementById('domainNames').value.trim();
      const forwardScheme = document.getElementById('forwardScheme').value;
      const forwardHost = document.getElementById('forwardHost').value.trim();
      const forwardPort = document.getElementById('forwardPort').value;
      const sslEnabled = document.getElementById('sslEnabled').checked;
      const sslCertId = document.getElementById('sslCert').value;

      if (!name || !domainNames || !forwardHost || !forwardPort) {
        if (showMessage) {
          showError('Please fill in all required fields in the Basic tab first');
        }
        return false;
      }

      // Generate nginx config based on form data
      let config = `# Proxy: ${name}\n`;
      config += `server {\n`;

      if (sslEnabled) {
        config += `    listen 443 ssl http2;\n`;
        config += `    listen [::]:443 ssl http2;\n`;
      } else {
        config += `    listen 80;\n`;
        config += `    listen [::]:80;\n`;
      }

      config += `\n`;
      config += `    server_name ${domainNames.split(',').map(d => d.trim()).join(' ')};\n`;
      config += `\n`;

      if (sslEnabled && sslCertId) {
        const selectedCert = certificates.find(c => c.id === parseInt(sslCertId));
        if (selectedCert) {
          config += `    ssl_certificate /path/to/${selectedCert.name}.crt;\n`;
          config += `    ssl_certificate_key /path/to/${selectedCert.name}.key;\n`;
          config += `    ssl_protocols TLSv1.2 TLSv1.3;\n`;
          config += `    ssl_ciphers HIGH:!aNULL:!MD5;\n`;
          config += `\n`;
        }
      }

      // Add selected modules
      const selectedModules = Array.from(document.querySelectorAll('[id^="module_"]:checked'));
      if (selectedModules.length > 0) {
        selectedModules.forEach(checkbox => {
          const moduleId = parseInt(checkbox.value);
          const module = modules.find(m => m.id === moduleId);
          if (module) {
            config += `    # Module: ${module.name}\n`;
            module.content.split('\n').forEach(line => {
              if (line.trim()) {
                config += `    ${line.trim()}\n`;
              }
            });
            config += `\n`;
          }
        });
      }

      config += `    location / {\n`;
      config += `        proxy_pass ${forwardScheme}://${forwardHost}:${forwardPort};\n`;
      config += `        proxy_set_header Host $host;\n`;
      config += `        proxy_set_header X-Real-IP $remote_addr;\n`;
      config += `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n`;
      config += `        proxy_set_header X-Forwarded-Proto $scheme;\n`;

      const advancedConfigText = document.getElementById('advancedConfig').value.trim();
      if (advancedConfigText) {
        config += `\n`;
        advancedConfigText.split('\n').forEach(line => {
          if (line.trim()) {
            config += `        ${line.trim()}\n`;
          }
        });
      }

      config += `    }\n`;
      config += `}\n`;

      document.getElementById('advancedConfigEditor').value = config;
      if (showMessage) {
        showSuccess('Configuration generated from basic form');
      }
      advancedTestPassed = false;
      document.getElementById('saveAdvancedBtn').style.display = 'none';
      document.getElementById('advancedTestResults').style.display = 'none';
      return true;
    };

    // Generate config from basic form button
    document.getElementById('generateBtn').addEventListener('click', () => {
      generateConfigFromBasic();
      advancedConfigLoaded = true;
    });

    // Reset test status when advanced config changes
    document.getElementById('advancedConfigEditor').addEventListener('input', () => {
      advancedTestPassed = false;
      document.getElementById('saveAdvancedBtn').style.display = 'none';
      document.getElementById('advancedTestResults').style.display = 'none';
    });

    // Test advanced configuration
    document.getElementById('testAdvancedBtn').addEventListener('click', async () => {
      const config = document.getElementById('advancedConfigEditor').value.trim();
      const name = document.getElementById('proxyName').value.trim();

      if (!config) {
        showError('Please enter nginx configuration');
        return;
      }

      if (!name) {
        showError('Please enter a proxy name in the Basic tab');
        return;
      }

      const testBtn = document.getElementById('testAdvancedBtn');
      const testResults = document.getElementById('advancedTestResults');

      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
      testResults.style.display = 'none';

      try {
        const response = await fetch('/api/config/test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${api.getToken()}`
          },
          body: JSON.stringify({ config, filename: name })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          advancedTestPassed = true;
          testResults.innerHTML = `
            <div class="test-result success">
              <strong>✅ Configuration Test Passed!</strong>
              <p style="margin: 5px 0 0 0;">${data.message}</p>
            </div>
          `;
          testResults.style.display = 'block';
          document.getElementById('saveAdvancedBtn').style.display = 'inline-block';
          document.getElementById('saveAdvancedBtn').disabled = false;
        } else {
          advancedTestPassed = false;
          testResults.innerHTML = `
            <div class="test-result error">
              <strong>❌ Configuration Test Failed</strong>
              <pre>${escapeHtml(data.error || data.message)}</pre>
            </div>
          `;
          testResults.style.display = 'block';
          document.getElementById('saveAdvancedBtn').style.display = 'none';
        }
      } catch (error) {
        showError(error.message || 'Failed to test configuration');
        advancedTestPassed = false;
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test Configuration';
      }
    });

    // Save from advanced tab
    document.getElementById('saveAdvancedBtn').addEventListener('click', async () => {
      if (!advancedTestPassed) {
        showError('Please test the configuration first');
        return;
      }

      const name = document.getElementById('proxyName').value.trim();
      const config = document.getElementById('advancedConfigEditor').value.trim();

      if (!name || !config) {
        showError('Please provide a name and configuration');
        return;
      }

      // Parse config and populate Basic form to keep them in sync
      parseConfigToBasicForm(config);

      const confirmMessage = id
        ? 'Save this configuration? This will update the existing proxy.'
        : 'Save this configuration? This will create a new proxy.';

      if (!confirm(confirmMessage)) {
        return;
      }

      showLoading();

      try {
        const payload = { name, filename: name, config };
        if (id) {
          payload.id = id; // Include ID when editing
        }

        const response = await fetch('/api/config/save', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${api.getToken()}`
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
          showSuccess(data.message || 'Configuration saved successfully!');
          closeModal();
          await renderProxies(document.getElementById('mainContent'));
        } else {
          throw new Error(data.error || 'Failed to save configuration');
        }
      } catch (error) {
        hideLoading();
        showError(error.message);
      }
    });

    // Cancel from advanced tab
    document.getElementById('cancelAdvancedBtn').addEventListener('click', closeModal);

    // Form submit handler
    document.getElementById('proxyForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const selectedModules = Array.from(document.querySelectorAll('[id^="module_"]:checked'))
        .map(cb => parseInt(cb.value));

      const data = {
        name: document.getElementById('proxyName').value,
        type: document.getElementById('proxyType').value,
        domain_names: document.getElementById('domainNames').value,
        forward_scheme: document.getElementById('forwardScheme').value,
        forward_host: document.getElementById('forwardHost').value,
        forward_port: parseInt(document.getElementById('forwardPort').value),
        ssl_enabled: document.getElementById('sslEnabled').checked,
        ssl_cert_id: document.getElementById('sslCert').value || null,
        advanced_config: document.getElementById('advancedConfig').value || null,
        module_ids: selectedModules
      };

      // Update Advanced tab with latest Basic form data to keep in sync
      generateConfigFromBasic(false);
      advancedConfigLoaded = true;

      showLoading();
      try {
        if (id) {
          await api.updateProxy(id, data);
          showSuccess('Proxy updated successfully');
        } else {
          await api.createProxy(data);
          showSuccess('Proxy created successfully');
        }
        closeModal();
        await renderProxies(document.getElementById('mainContent'));
      } catch (error) {
        hideLoading();
        showError(error.message);
      }
    });

    // Cancel button
    document.getElementById('cancelBtn').addEventListener('click', closeModal);

    hideLoading();
  } catch (error) {
    hideLoading();
    showError(error.message);
  }
}
