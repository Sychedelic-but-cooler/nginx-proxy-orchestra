import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess } from '../app.js';
import state from '../state.js';

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
                <th>SSL</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${proxies.map(proxy => `
                <tr>
                  <td><strong>${proxy.name}</strong></td>
                  <td><span class="badge badge-info">${proxy.type}</span></td>
                  <td>${proxy.domain_names}</td>
                  <td>${proxy.forward_scheme}://${proxy.forward_host}:${proxy.forward_port}</td>
                  <td>
                    ${proxy.ssl_enabled ? 
                      `<span class="badge badge-success">✓ ${proxy.ssl_cert_name || 'Enabled'}</span>` : 
                      '<span class="badge badge-danger">✗</span>'}
                  </td>
                  <td>
                    <span class="badge ${proxy.enabled ? 'badge-success' : 'badge-danger'}">
                      ${proxy.enabled ? 'Active' : 'Disabled'}
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
              `).join('')}
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
      <div class="modal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>${id ? 'Edit' : 'Add'} Proxy Host</h3>
          </div>
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
              <label for="sslEnabled">Enable SSL</label>
            </div>

            <div class="form-group" id="sslCertGroup" style="${proxy?.ssl_enabled ? '' : 'display: none;'}">
              <label for="sslCert">SSL Certificate</label>
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
              <button type="submit" class="btn btn-primary">Save</button>
            </div>
          </form>
        </div>
      </div>
    `;

    // SSL checkbox handler
    document.getElementById('sslEnabled').addEventListener('change', (e) => {
      document.getElementById('sslCertGroup').style.display = e.target.checked ? 'block' : 'none';
    });

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

      showLoading();
      try {
        if (id) {
          await api.updateProxy(id, data);
          showSuccess('Proxy updated successfully');
        } else {
          await api.createProxy(data);
          showSuccess('Proxy created successfully');
        }
        modal.innerHTML = '';
        await renderProxies(document.getElementById('mainContent'));
      } catch (error) {
        hideLoading();
        showError(error.message);
      }
    });

    // Cancel button
    document.getElementById('cancelBtn').addEventListener('click', () => {
      modal.innerHTML = '';
    });

    hideLoading();
  } catch (error) {
    hideLoading();
    showError(error.message);
  }
}
