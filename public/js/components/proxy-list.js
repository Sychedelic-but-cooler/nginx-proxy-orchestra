import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess } from '../app.js';
import state from '../state.js';
import { escapeHtml } from '../utils/sanitize.js';

// Track selected proxies and SSE connection
let selectedProxies = new Set();
let proxyEventSource = null;

export async function renderProxies(container) {
  showLoading();

  try {
    const [proxies, allRateLimits] = await Promise.all([
      api.getProxies(),
      api.getRateLimits()
    ]);
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
          <div id="bulkActionsBar" style="padding: 15px; background: var(--card-bg); border-bottom: 1px solid var(--border-color); display: none; align-items: center; gap: 10px;">
            <span id="selectionCount" style="font-weight: 600; color: var(--text-color);"></span>
            <button class="btn btn-sm btn-success" id="bulkEnableBtn">Enable Selected</button>
            <button class="btn btn-sm btn-secondary" id="bulkDisableBtn">Disable Selected</button>
            <button class="btn btn-sm btn-danger" id="bulkDeleteBtn">Delete Selected</button>
            <button class="btn btn-sm" id="clearSelectionBtn">Clear Selection</button>
          </div>
          <table class="table">
            <thead>
              <tr>
                <th style="width: 40px;">
                  <input type="checkbox" id="selectAllProxies" style="cursor: pointer;" title="Select all">
                </th>
                <th>Name</th>
                <th>Type</th>
                <th>Forward To</th>
                <th>TLS</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${proxies.map(proxy => {
                // Find rate limit for this proxy
                const rateLimit = allRateLimits.rateLimits.find(rl => rl.proxy_id === proxy.id && rl.enabled);
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

                // Build launch URL (custom or auto-generated)
                let launchUrl = proxy.launch_url; // Use custom if defined

                if (!launchUrl && proxy.type === 'reverse') {
                  // Fall back to auto-generated for reverse proxies
                  const firstDomain = proxy.domain_names.split(',')[0].trim();
                  if (firstDomain !== 'N/A') {
                    launchUrl = `${proxy.ssl_enabled ? 'https' : 'http'}://${firstDomain}`;
                  }
                }

                // Build forward to display based on type
                let forwardTo;
                if (proxy.type === 'stream') {
                  const protocol = (proxy.stream_protocol || 'tcp').toUpperCase();
                  forwardTo = `${protocol}: ${proxy.incoming_port || '?'} → ${escapeHtml(proxy.forward_host)}:${proxy.forward_port}`;
                } else if (proxy.type === '404') {
                  forwardTo = '<span class="badge badge-secondary">404 Response</span>';
                } else if (proxy.forward_host === 'N/A' || !proxy.forward_host || proxy.forward_port === 0) {
                  // Handle proxies with placeholder/invalid forward data
                  forwardTo = '<span class="badge badge-secondary">-</span>';
                } else {
                  // Reverse proxy type
                  forwardTo = `${escapeHtml(proxy.forward_scheme)}://${escapeHtml(proxy.forward_host)}:${proxy.forward_port}`;
                }

                return `
                <tr ${proxy.config_status === 'error' ? 'style="background-color: rgba(220, 53, 69, 0.05);"' : ''}>
                  <td>
                    <input type="checkbox" class="proxy-checkbox" data-id="${proxy.id}" style="cursor: pointer;" ${selectedProxies.has(proxy.id) ? 'checked' : ''}>
                  </td>
                  <td>
                    ${launchUrl ? `
                      <a href="${escapeHtml(launchUrl)}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(launchUrl)}" style="display: inline-block; vertical-align: middle; margin-right: 8px; color: var(--primary-color); text-decoration: none;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                          <polyline points="15 3 21 3 21 9"></polyline>
                          <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                      </a>
                    ` : ''}
                    <strong>${escapeHtml(proxy.name)}</strong>
                    ${proxy.waf_profile_name ? `<span class="badge badge-warning" style="margin-left: 8px;" title="WAF: ${escapeHtml(proxy.waf_profile_name)} (Paranoia ${proxy.waf_profile_paranoia || 1})">🛡️ WAF</span>` : ''}
                    ${proxy.config_error ? `<br><small style="color: var(--danger-color);" title="${escapeHtml(proxy.config_error)}">⚠️ ${escapeHtml(proxy.config_error)}</small>` : ''}
                  </td>
                  <td><span class="badge badge-info">${escapeHtml(proxy.type)}</span></td>
                  <td>${forwardTo}</td>
                  <td>
                    ${proxy.type === 'stream' ? '<span class="badge badge-secondary">N/A</span>' :
                      (proxy.ssl_enabled ?
                        `<span class="badge badge-success">✓ ${escapeHtml(proxy.ssl_cert_name || 'Enabled')}</span>` :
                        '<span class="badge badge-danger">✗</span>')}
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

      // Bulk selection event listeners
      const selectAllCheckbox = document.getElementById('selectAllProxies');
      selectAllCheckbox?.addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.proxy-checkbox');
        checkboxes.forEach(cb => {
          cb.checked = e.target.checked;
          const id = parseInt(cb.dataset.id);
          if (e.target.checked) {
            selectedProxies.add(id);
          } else {
            selectedProxies.delete(id);
          }
        });
        updateBulkActionsBar();
      });

      document.querySelectorAll('.proxy-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const id = parseInt(cb.dataset.id);
          if (e.target.checked) {
            selectedProxies.add(id);
          } else {
            selectedProxies.delete(id);
          }
          updateBulkActionsBar();
          
          // Update select all checkbox state
          const allCheckboxes = document.querySelectorAll('.proxy-checkbox');
          const allChecked = Array.from(allCheckboxes).every(checkbox => checkbox.checked);
          if (selectAllCheckbox) {
            selectAllCheckbox.checked = allChecked;
          }
        });
      });

      // Bulk action buttons
      document.getElementById('bulkEnableBtn')?.addEventListener('click', () => handleBulkToggle(true, container));
      document.getElementById('bulkDisableBtn')?.addEventListener('click', () => handleBulkToggle(false, container));
      document.getElementById('bulkDeleteBtn')?.addEventListener('click', () => handleBulkDelete(container));
      document.getElementById('clearSelectionBtn')?.addEventListener('click', () => {
        selectedProxies.clear();
        document.querySelectorAll('.proxy-checkbox').forEach(cb => cb.checked = false);
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
        updateBulkActionsBar();
      });

      updateBulkActionsBar();
    }

    // Add proxy button handler
    document.getElementById('addProxyBtn')?.addEventListener('click', () => showProxyForm());

    // Setup SSE connection for real-time updates
    setupProxyEventStream(container);

  } catch (error) {
    showError(error.message);
    container.innerHTML = '<div class="empty-state"><h2>Failed to load proxies</h2></div>';
  } finally {
    hideLoading();
  }
}

function updateBulkActionsBar() {
  const bulkActionsBar = document.getElementById('bulkActionsBar');
  const selectionCount = document.getElementById('selectionCount');
  
  if (selectedProxies.size > 0) {
    bulkActionsBar.style.display = 'flex';
    selectionCount.textContent = `${selectedProxies.size} proxy${selectedProxies.size > 1 ? 'es' : ''} selected`;
  } else {
    bulkActionsBar.style.display = 'none';
  }
}

async function handleBulkToggle(enabled, container) {
  if (selectedProxies.size === 0) {
    showError('No proxies selected');
    return;
  }

  const action = enabled ? 'enable' : 'disable';
  if (!confirm(`Are you sure you want to ${action} ${selectedProxies.size} proxy${selectedProxies.size > 1 ? 'es' : ''}?`)) {
    return;
  }

  showLoading();
  try {
    const result = await api.bulkToggleProxies(Array.from(selectedProxies), enabled);
    
    if (result.summary.failed > 0) {
      showError(`${action} completed with ${result.summary.failed} failure(s). Check console for details.`);
      console.error('Bulk toggle failures:', result.results.failed);
    } else {
      showSuccess(`Successfully ${action}d ${result.summary.succeeded} proxy${result.summary.succeeded > 1 ? 'es' : ''}`);
    }
    
    selectedProxies.clear();
    await renderProxies(container);
  } catch (error) {
    hideLoading();
    showError(error.message);
  }
}

async function handleBulkDelete(container) {
  if (selectedProxies.size === 0) {
    showError('No proxies selected');
    return;
  }

  if (!confirm(`Are you sure you want to delete ${selectedProxies.size} proxy${selectedProxies.size > 1 ? 'es' : ''}? This action cannot be undone.`)) {
    return;
  }

  showLoading();
  try {
    const result = await api.bulkDeleteProxies(Array.from(selectedProxies));
    
    if (result.summary.failed > 0) {
      showError(`Delete completed with ${result.summary.failed} failure(s). Check console for details.`);
      console.error('Bulk delete failures:', result.results.failed);
    } else {
      showSuccess(`Successfully deleted ${result.summary.succeeded} proxy${result.summary.succeeded > 1 ? 'es' : ''}`);
    }
    
    selectedProxies.clear();
    await renderProxies(container);
  } catch (error) {
    hideLoading();
    showError(error.message);
  }
}

function setupProxyEventStream(container) {
  // Close existing connection if any
  if (proxyEventSource) {
    proxyEventSource.close();
  }

  try {
    proxyEventSource = api.createProxyEventStream();

    proxyEventSource.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'proxy_event') {
          console.log('[Proxy SSE] Received proxy event:', data.eventType);
          
          // Auto-refresh the proxy list when any proxy change occurs
          // Don't show loading spinner for background refresh
          const proxies = await api.getProxies();
          state.set('proxies', proxies);
          
          // Re-render without showing loading spinner
          await renderProxiesQuiet(container);
        }
      } catch (error) {
        console.error('[Proxy SSE] Error processing event:', error);
      }
    });

    proxyEventSource.addEventListener('error', (error) => {
      console.error('[Proxy SSE] Connection error:', error);
      // Try to reconnect after 5 seconds
      setTimeout(() => {
        if (document.getElementById('proxy-container')) {
          setupProxyEventStream(container);
        }
      }, 5000);
    });

    console.log('[Proxy SSE] Connected to proxy event stream');
  } catch (error) {
    console.error('[Proxy SSE] Failed to setup event stream:', error);
  }
}

// Quiet re-render without loading spinner (for SSE updates)
async function renderProxiesQuiet(container) {
  try {
    const [proxies, allRateLimits] = await Promise.all([
      api.getProxies(),
      api.getRateLimits()
    ]);
    state.set('proxies', proxies);
    
    if (proxies.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h2>No Proxy Hosts</h2>
          <p>Create your first reverse proxy host to get started</p>
        </div>
      `;
      return;
    }

    // Store current scroll position
    const scrollY = window.scrollY;
    
    // Re-render the table (this will be the same code as above)
    container.innerHTML = `
      <div class="card">
        <div id="bulkActionsBar" style="padding: 15px; background: var(--card-bg); border-bottom: 1px solid var(--border-color); display: none; align-items: center; gap: 10px;">
          <span id="selectionCount" style="font-weight: 600; color: var(--text-color);"></span>
          <button class="btn btn-sm btn-success" id="bulkEnableBtn">Enable Selected</button>
          <button class="btn btn-sm btn-secondary" id="bulkDisableBtn">Disable Selected</button>
          <button class="btn btn-sm btn-danger" id="bulkDeleteBtn">Delete Selected</button>
          <button class="btn btn-sm" id="clearSelectionBtn">Clear Selection</button>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th style="width: 40px;">
                <input type="checkbox" id="selectAllProxies" style="cursor: pointer;" title="Select all">
              </th>
              <th>Name</th>
              <th>Type</th>
              <th>Forward To</th>
              <th>TLS</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${proxies.map(proxy => {
              const rateLimit = allRateLimits.rateLimits.find(rl => rl.proxy_id === proxy.id && rl.enabled);
              let statusClass, statusText;
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

              let launchUrl = proxy.launch_url;
              if (!launchUrl && proxy.type === 'reverse') {
                const firstDomain = proxy.domain_names.split(',')[0].trim();
                if (firstDomain !== 'N/A') {
                  launchUrl = `${proxy.ssl_enabled ? 'https' : 'http'}://${firstDomain}`;
                }
              }

              let forwardTo;
              if (proxy.type === 'stream') {
                const protocol = (proxy.stream_protocol || 'tcp').toUpperCase();
                forwardTo = `${protocol}: ${proxy.incoming_port || '?'} → ${escapeHtml(proxy.forward_host)}:${proxy.forward_port}`;
              } else if (proxy.type === '404') {
                forwardTo = '<span class="badge badge-secondary">404 Response</span>';
              } else if (proxy.forward_host === 'N/A' || !proxy.forward_host || proxy.forward_port === 0) {
                // Handle proxies with placeholder/invalid forward data
                forwardTo = '<span class="badge badge-secondary">-</span>';
              } else {
                forwardTo = `${escapeHtml(proxy.forward_scheme)}://${escapeHtml(proxy.forward_host)}:${proxy.forward_port}`;
              }

              return `
              <tr ${proxy.config_status === 'error' ? 'style="background-color: rgba(220, 53, 69, 0.05);"' : ''}>
                <td>
                  <input type="checkbox" class="proxy-checkbox" data-id="${proxy.id}" style="cursor: pointer;" ${selectedProxies.has(proxy.id) ? 'checked' : ''}>
                </td>
                <td>
                  ${launchUrl ? `
                    <a href="${escapeHtml(launchUrl)}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(launchUrl)}" style="display: inline-block; vertical-align: middle; margin-right: 8px; color: var(--primary-color); text-decoration: none;">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                      </svg>
                    </a>
                  ` : ''}
                  <strong>${escapeHtml(proxy.name)}</strong>
                  ${proxy.waf_profile_name ? `<span class="badge badge-warning" style="margin-left: 8px;" title="WAF: ${escapeHtml(proxy.waf_profile_name)} (Paranoia ${proxy.waf_profile_paranoia || 1})">🛡️ WAF</span>` : ''}
                  ${proxy.config_error ? `<br><small style="color: var(--danger-color);" title="${escapeHtml(proxy.config_error)}">⚠️ ${escapeHtml(proxy.config_error)}</small>` : ''}
                </td>
                <td><span class="badge badge-info">${escapeHtml(proxy.type)}</span></td>
                <td>${forwardTo}</td>
                <td>
                  ${proxy.type === 'stream' ? '<span class="badge badge-secondary">N/A</span>' :
                    (proxy.ssl_enabled ?
                      `<span class="badge badge-success">✓ ${escapeHtml(proxy.ssl_cert_name || 'Enabled')}</span>` :
                      '<span class="badge badge-danger">✗</span>')}
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

    // Reattach all event listeners (same as in renderProxies)
    document.querySelectorAll('.toggle-proxy').forEach(btn => {
      btn.addEventListener('click', () => handleToggleProxy(parseInt(btn.dataset.id), container));
    });

    document.querySelectorAll('.edit-proxy').forEach(btn => {
      btn.addEventListener('click', () => handleEditProxy(parseInt(btn.dataset.id)));
    });

    document.querySelectorAll('.delete-proxy').forEach(btn => {
      btn.addEventListener('click', () => handleDeleteProxy(parseInt(btn.dataset.id), container));
    });

    const selectAllCheckbox = document.getElementById('selectAllProxies');
    selectAllCheckbox?.addEventListener('change', (e) => {
      const checkboxes = document.querySelectorAll('.proxy-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = e.target.checked;
        const id = parseInt(cb.dataset.id);
        if (e.target.checked) {
          selectedProxies.add(id);
        } else {
          selectedProxies.delete(id);
        }
      });
      updateBulkActionsBar();
    });

    document.querySelectorAll('.proxy-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = parseInt(cb.dataset.id);
        if (e.target.checked) {
          selectedProxies.add(id);
        } else {
          selectedProxies.delete(id);
        }
        updateBulkActionsBar();
        
        const allCheckboxes = document.querySelectorAll('.proxy-checkbox');
        const allChecked = Array.from(allCheckboxes).every(checkbox => checkbox.checked);
        if (selectAllCheckbox) {
          selectAllCheckbox.checked = allChecked;
        }
      });
    });

    document.getElementById('bulkEnableBtn')?.addEventListener('click', () => handleBulkToggle(true, container));
    document.getElementById('bulkDisableBtn')?.addEventListener('click', () => handleBulkToggle(false, container));
    document.getElementById('bulkDeleteBtn')?.addEventListener('click', () => handleBulkDelete(container));
    document.getElementById('clearSelectionBtn')?.addEventListener('click', () => {
      selectedProxies.clear();
      document.querySelectorAll('.proxy-checkbox').forEach(cb => cb.checked = false);
      if (selectAllCheckbox) selectAllCheckbox.checked = false;
      updateBulkActionsBar();
    });

    updateBulkActionsBar();

    // Restore scroll position
    window.scrollTo(0, scrollY);
  } catch (error) {
    console.error('Quiet refresh error:', error);
  }
}

// Cleanup function to close SSE connection
export function cleanupProxyList() {
  if (proxyEventSource) {
    proxyEventSource.close();
    proxyEventSource = null;
    console.log('[Proxy SSE] Connection closed');
  }
  selectedProxies.clear();
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
    // Fetch modules, certificates, and WAF profiles
    const [modules, certificates, wafProfiles] = await Promise.all([
      api.request('/api/modules/snippets'),
      api.getCertificates(),
      api.getWAFProfiles()
    ]);

    let proxyData = null;
    let initialConfig = '';
    let currentWAFProfile = null;

    if (id) {
      // Edit existing - fetch raw config and WAF assignment (will auto-migrate if needed)
      [proxyData, currentWAFProfile] = await Promise.all([
        api.request(`/api/config/raw/${id}`),
        api.request(`/api/proxies/${id}/waf`).catch(() => ({ profile: null }))
      ]);
      initialConfig = proxyData.config;
    } else {
      // New proxy - load default template
      const template = await api.request('/api/config/template', {
        method: 'POST',
        body: {
          type: 'reverse',
          name: 'New Proxy',
          options: { ssl_enabled: true }
        }
      });
      initialConfig = template.config;
    }

    hideLoading();

    const modal = document.getElementById('modalContainer');
    modal.innerHTML = `
      <div class="modal-overlay" id="proxyModal">
        <div class="modal" style="width: 80%; max-width: 1600px;">
          <div class="modal-header">
            <h3>${id ? 'Edit' : 'Add'} Proxy Host</h3>
            <button class="modal-close" id="closeProxyModal">&times;</button>
          </div>

          <div class="modal-body">
            <div class="proxy-editor-config-section">
              <div class="section-header">
                <h4>Proxy Configuration</h4>
                <div class="form-group-checkbox-inline">
                  <label>
                    <input type="checkbox" id="proxyEnabled" ${!proxyData || proxyData.enabled ? 'checked' : ''}>
                    <span>Enabled</span>
                  </label>
                  <small class="help-text-inline">Activate this proxy host in Nginx</small>
                </div>
              </div>

              <div class="proxy-editor-grid">
                <div class="form-group">
                  <label for="proxyName">Proxy Name *</label>
                  <input type="text" id="proxyName" value="${escapeHtml(proxyData?.name || '')}" required placeholder="e.g., example.com">
                </div>

                <div class="form-group">
                  <label for="proxyType">Type *</label>
                  <select id="proxyType" ${id ? 'disabled' : ''}>
                    <option value="reverse" ${!proxyData || proxyData.type === 'reverse' ? 'selected' : ''}>Reverse Proxy</option>
                    <option value="stream" ${proxyData?.type === 'stream' ? 'selected' : ''}>Stream (TCP/UDP)</option>
                    <option value="404" ${proxyData?.type === '404' ? 'selected' : ''}>404 Host</option>
                  </select>
                </div>

                <div class="form-group">
                  <label for="launchUrl">Launch URL <span class="optional-label">(optional)</span></label>
                  <input type="text" id="launchUrl" value="${escapeHtml(proxyData?.launch_url || '')}" placeholder="https://example.com">
                  <small class="field-help">Custom URL for the launch button</small>
                </div>

                <div class="form-group">
                  <label for="wafProfileSelect">WAF Profile <span class="optional-label">(optional)</span></label>
                  <select id="wafProfileSelect">
                    <option value="">None</option>
                    ${wafProfiles.profiles?.map(profile => `
                      <option
                        value="${profile.id}"
                        ${currentWAFProfile?.profile?.id === profile.id ? 'selected' : ''}
                      >
                        ${escapeHtml(profile.name)} - Paranoia ${profile.paranoia_level}${profile.enabled ? '' : ' (Disabled)'}
                      </option>
                    `).join('') || ''}
                  </select>
                  <small class="field-help">ModSecurity protection profile</small>
                </div>
              </div>
            </div>

            <div class="proxy-editor-split">
              <div class="proxy-editor-main">
                <div class="editor-header">
                  <label>Nginx Configuration</label>
                  <div class="certificate-selector">
                    <select id="certSelect" class="cert-dropdown">
                      <option value="">Select SSL Certificate...</option>
                      ${certificates.map(cert => `
                        <option value="${cert.id}" data-cert-path="${escapeHtml(cert.cert_path)}" data-key-path="${escapeHtml(cert.key_path)}">
                          ${escapeHtml(cert.name)} (${escapeHtml(cert.domain_names)})
                        </option>
                      `).join('')}
                    </select>
                    <button id="applyCertBtn" class="btn btn-sm btn-primary" disabled>Apply Certificate</button>
                  </div>
                </div>
                <div class="editor-actions" style="margin-bottom: 12px; display: flex; align-items: center; gap: 12px;">
                  <button id="generateTemplateBtn" class="btn btn-secondary" style="display: flex; align-items: center; gap: 6px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="12" y1="18" x2="12" y2="12"></line>
                      <line x1="9" y1="15" x2="15" y2="15"></line>
                    </svg>
                    Generate Template
                  </button>
                  <small style="color: #6b7280; font-size: 13px;">Use the wizard to build a configuration with recipes and modules</small>
                </div>
                <textarea id="nginxConfig" class="config-editor" spellcheck="false">${escapeHtml(initialConfig)}</textarea>
                <div class="editor-actions">
                  <button id="testConfigBtn" class="btn btn-secondary">Test Configuration</button>
                  <span id="testStatus"></span>
                </div>
              </div>

              <div class="proxy-editor-sidebar">
                <h3>Module Snippets</h3>
                <p class="help-text">Click to copy nginx directives</p>

                ${renderModuleSidebar(modules)}
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
            <button class="btn btn-primary" id="saveBtn" disabled>Save</button>
          </div>
        </div>
      </div>
    `;

    // Event handlers
    setupEditorEventHandlers(modal, id, certificates);

    hideLoading();
  } catch (error) {
    hideLoading();
    showError(error.message);
  }
}

function renderModuleSidebar(modules) {
  let html = '';

  // modules is now an object with tag names as keys
  const tags = Object.keys(modules).sort();

  if (tags.length === 0) {
    return '<p class="help-text">No modules available</p>';
  }

  // Generate collapsible sections for each tag
  tags.forEach((tag, index) => {
    const tagModules = modules[tag];
    if (!tagModules || tagModules.length === 0) return;

    // All tags collapsed by default
    const isExpanded = false;
    const sectionId = `tag-section-${tag.replace(/\s+/g, '-').toLowerCase()}`;

    html += `
      <div class="module-tag-section">
        <div class="module-tag-header" data-section-id="${sectionId}" style="cursor: pointer;">
          <h4 style="margin: 0; display: flex; align-items: center; justify-content: space-between;">
            <span>
              <span id="${sectionId}-icon" class="collapse-icon">${isExpanded ? '▼' : '▶'}</span>
              ${escapeHtml(tag)}
            </span>
            <span class="badge badge-secondary" style="font-size: 11px;">${tagModules.length}</span>
          </h4>
        </div>
        <div id="${sectionId}" class="module-tag-content" style="display: ${isExpanded ? 'block' : 'none'};">
          ${tagModules.map(m => `
            <div class="module-snippet">
              <div class="module-header">
                <strong>${escapeHtml(m.name)}</strong>
                ${m.level ? `<span class="badge badge-info" style="font-size: 10px; margin-left: 4px;">${escapeHtml(m.level)}</span>` : ''}
              </div>
              ${m.description ? `<p style="font-size: 12px; color: #666; margin: 4px 0;">${escapeHtml(m.description)}</p>` : ''}
              <pre><code>${escapeHtml(m.content)}</code></pre>
              <button class="btn btn-sm copy-btn" data-content="${escapeHtml(m.content)}">Copy</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });

  return html;
}

function setupEditorEventHandlers(modal, proxyId, certificates) {
  const testBtn = modal.querySelector('#testConfigBtn');
  const saveBtn = modal.querySelector('#saveBtn');
  const configTextarea = modal.querySelector('#nginxConfig');
  const testStatus = modal.querySelector('#testStatus');
  const proxyTypeSelect = modal.querySelector('#proxyType');
  const certSelect = modal.querySelector('#certSelect');
  const applyCertBtn = modal.querySelector('#applyCertBtn');

  // Certificate selection handler
  certSelect.addEventListener('change', (e) => {
    applyCertBtn.disabled = !e.target.value;
  });

  // Apply certificate handler
  applyCertBtn.addEventListener('click', () => {
    const selectedOption = certSelect.options[certSelect.selectedIndex];
    if (!selectedOption || !selectedOption.value) return;

    const certPath = selectedOption.dataset.certPath;
    const keyPath = selectedOption.dataset.keyPath;

    let config = configTextarea.value;

    // Replace placeholders
    config = config.replace(/ssl_certificate\s+{{SSL_CERT_PATH}};/g, `ssl_certificate ${certPath};`);
    config = config.replace(/ssl_certificate_key\s+{{SSL_KEY_PATH}};/g, `ssl_certificate_key ${keyPath};`);

    configTextarea.value = config;

    // Reset test status
    testStatus.textContent = '';
    testStatus.className = '';
    saveBtn.disabled = true;

    showSuccess(`Certificate paths inserted for ${selectedOption.text.split(' (')[0]}`);
  });

  // Generate Template button handler
  const generateTemplateBtn = modal.querySelector('#generateTemplateBtn');
  if (generateTemplateBtn) {
    generateTemplateBtn.addEventListener('click', () => {
      const currentConfig = configTextarea.value;
      const proxyName = modal.querySelector('#proxyName').value || '';
      const proxyType = modal.querySelector('#proxyType').value;

      showTemplateWizard(currentConfig, proxyName, proxyType, (result) => {
        // Apply generated config to editor
        configTextarea.value = result.config;

        // Populate form fields from wizard
        if (result.name) {
          modal.querySelector('#proxyName').value = result.name;
        }

        if (result.launchUrl) {
          const launchUrlField = modal.querySelector('#launchUrl');
          if (launchUrlField) {
            launchUrlField.value = result.launchUrl;
          }
        }

        if (result.wafProfileId) {
          const wafSelect = modal.querySelector('#wafProfileSelect');
          if (wafSelect) {
            wafSelect.value = result.wafProfileId;
          }
        }

        // Reset test status (requires re-testing)
        testStatus.textContent = '';
        testStatus.className = '';
        saveBtn.disabled = true;

        showSuccess('Template applied! Please test the configuration before saving.');
      });
    });
  }

  // Type change -> load template
  proxyTypeSelect.addEventListener('change', async (e) => {
    if (!proxyId && confirm('Load template for this proxy type? This will replace the current config.')) {
      const type = e.target.value;
      const name = modal.querySelector('#proxyName').value || 'New Proxy';

      try {
        const template = await api.request('/api/config/template', {
          method: 'POST',
          body: {
            type,
            name,
            options: { ssl_enabled: type === 'reverse' || type === '404' }
          }
        });
        configTextarea.value = template.config;
        testStatus.textContent = '';
        testStatus.className = '';
        saveBtn.disabled = true;
      } catch (error) {
        showError('Failed to load template: ' + error.message);
      }
    }
  });

  // Test configuration
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    testStatus.textContent = '';
    testStatus.className = '';

    const config = configTextarea.value;

    try {
      const result = await api.request('/api/config/test', {
        method: 'POST',
        body: { config }
      });

      if (result.success) {
        testStatus.textContent = '✓ Valid configuration';
        testStatus.className = 'test-success';
        saveBtn.disabled = false;
      } else {
        testStatus.textContent = `✗ Invalid: ${result.error}`;
        testStatus.className = 'test-error';
        saveBtn.disabled = true;
      }
    } catch (error) {
      testStatus.textContent = `✗ Error: ${error.message}`;
      testStatus.className = 'test-error';
      saveBtn.disabled = true;
    }

    testBtn.disabled = false;
    testBtn.textContent = 'Test Configuration';
  });

  // Save
  saveBtn.addEventListener('click', async () => {
    const name = modal.querySelector('#proxyName').value.trim();
    const type = modal.querySelector('#proxyType').value;
    const config = configTextarea.value;
    const enabled = modal.querySelector('#proxyEnabled').checked;
    const launch_url = modal.querySelector('#launchUrl').value.trim() || null;
    const wafProfileId = modal.querySelector('#wafProfileSelect').value;

    if (!name) {
      showError('Name is required');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const saveResponse = await api.request('/api/config/save', {
        method: 'POST',
        body: {
          proxyId,
          name,
          type,
          config,
          enabled,
          launch_url
        }
      });

      const savedProxyId = proxyId || saveResponse.proxyId;

      // Handle WAF profile assignment after save
      if (savedProxyId) {
        if (wafProfileId) {
          // Assign selected profile
          await api.assignWAFProfile(savedProxyId, wafProfileId);
        } else if (proxyId) {
          // Editing existing proxy - remove profile if "None" selected
          await api.removeWAFProfile(savedProxyId).catch(() => {
            // Ignore error if no profile was assigned
          });
        }
      }

      modal.querySelector('#proxyModal').remove();
      showSuccess('Proxy saved successfully');

      // Reload proxy list
      const container = document.querySelector('#proxies');
      if (container) {
        renderProxies(container);
      }
    } catch (error) {
      showError(error.message);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  // Copy module snippets
  modal.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const content = btn.dataset.content;

      try {
        await navigator.clipboard.writeText(content);
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied';
        btn.style.background = '#10b981';
        btn.style.color = 'white';

        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '';
          btn.style.color = '';
        }, 2000);
      } catch (error) {
        console.error('Failed to copy:', error);
        showError('Failed to copy to clipboard');
      }
    });
  });

  // Tag section toggle
  modal.querySelectorAll('.module-tag-header').forEach(header => {
    header.addEventListener('click', () => {
      const sectionId = header.dataset.sectionId;
      const content = document.getElementById(sectionId);
      const icon = document.getElementById(`${sectionId}-icon`);

      if (content && icon) {
        if (content.style.display === 'none') {
          content.style.display = 'block';
          icon.textContent = '▼';
        } else {
          content.style.display = 'none';
          icon.textContent = '▶';
        }
      }
    });
  });

  // Cancel/Close
  const closeModal = () => {
    modal.querySelector('#proxyModal').remove();
  };

  modal.querySelector('#cancelBtn').addEventListener('click', closeModal);
  modal.querySelector('#closeProxyModal').addEventListener('click', closeModal);

  // Close on overlay click
  modal.querySelector('#proxyModal').addEventListener('click', (e) => {
    if (e.target.id === 'proxyModal') {
      closeModal();
    }
  });
}

// ============================================
// TEMPLATE WIZARD CONFIGURATION RECIPES
// ============================================

const RECIPE_DEFINITIONS = {
  'secure-api': {
    id: 'secure-api',
    name: 'Secure API Proxy',
    icon: '',
    description: 'Production-ready API proxy with security hardening, SSL/TLS encryption, and proper headers for secure API communication.',
    type: 'reverse',
    ssl: true,
    modules: ['HSTS', 'Security Headers', 'Real IP', 'HTTP/2', 'Force HTTPS'],
    settings: {
      forward_scheme: 'http',
      forward_host: 'localhost',
      forward_port: '8080',
      websocket_support: false
    }
  },
  'websocket': {
    id: 'websocket',
    name: 'WebSocket Server',
    icon: '',
    description: 'Real-time WebSocket server with proper upgrade headers, SSL support, and connection handling for bi-directional communication.',
    type: 'reverse',
    ssl: true,
    modules: ['WebSocket Support', 'Real IP', 'Force HTTPS'],
    settings: {
      forward_scheme: 'http',
      forward_host: 'localhost',
      forward_port: '3000',
      websocket_support: true
    }
  },
  'static-site': {
    id: 'static-site',
    name: 'Static Website',
    icon: '',
    description: 'Optimized static site hosting with compression, security headers, and SSL for maximum performance and security.',
    type: 'reverse',
    ssl: true,
    modules: ['Security Headers', 'Brotli Compression', 'HTTP/2', 'Force HTTPS'],
    settings: {
      forward_scheme: 'http',
      forward_host: 'localhost',
      forward_port: '8080',
      websocket_support: false
    }
  },
  'high-performance': {
    id: 'high-performance',
    name: 'High Performance',
    icon: '',
    description: 'Maximum performance configuration with HTTP/2, HTTP/3 (QUIC), aggressive compression, and modern protocol support.',
    type: 'reverse',
    ssl: true,
    modules: ['HTTP/2', 'HTTP/3 (QUIC)', 'Brotli Compression', 'Security Headers', 'Force HTTPS'],
    settings: {
      forward_scheme: 'http',
      forward_host: 'localhost',
      forward_port: '8080',
      websocket_support: false
    }
  },
  'basic-http': {
    id: 'basic-http',
    name: 'Basic HTTP Proxy',
    icon: '',
    description: 'Simple HTTP proxy without SSL, minimal configuration for development or internal services that don\'t require encryption.',
    type: 'reverse',
    ssl: false,
    modules: [],
    settings: {
      forward_scheme: 'http',
      forward_host: 'localhost',
      forward_port: '8080',
      websocket_support: false
    }
  },
  'custom': {
    id: 'custom',
    name: 'Custom Configuration',
    icon: '',
    description: 'Start from scratch with a blank template and manually select all options, modules, and settings for complete control.',
    type: 'reverse',
    ssl: false,
    modules: [],
    settings: {
      forward_scheme: 'http',
      forward_host: '',
      forward_port: '',
      websocket_support: false
    }
  }
};

// ============================================
// TEMPLATE WIZARD IMPLEMENTATION
// ============================================

/**
 * Main wizard function - Shows template generator wizard
 * @param {string} currentConfig - Current config in editor
 * @param {string} proxyName - Current proxy name
 * @param {string} proxyType - Current proxy type
 * @param {Function} onComplete - Callback when template is applied
 */
async function showTemplateWizard(currentConfig, proxyName, proxyType, onComplete) {
  try {
    // Initialize wizard state
    const wizardState = {
      currentStep: 1,
      totalSteps: 6,
      recipe: null,
      settings: {
        name: proxyName || '',
        type: proxyType || 'reverse',
        domains: '',
        ssl_enabled: false,
        certificate_id: null,
        forward_scheme: 'http',
        forward_host: 'localhost',
        forward_port: '8080',
        listen_port: 80,
        target_port: 443,
        websocket_support: false
      },
      selectedModules: [],
      availableModules: null,
      certificates: [],
      wafProfiles: [],
      advanced: {
        waf_profile_id: null,
        launch_url: '',
        custom_directives: ''
      }
    };

    // Fetch required data
    try {
      const [modulesData, certificatesData, wafProfilesData] = await Promise.all([
        api.request('/api/modules/snippets'),
        api.getCertificates(),
        api.getWAFProfiles()
      ]);

      wizardState.availableModules = modulesData;
      wizardState.certificates = certificatesData;
      wizardState.wafProfiles = wafProfilesData.profiles || [];
    } catch (error) {
      console.error('Error fetching wizard data:', error);
      showError('Failed to load wizard data. Please try again.');
      return;
    }

    // Create and show wizard
    const wizardHTML = createWizardHTML(wizardState);
    document.body.insertAdjacentHTML('beforeend', wizardHTML);

    // Setup event handlers
    setupWizardHandlers(wizardState, currentConfig, onComplete);

  } catch (error) {
    console.error('Error showing template wizard:', error);
    showError('Failed to open template wizard.');
  }
}

/**
 * Create wizard HTML structure
 */
function createWizardHTML(state) {
  const steps = [
    { number: 1, label: 'Recipe' },
    { number: 2, label: 'Settings' },
    { number: 3, label: 'SSL' },
    { number: 4, label: 'Modules' },
    { number: 5, label: 'Advanced' },
    { number: 6, label: 'Preview' }
  ];

  return `
    <div class="wizard-overlay" id="templateWizard">
      <div class="wizard-container">
        <!-- Header -->
        <div class="wizard-header">
          <h2>Generate Configuration Template</h2>
          <button class="wizard-close-btn" id="closeWizard" aria-label="Close">&times;</button>
        </div>

        <!-- Progress Indicator -->
        <div class="wizard-progress">
          <div class="wizard-steps">
            ${steps.map(step => `
              <div class="wizard-step-indicator ${step.number === 1 ? 'active' : ''}" data-step="${step.number}">
                <div class="step-circle">${step.number}</div>
                <div class="step-line"></div>
                <div class="step-label">${step.label}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Body -->
        <div class="wizard-body">
          <div class="wizard-step-content" id="wizardStepContent">
            ${createStep1RecipeSelection(state)}
          </div>
        </div>

        <!-- Footer -->
        <div class="wizard-footer">
          <div class="wizard-footer-left">
            <button class="wizard-btn wizard-btn-secondary" id="wizardCancel">Cancel</button>
          </div>
          <div class="wizard-footer-right">
            <button class="wizard-btn wizard-btn-secondary" id="wizardBack" disabled>Back</button>
            <button class="wizard-btn wizard-btn-primary" id="wizardNext">Next</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Step 1: Recipe Selection
 */
function createStep1RecipeSelection(state) {
  const recipes = Object.values(RECIPE_DEFINITIONS);

  return `
    <h2 class="wizard-step-title">Choose a Configuration Recipe</h2>
    <p class="wizard-step-description">Select a pre-configured template to get started, or choose custom to build from scratch.</p>

    <div class="recipe-grid">
      ${recipes.map(recipe => `
        <div class="recipe-card ${state.recipe?.id === recipe.id ? 'selected' : ''}" data-recipe-id="${recipe.id}">
          <div class="recipe-name">${recipe.name}</div>
          <p class="recipe-description">${recipe.description}</p>
          <div class="recipe-features">
            ${recipe.ssl ? '<span class="recipe-feature-tag">SSL/TLS</span>' : ''}
            ${recipe.modules.map(m => `<span class="recipe-feature-tag">${m}</span>`).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Step 2: Basic Settings
 */
function createStep2BasicSettings(state) {
  const showDomains = state.settings.type === 'reverse' || state.settings.type === '404';
  const showForward = state.settings.type === 'reverse';
  const showPorts = state.settings.type === 'stream';

  return `
    <h2 class="wizard-step-title">Basic Configuration</h2>
    <p class="wizard-step-description">Configure the basic settings for your proxy host.</p>

    <div class="wizard-form-grid">
      <div class="wizard-form-group">
        <label>Proxy Name <span class="required">*</span></label>
        <input type="text" id="wizardName" value="${escapeHtml(state.settings.name)}" placeholder="e.g., api.example.com" required>
        <small>A friendly name to identify this proxy</small>
        <span class="error">Name is required</span>
      </div>

      <div class="wizard-form-group">
        <label>Proxy Type</label>
        <select id="wizardType">
          <option value="reverse" ${state.settings.type === 'reverse' ? 'selected' : ''}>Reverse Proxy</option>
          <option value="stream" ${state.settings.type === 'stream' ? 'selected' : ''}>Stream (TCP/UDP)</option>
          <option value="404" ${state.settings.type === '404' ? 'selected' : ''}>404 Page</option>
        </select>
        <small>Type of proxy configuration</small>
      </div>

      ${showDomains ? `
        <div class="wizard-form-group full-width">
          <label>Domain Names <span class="required">*</span></label>
          <input type="text" id="wizardDomains" value="${escapeHtml(state.settings.domains)}" placeholder="example.com, www.example.com" required>
          <small>Comma-separated list of domains</small>
          <span class="error">At least one domain is required</span>
        </div>
      ` : ''}

      ${showForward ? `
        <div class="wizard-form-group">
          <label>Forward Scheme</label>
          <select id="wizardForwardScheme">
            <option value="http" ${state.settings.forward_scheme === 'http' ? 'selected' : ''}>HTTP</option>
            <option value="https" ${state.settings.forward_scheme === 'https' ? 'selected' : ''}>HTTPS</option>
          </select>
          <small>Backend server protocol</small>
        </div>

        <div class="wizard-form-group">
          <label>Forward Host <span class="required">*</span></label>
          <input type="text" id="wizardForwardHost" value="${escapeHtml(state.settings.forward_host)}" placeholder="localhost or 192.168.1.100" required>
          <small>Backend server hostname or IP</small>
          <span class="error">Forward host is required</span>
        </div>

        <div class="wizard-form-group">
          <label>Forward Port <span class="required">*</span></label>
          <input type="number" id="wizardForwardPort" value="${state.settings.forward_port}" placeholder="8080" min="1" max="65535" required>
          <small>Backend server port (1-65535)</small>
          <span class="error">Valid port is required (1-65535)</span>
        </div>
      ` : ''}

      ${showPorts ? `
        <div class="wizard-form-group">
          <label>Listen Port <span class="required">*</span></label>
          <input type="number" id="wizardListenPort" value="${state.settings.listen_port}" placeholder="80" min="1" max="65535" required>
          <small>Port to listen on (1-65535)</small>
          <span class="error">Valid port is required</span>
        </div>

        <div class="wizard-form-group">
          <label>Target Port <span class="required">*</span></label>
          <input type="number" id="wizardTargetPort" value="${state.settings.target_port}" placeholder="443" min="1" max="65535" required>
          <small>Port to forward to (1-65535)</small>
          <span class="error">Valid port is required</span>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Step 3: SSL Configuration
 */
function createStep3SSLConfiguration(state) {
  const sslEnabled = state.settings.ssl_enabled;
  const disableSSL = state.settings.type === 'stream';

  return `
    <h2 class="wizard-step-title">SSL/TLS Configuration</h2>
    <p class="wizard-step-description">Configure SSL certificate for encrypted connections.${disableSSL ? ' (Not available for stream proxies)' : ''}</p>

    <div class="wizard-toggle-section">
      <div class="wizard-toggle-header">
        <span class="wizard-toggle-label">Enable SSL/TLS</span>
        <label class="toggle-switch">
          <input type="checkbox" id="wizardSSLEnabled" ${sslEnabled ? 'checked' : ''} ${disableSSL ? 'disabled' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      ${sslEnabled && !disableSSL ? `
        <div class="wizard-toggle-content">
          <div class="wizard-form-group">
            <label>SSL Certificate ${sslEnabled ? '<span class="required">*</span>' : ''}</label>
            <select id="wizardCertificate" ${sslEnabled ? 'required' : ''}>
              <option value="">Select a certificate...</option>
              ${state.certificates.map(cert => `
                <option value="${cert.id}" ${state.settings.certificate_id === cert.id ? 'selected' : ''}>
                  ${escapeHtml(cert.name)} (${escapeHtml(cert.domain_names)})
                </option>
              `).join('')}
            </select>
            <small>Choose an SSL certificate for HTTPS</small>
            ${state.certificates.length === 0 ? '<small style="color: #ef4444;">No certificates available. Create one in the Certificates section first.</small>' : ''}
            <span class="error">Certificate is required when SSL is enabled</span>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Step 4: Module Selection
 */
function createStep4ModuleSelection(state) {
  const modules = state.availableModules || {};
  const tags = Object.keys(modules).sort();
  const selectedModuleNames = state.selectedModules.map(m => m.name);

  // Auto-enabled modules when SSL is on
  const autoEnabledModules = state.settings.ssl_enabled ? ['Force HTTPS', 'HTTP/2'] : [];

  return `
    <h2 class="wizard-step-title">Select Modules</h2>
    <p class="wizard-step-description">Choose nginx modules and features to include in your configuration. Some modules are auto-enabled based on your settings.</p>

    <div class="module-categories">
      ${tags.length === 0 ? '<p>No modules available</p>' : ''}
      ${tags.map((tag, index) => {
        const tagModules = modules[tag] || [];
        const isExpanded = index === 0;

        return `
          <div class="module-category ${isExpanded ? 'expanded' : ''}" data-category="${escapeHtml(tag)}">
            <div class="module-category-header">
              <div class="module-category-title">
                <span class="module-category-icon">▶</span>
                ${escapeHtml(tag)}
              </div>
              <span class="module-category-count">${tagModules.length}</span>
            </div>
            <div class="module-category-content">
              ${tagModules.map(module => {
                const isAutoEnabled = autoEnabledModules.includes(module.name);
                const isChecked = isAutoEnabled || selectedModuleNames.includes(module.name);

                return `
                  <div class="module-checkbox-item">
                    <input
                      type="checkbox"
                      id="module-${module.id}"
                      data-module-id="${module.id}"
                      data-module-name="${escapeHtml(module.name)}"
                      ${isChecked ? 'checked' : ''}
                      ${isAutoEnabled ? 'disabled' : ''}
                    >
                    <div class="module-info">
                      <div class="module-name">
                        ${escapeHtml(module.name)}
                        ${module.level ? `<span class="module-level-badge">${module.level}</span>` : ''}
                      </div>
                      ${module.description ? `<div class="module-description">${escapeHtml(module.description)}</div>` : ''}
                      ${isAutoEnabled ? '<div class="module-auto-enabled">Auto-enabled with SSL</div>' : ''}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Step 5: Advanced Options
 */
function createStep5AdvancedOptions(state) {
  return `
    <h2 class="wizard-step-title">Advanced Options</h2>
    <p class="wizard-step-description">Optional advanced settings for your proxy configuration.</p>

    <div class="wizard-form-grid">
      <div class="wizard-form-group">
        <label>WAF Profile</label>
        <select id="wizardWAFProfile">
          <option value="">None (No WAF protection)</option>
          ${state.wafProfiles.map(profile => `
            <option value="${profile.id}" ${state.advanced.waf_profile_id === profile.id ? 'selected' : ''}>
              ${escapeHtml(profile.name)} - Paranoia ${profile.paranoia_level} ${profile.enabled ? '' : '(Disabled)'}
            </option>
          `).join('')}
        </select>
        <small>ModSecurity/OWASP CRS protection profile</small>
      </div>

      <div class="wizard-form-group">
        <label>Launch URL</label>
        <input type="text" id="wizardLaunchURL" value="${escapeHtml(state.advanced.launch_url)}" placeholder="https://example.com">
        <small>Optional URL to open when clicking "View" button</small>
      </div>

      <div class="wizard-form-group full-width">
        <label>Custom Nginx Directives</label>
        <textarea id="wizardCustomDirectives" rows="6" placeholder="# Add custom nginx directives here...">${escapeHtml(state.advanced.custom_directives)}</textarea>
        <small>Advanced: Add custom nginx directives only (e.g., proxy_buffer_size, client_max_body_size). Do NOT include server blocks here.</small>
      </div>
    </div>
  `;
}

/**
 * Step 6: Config Preview
 */
function createStep6Preview(state, generatedConfig = '') {
  const tags = [];
  if (state.settings.ssl_enabled) tags.push('<span class="preview-highlight-tag ssl">SSL/TLS Enabled</span>');
  if (state.selectedModules.length > 0) tags.push(`<span class="preview-highlight-tag modules">${state.selectedModules.length} Modules</span>`);
  if (state.advanced.waf_profile_id) tags.push('<span class="preview-highlight-tag waf">WAF Protected</span>');

  return `
    <h2 class="wizard-step-title">Review & Apply Template</h2>
    <p class="wizard-step-description">Review your generated configuration and apply it to the editor.</p>

    <div class="config-preview-container">
      ${tags.length > 0 ? `<div class="preview-tags">${tags.join('')}</div>` : ''}

      <textarea id="wizardPreviewConfig" class="config-preview-editor" readonly>${escapeHtml(generatedConfig)}</textarea>

      <div class="preview-actions" style="margin-top: 16px;">
        <button class="wizard-btn wizard-btn-primary" id="wizardUseTemplate">
          Use This Template
        </button>
        <small style="color: #6b7280; margin-left: 12px;">This will replace the current configuration in the editor</small>
      </div>
    </div>
  `;
}

/**
 * Setup wizard event handlers
 */
function setupWizardHandlers(state, currentConfig, onComplete) {
  const wizard = document.getElementById('templateWizard');
  if (!wizard) return;

  const nextBtn = wizard.querySelector('#wizardNext');
  const backBtn = wizard.querySelector('#wizardBack');
  const cancelBtn = wizard.querySelector('#wizardCancel');
  const closeBtn = wizard.querySelector('#closeWizard');

  // Close wizard
  const closeWizard = () => {
    wizard.remove();
  };

  closeBtn.addEventListener('click', closeWizard);
  cancelBtn.addEventListener('click', closeWizard);

  // Close on overlay click
  wizard.addEventListener('click', (e) => {
    if (e.target.id === 'templateWizard') {
      closeWizard();
    }
  });

  // Step 1: Recipe selection
  wizard.querySelectorAll('.recipe-card').forEach(card => {
    card.addEventListener('click', () => {
      // Update state
      const recipeId = card.dataset.recipeId;
      state.recipe = RECIPE_DEFINITIONS[recipeId];

      // Apply recipe defaults
      if (state.recipe && state.recipe.id !== 'custom') {
        state.settings.type = state.recipe.type;
        state.settings.ssl_enabled = state.recipe.ssl;
        state.settings.forward_scheme = state.recipe.settings.forward_scheme;
        state.settings.forward_host = state.recipe.settings.forward_host;
        state.settings.forward_port = state.recipe.settings.forward_port;

        // Pre-select modules
        state.selectedModules = [];
        state.recipe.modules.forEach(moduleName => {
          // Find module by name
          for (const tag in state.availableModules) {
            const found = state.availableModules[tag].find(m => m.name === moduleName);
            if (found) {
              state.selectedModules.push(found);
            }
          }
        });
      }

      // Update UI
      wizard.querySelectorAll('.recipe-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  // Navigation
  nextBtn.addEventListener('click', () => handleWizardNext(wizard, state, currentConfig, onComplete));
  backBtn.addEventListener('click', () => handleWizardBack(wizard, state));
}

/**
 * Handle wizard next button
 */
async function handleWizardNext(wizard, state, currentConfig, onComplete) {
  // Validate current step
  if (!validateWizardStep(wizard, state)) {
    return;
  }

  // Collect data from current step
  collectStepData(wizard, state);

  // Move to next step
  if (state.currentStep < state.totalSteps) {
    state.currentStep++;
    await updateWizardUI(wizard, state, currentConfig, onComplete);
  }
}

/**
 * Handle wizard back button
 */
async function handleWizardBack(wizard, state) {
  if (state.currentStep > 1) {
    state.currentStep--;
    await updateWizardUI(wizard, state);
  }
}

/**
 * Validate current wizard step
 */
function validateWizardStep(wizard, state) {
  // Clear previous errors
  wizard.querySelectorAll('.wizard-form-group').forEach(group => {
    group.classList.remove('has-error');
  });

  switch (state.currentStep) {
    case 1: // Recipe selection
      if (!state.recipe) {
        showError('Please select a configuration recipe');
        return false;
      }
      return true;

    case 2: // Basic settings
      let isValid = true;

      // Name required
      const name = wizard.querySelector('#wizardName')?.value.trim();
      if (!name) {
        wizard.querySelector('#wizardName')?.closest('.wizard-form-group')?.classList.add('has-error');
        isValid = false;
      }

      // Domains required for reverse/404
      if (state.settings.type === 'reverse' || state.settings.type === '404') {
        const domains = wizard.querySelector('#wizardDomains')?.value.trim();
        if (!domains) {
          wizard.querySelector('#wizardDomains')?.closest('.wizard-form-group')?.classList.add('has-error');
          isValid = false;
        }
      }

      // Forward host/port required for reverse
      if (state.settings.type === 'reverse') {
        const host = wizard.querySelector('#wizardForwardHost')?.value.trim();
        const port = wizard.querySelector('#wizardForwardPort')?.value;

        if (!host) {
          wizard.querySelector('#wizardForwardHost')?.closest('.wizard-form-group')?.classList.add('has-error');
          isValid = false;
        }

        if (!port || port < 1 || port > 65535) {
          wizard.querySelector('#wizardForwardPort')?.closest('.wizard-form-group')?.classList.add('has-error');
          isValid = false;
        }
      }

      return isValid;

    case 3: // SSL configuration
      if (state.settings.ssl_enabled && state.settings.type !== 'stream') {
        const certId = wizard.querySelector('#wizardCertificate')?.value;
        if (!certId) {
          wizard.querySelector('#wizardCertificate')?.closest('.wizard-form-group')?.classList.add('has-error');
          showError('Please select an SSL certificate');
          return false;
        }
      }
      return true;

    case 4: // Module selection (optional)
    case 5: // Advanced options (optional)
      return true;

    case 6: // Preview
      return true;

    default:
      return true;
  }
}

/**
 * Collect data from current step
 */
function collectStepData(wizard, state) {
  switch (state.currentStep) {
    case 1:
      // Recipe already collected in click handler
      break;

    case 2:
      // Basic settings
      state.settings.name = wizard.querySelector('#wizardName')?.value.trim() || '';
      state.settings.type = wizard.querySelector('#wizardType')?.value || 'reverse';
      state.settings.domains = wizard.querySelector('#wizardDomains')?.value.trim() || '';
      state.settings.forward_scheme = wizard.querySelector('#wizardForwardScheme')?.value || 'http';
      state.settings.forward_host = wizard.querySelector('#wizardForwardHost')?.value.trim() || '';
      state.settings.forward_port = wizard.querySelector('#wizardForwardPort')?.value || '';
      state.settings.listen_port = wizard.querySelector('#wizardListenPort')?.value || 80;
      state.settings.target_port = wizard.querySelector('#wizardTargetPort')?.value || 443;
      break;

    case 3:
      // SSL configuration
      const sslEnabledCheckbox = wizard.querySelector('#wizardSSLEnabled');
      state.settings.ssl_enabled = sslEnabledCheckbox?.checked || false;
      state.settings.certificate_id = wizard.querySelector('#wizardCertificate')?.value || null;
      break;

    case 4:
      // Module selection
      state.selectedModules = [];
      wizard.querySelectorAll('.module-checkbox-item input[type="checkbox"]:checked:not(:disabled)').forEach(checkbox => {
        const moduleId = checkbox.dataset.moduleId;
        const moduleName = checkbox.dataset.moduleName;

        // Find full module data
        for (const tag in state.availableModules) {
          const found = state.availableModules[tag].find(m => m.id == moduleId);
          if (found) {
            state.selectedModules.push(found);
            break;
          }
        }
      });
      break;

    case 5:
      // Advanced options
      state.advanced.waf_profile_id = wizard.querySelector('#wizardWAFProfile')?.value || null;
      state.advanced.launch_url = wizard.querySelector('#wizardLaunchURL')?.value.trim() || '';
      state.advanced.custom_directives = wizard.querySelector('#wizardCustomDirectives')?.value.trim() || '';
      break;
  }
}

/**
 * Update wizard UI for current step
 */
async function updateWizardUI(wizard, state, currentConfig, onComplete) {
  const contentDiv = wizard.querySelector('#wizardStepContent');
  const nextBtn = wizard.querySelector('#wizardNext');
  const backBtn = wizard.querySelector('#wizardBack');

  // Update progress indicators
  wizard.querySelectorAll('.wizard-step-indicator').forEach((indicator, index) => {
    const stepNum = index + 1;
    indicator.classList.remove('active', 'completed');

    if (stepNum === state.currentStep) {
      indicator.classList.add('active');
    } else if (stepNum < state.currentStep) {
      indicator.classList.add('completed');
    }
  });

  // Update button states
  backBtn.disabled = state.currentStep === 1;

  // Update content and button text
  let newContent = '';

  switch (state.currentStep) {
    case 1:
      newContent = createStep1RecipeSelection(state);
      nextBtn.textContent = 'Next';
      break;
    case 2:
      newContent = createStep2BasicSettings(state);
      nextBtn.textContent = 'Next';
      break;
    case 3:
      newContent = createStep3SSLConfiguration(state);
      nextBtn.textContent = 'Next';

      // Setup SSL toggle handler
      setTimeout(() => {
        const sslToggle = wizard.querySelector('#wizardSSLEnabled');
        if (sslToggle) {
          sslToggle.addEventListener('change', () => {
            state.settings.ssl_enabled = sslToggle.checked;
            updateWizardUI(wizard, state, currentConfig, onComplete);
          });
        }
      }, 0);
      break;
    case 4:
      newContent = createStep4ModuleSelection(state);
      nextBtn.textContent = 'Next';

      // Setup module category expand/collapse
      setTimeout(() => {
        wizard.querySelectorAll('.module-category-header').forEach(header => {
          header.addEventListener('click', () => {
            const category = header.closest('.module-category');
            category.classList.toggle('expanded');
          });
        });
      }, 0);
      break;
    case 5:
      newContent = createStep5AdvancedOptions(state);
      nextBtn.textContent = 'Next';
      break;
    case 6:
      // Generate config preview
      const generatedConfig = await generateConfigPreview(state);
      newContent = createStep6Preview(state, generatedConfig);
      nextBtn.style.display = 'none';

      // Setup "Use Template" button
      setTimeout(() => {
        const useTemplateBtn = wizard.querySelector('#wizardUseTemplate');
        if (useTemplateBtn) {
          useTemplateBtn.addEventListener('click', () => {
            // Check if current config has content
            if (currentConfig && currentConfig.trim().length > 50) {
              showConfirmDialog(
                'Replace Current Configuration?',
                'This will replace your current configuration in the editor. This action cannot be undone. Are you sure you want to continue?',
                () => {
                  // User confirmed
                  wizard.remove();
                  onComplete({
                    config: generatedConfig,
                    name: state.settings.name,
                    launchUrl: state.advanced.launch_url,
                    wafProfileId: state.advanced.waf_profile_id
                  });
                }
              );
            } else {
              // No content, just apply
              wizard.remove();
              onComplete({
                config: generatedConfig,
                name: state.settings.name,
                launchUrl: state.advanced.launch_url,
                wafProfileId: state.advanced.waf_profile_id
              });
            }
          });
        }
      }, 0);
      break;
  }

  contentDiv.innerHTML = newContent;

  // Re-setup recipe click handlers for step 1
  if (state.currentStep === 1) {
    setTimeout(() => {
      wizard.querySelectorAll('.recipe-card').forEach(card => {
        card.addEventListener('click', () => {
          const recipeId = card.dataset.recipeId;
          state.recipe = RECIPE_DEFINITIONS[recipeId];

          // Apply recipe defaults
          if (state.recipe && state.recipe.id !== 'custom') {
            state.settings.type = state.recipe.type;
            state.settings.ssl_enabled = state.recipe.ssl;
            state.settings.forward_scheme = state.recipe.settings.forward_scheme;
            state.settings.forward_host = state.recipe.settings.forward_host;
            state.settings.forward_port = state.recipe.settings.forward_port;

            // Pre-select modules
            state.selectedModules = [];
            state.recipe.modules.forEach(moduleName => {
              for (const tag in state.availableModules) {
                const found = state.availableModules[tag].find(m => m.name === moduleName);
                if (found) {
                  state.selectedModules.push(found);
                }
              }
            });
          }

          wizard.querySelectorAll('.recipe-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
        });
      });
    }, 0);
  }
}

/**
 * Generate config preview
 */
async function generateConfigPreview(state) {
  try {
    // Call template API
    const templateResponse = await api.request('/api/config/template', {
      method: 'POST',
      body: {
        type: state.settings.type,
        name: state.settings.name,
        options: {
          ssl_enabled: state.settings.ssl_enabled
        }
      }
    });

    let config = templateResponse.config;

    // Replace placeholders based on type
    if (state.settings.type === 'reverse' || state.settings.type === '404') {
      // Replace domains - use exact user-entered domains only (no automatic www)
      const userDomains = state.settings.domains.trim();

      // Replace the entire "example.com www.example.com" pattern with just user domains
      // This handles the template's default pattern: "server_name example.com www.example.com;"
      config = config.replace(/server_name\s+example\.com\s+www\.example\.com;/g, `server_name ${userDomains};`);

      // Also handle single example.com (in case template format changes)
      config = config.replace(/server_name\s+example\.com;/g, `server_name ${userDomains};`);

      // Replace backend for reverse proxy
      if (state.settings.type === 'reverse') {
        const backendUrl = `${state.settings.forward_scheme}://${state.settings.forward_host}:${state.settings.forward_port}`;
        config = config.replace(/http:\/\/localhost:8080/g, backendUrl);
        config = config.replace(/proxy_pass [^;]+;/g, `proxy_pass ${backendUrl};`);
      }
    }

    // Apply certificate if SSL enabled
    if (state.settings.ssl_enabled && state.settings.certificate_id) {
      const cert = state.certificates.find(c => c.id == state.settings.certificate_id);
      if (cert) {
        config = config.replace(/ssl_certificate\s+.*;/g, `ssl_certificate ${cert.cert_path};`);
        config = config.replace(/ssl_certificate_key\s+.*;/g, `ssl_certificate_key ${cert.key_path};`);
      }
    }

    // Add WAF configuration if profile is selected
    if (state.advanced.waf_profile_id && state.wafProfiles && state.wafProfiles.length > 0) {
      const wafProfile = state.wafProfiles.find(p => p.id == state.advanced.waf_profile_id);
      if (wafProfile) {
        // Generate WAF directives
        const config_data = wafProfile.config_json ? JSON.parse(wafProfile.config_json) : {};
        const ruleEngineMode = config_data.rule_engine_mode || 'DetectionOnly';

        let wafConfig = `\n  # ═════════════════════════════════════════════════════\n`;
        wafConfig += `  # WAF Protection: ${wafProfile.name}\n`;
        wafConfig += `  # Paranoia Level: ${wafProfile.paranoia_level}\n`;
        wafConfig += `  # Rule Engine Mode: ${ruleEngineMode}\n`;
        wafConfig += `  # ═════════════════════════════════════════════════════\n\n`;
        wafConfig += `  modsecurity on;\n`;
        wafConfig += `  modsecurity_rules_file /nginx-proxy-orchestra/data/modsec-profiles/exclusions_profile_${wafProfile.id}.conf;\n`;
        wafConfig += `  modsecurity_rules_file /etc/nginx/modsec/main.conf;\n`;
        wafConfig += `  modsecurity_rules_file /nginx-proxy-orchestra/data/modsec-profiles/profile_${wafProfile.id}.conf;\n`;
        wafConfig += `\n`;

        // Insert WAF config in HTTPS server block (after SSL config, before ACME/locations)
        // WAF should be in the main HTTPS server block, not HTTP redirect
        const lines = config.split('\n');
        let inHttpsServer = false;
        let foundSSLCipherLine = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Detect HTTPS server block by listen 443
          if (line.includes('listen 443 ssl') || line.includes('listen 443 quic')) {
            inHttpsServer = true;
          }

          // Insert WAF config after SSL configuration (after ssl_prefer_server_ciphers line)
          // This ensures it's in HTTPS block and before ACME/location blocks
          if (inHttpsServer && !foundSSLCipherLine && line.includes('ssl_prefer_server_ciphers')) {
            lines[i] = line + wafConfig;
            foundSSLCipherLine = true;
            break;
          }
        }

        // If no ssl_prefer_server_ciphers found, try after server_name in HTTPS block
        if (!foundSSLCipherLine) {
          inHttpsServer = false;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.includes('listen 443 ssl') || line.includes('listen 443 quic')) {
              inHttpsServer = true;
            }

            if (inHttpsServer && line.match(/server_name\s+[^;]+;/)) {
              lines[i] = line + wafConfig;
              break;
            }
          }
        }

        config = lines.join('\n');
      }
    }

    // Insert selected modules - ONLY in HTTPS server block (listen 443)
    if (state.selectedModules.length > 0) {
      const serverModules = state.selectedModules.filter(m => m.level === 'server');
      const locationModules = state.selectedModules.filter(m => m.level === 'location');
      const redirectModules = state.selectedModules.filter(m => m.level === 'redirect');

      // Check if HTTP/3 (QUIC) module is enabled - need to add QUIC listeners
      const hasHTTP3 = state.selectedModules.some(m => m.name === 'HTTP/3 (QUIC)');
      if (hasHTTP3 && state.settings.ssl_enabled) {
        // Replace listen 443 ssl with QUIC-enabled listeners in HTTPS server block
        // Find the HTTPS server block (not the HTTP redirect block)
        const lines = config.split('\n');
        let inHttpsServer = false;
        let foundFirstSSLListener = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Detect HTTPS server block by finding "listen 443 ssl"
          if (line.match(/listen\s+443\s+ssl/) && !foundFirstSSLListener) {
            inHttpsServer = true;
            foundFirstSSLListener = true;
          }

          // Replace the listen directives in HTTPS server block
          if (inHttpsServer) {
            if (line.match(/^\s*listen\s+443\s+ssl;$/)) {
              lines[i] = '    listen 443 quic;\n    listen 443 ssl;';
            } else if (line.match(/^\s*listen\s+\[::\]:443\s+ssl;$/)) {
              lines[i] = '    listen [::]:443 quic;\n    listen [::]:443 ssl;';
              inHttpsServer = false; // Done with HTTPS server block listeners
            }
          }
        }

        config = lines.join('\n');
      }

      // Insert server-level modules in HTTPS server block only (after listen 443 and server_name)
      // Use include directives instead of inline content
      if (serverModules.length > 0) {
        const serverModuleIncludes = serverModules.map(m => {
          // Sanitize module name for filename (lowercase, replace non-alphanumeric with hyphens)
          const sanitizedName = m.name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 100);
          // Use absolute path from environment or default location
          const modulePath = `/nginx-proxy-orchestra/data/modules/${sanitizedName}.conf`;
          return `    # Module: ${m.name}\n    include ${modulePath};`;
        }).join('\n');

        // Target HTTPS server block specifically (listen 443)
        config = config.replace(/(listen\s+443\s+ssl[^;]*;[\s\S]*?server_name[^;]+;)/,
          `$1\n\n${serverModuleIncludes}\n`);
      }

      // Check if Real IP module is selected - need to remove default proxy headers to avoid duplicates
      const hasRealIP = state.selectedModules.some(m => m.name === 'Real IP');
      if (hasRealIP) {
        // Remove default proxy headers that will be duplicated by Real IP module
        const lines = config.split('\n');
        const filteredLines = lines.filter(line => {
          // Remove default X-Real-IP, X-Forwarded-For, X-Forwarded-Proto headers in location blocks
          // But keep them in the template comments
          if (line.includes('proxy_set_header') &&
              (line.includes('X-Real-IP') ||
               line.includes('X-Forwarded-For') ||
               line.includes('X-Forwarded-Proto')) &&
              !line.trim().startsWith('#')) {
            // Only remove if it's the default value, not custom
            if (line.includes('$remote_addr') ||
                line.includes('$proxy_add_x_forwarded_for') ||
                line.includes('$scheme')) {
              return false;
            }
          }
          return true;
        });
        config = filteredLines.join('\n');
      }

      // Insert location-level modules in HTTPS server block only
      // Use include directives instead of inline content
      // Note: redirect modules are NOT inserted here - they generate separate server blocks
      if (locationModules.length > 0) {
        const locationModuleIncludes = locationModules.map(m => {
          // Sanitize module name for filename (lowercase, replace non-alphanumeric with hyphens)
          const sanitizedName = m.name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 100);
          // Use absolute path from environment or default location
          const modulePath = `/nginx-proxy-orchestra/data/modules/${sanitizedName}.conf`;
          return `        # Module: ${m.name}\n        include ${modulePath};`;
        }).join('\n');

        // Find the HTTPS server block by searching for "listen 443 ssl"
        // Then find the location / block within it
        const lines = config.split('\n');
        let inHttpsServer = false;
        let braceDepth = 0;
        let httpsServerStart = -1;
        let foundLocationSlash = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Detect start of HTTPS server block
          if (line.includes('listen 443 ssl')) {
            inHttpsServer = true;
            // Find the server { line before this
            for (let j = i - 1; j >= 0; j--) {
              if (lines[j].match(/^\s*server\s*\{/)) {
                httpsServerStart = j;
                braceDepth = 1;
                break;
              }
            }
          }

          // If we're in the HTTPS server block, look for location /
          if (inHttpsServer && httpsServerStart >= 0) {
            // Track brace depth
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;
            braceDepth += openBraces - closeBraces;

            // Found location / block - insert module includes after the opening brace
            if (line.match(/location\s+\/\s*\{/) && !foundLocationSlash) {
              lines[i] = line + '\n' + locationModuleIncludes;
              foundLocationSlash = true;
              break;
            }

            // Exit HTTPS server block when braces close
            if (braceDepth === 0) {
              inHttpsServer = false;
            }
          }
        }

        config = lines.join('\n');
      }

      // Add custom directives in HTTPS server block only
      if (state.advanced.custom_directives && state.advanced.custom_directives.trim()) {
        const lines = config.split('\n');
        let inHttpsServer = false;
        let braceDepth = 0;
        let httpsServerStart = -1;
        let foundLocationSlash = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Detect start of HTTPS server block
          if (line.includes('listen 443 ssl')) {
            inHttpsServer = true;
            // Find the server { line before this
            for (let j = i - 1; j >= 0; j--) {
              if (lines[j].match(/^\s*server\s*\{/)) {
                httpsServerStart = j;
                braceDepth = 1;
                break;
              }
            }
          }

          // If we're in the HTTPS server block, look for location /
          if (inHttpsServer && httpsServerStart >= 0) {
            // Track brace depth
            const openBraces = (line.match(/\{/g) || []).length;
            const closeBraces = (line.match(/\}/g) || []).length;
            braceDepth += openBraces - closeBraces;

            // Found location / block - insert custom directives after the opening brace
            if (line.match(/location\s+\/\s*\{/) && !foundLocationSlash) {
              const customDirectivesFormatted = state.advanced.custom_directives
                .split('\n')
                .map(l => `        ${l}`)
                .join('\n');
              lines[i] = line + '\n        # Custom directives\n' + customDirectivesFormatted;
              foundLocationSlash = true;
              break;
            }

            // Exit HTTPS server block when braces close
            if (braceDepth === 0) {
              inHttpsServer = false;
            }
          }
        }

        config = lines.join('\n');
      }
    }

    return config;

  } catch (error) {
    console.error('Error generating config:', error);
    return '# Error generating configuration\n# Please try again or contact support';
  }
}

/**
 * Show confirmation dialog
 */
function showConfirmDialog(title, message, onConfirm) {
  const dialogHTML = `
    <div class="confirm-dialog-overlay" id="confirmDialog">
      <div class="confirm-dialog">
        <div class="confirm-dialog-header">
          <h3 class="confirm-dialog-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            ${escapeHtml(title)}
          </h3>
        </div>
        <div class="confirm-dialog-body">
          <p class="confirm-dialog-message">${escapeHtml(message)}</p>
        </div>
        <div class="confirm-dialog-footer">
          <button class="wizard-btn wizard-btn-secondary" id="confirmDialogCancel">Cancel</button>
          <button class="wizard-btn wizard-btn-primary" id="confirmDialogConfirm">Yes, Replace</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', dialogHTML);

  const dialog = document.getElementById('confirmDialog');
  const cancelBtn = dialog.querySelector('#confirmDialogCancel');
  const confirmBtn = dialog.querySelector('#confirmDialogConfirm');

  const closeDialog = () => dialog.remove();

  cancelBtn.addEventListener('click', closeDialog);
  confirmBtn.addEventListener('click', () => {
    closeDialog();
    onConfirm();
  });

  // Close on overlay click
  dialog.addEventListener('click', (e) => {
    if (e.target.id === 'confirmDialog') {
      closeDialog();
    }
  });
}

