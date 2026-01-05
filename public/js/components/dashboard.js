import api from '../api.js';
import { showLoading, hideLoading, showError } from '../app.js';

export async function renderDashboard(container) {
  showLoading();
  
  try {
    const stats = await api.getDashboardStats();
    
    container.innerHTML = `
      <div class="grid grid-4">
        <div class="stat-card">
          <div class="stat-value">${stats.proxies.active}</div>
          <div class="stat-label">Active Proxies</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.proxies.total}</div>
          <div class="stat-label">Total Proxies</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.certificates.total}</div>
          <div class="stat-label">SSL Certificates</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${stats.nginx.running ? 'text-success' : 'text-danger'}">
            ${stats.nginx.running ? '✓' : '✗'}
          </div>
          <div class="stat-label">Nginx Status</div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top: 20px;">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Nginx Information</h3>
          </div>
          <table class="table">
            <tr>
              <td><strong>Version:</strong></td>
              <td>${stats.nginx.version}</td>
            </tr>
            <tr>
              <td><strong>Status:</strong></td>
              <td>
                <span class="badge ${stats.nginx.running ? 'badge-success' : 'badge-danger'}">
                  ${stats.nginx.running ? 'Running' : 'Stopped'}
                </span>
              </td>
            </tr>
          </table>
          <div style="margin-top: 16px;">
            <button id="testNginxBtn" class="btn btn-secondary btn-sm">Test Config</button>
            <button id="reloadNginxBtn" class="btn btn-primary btn-sm">Reload Nginx</button>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Expiring Certificates</h3>
          </div>
          ${stats.certificates.expiring.length > 0 ? `
            <table class="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Expires</th>
                  <th>Days Left</th>
                </tr>
              </thead>
              <tbody>
                ${stats.certificates.expiring.map(cert => {
                  const rowClass = cert.urgency === 'critical' ? 'cert-critical' : 
                                   cert.urgency === 'warning' ? 'cert-warning' : '';
                  return `
                    <tr class="${rowClass}">
                      <td><strong>${cert.name}</strong></td>
                      <td>${new Date(cert.expires_at).toLocaleDateString()}</td>
                      <td>
                        <span class="badge ${cert.urgency === 'critical' ? 'badge-danger' : 
                                            cert.urgency === 'warning' ? 'badge-warning' : 
                                            'badge-success'}">
                          ${cert.daysUntilExpiry} day${cert.daysUntilExpiry !== 1 ? 's' : ''}
                        </span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          ` : '<p style="padding: 16px; color: var(--text-secondary);">No certificates expiring soon</p>'}
        </div>
      </div>

      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h3 class="card-title">Recent Activity</h3>
        </div>
        ${stats.recentActivity.length > 0 ? `
          <table class="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              ${stats.recentActivity.map(activity => `
                <tr>
                  <td>${activity.username || 'System'}</td>
                  <td>${activity.action}</td>
                  <td>${activity.resource_type}</td>
                  <td>${new Date(activity.created_at).toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p style="color: var(--text-secondary);">No recent activity</p>'}
      </div>
    `;

    // Event listeners
    document.getElementById('testNginxBtn')?.addEventListener('click', async () => {
      showLoading();
      try {
        const result = await api.testNginx();
        hideLoading();
        alert(result.success ? 'Configuration test passed!' : `Configuration test failed:\n${result.error}`);
      } catch (error) {
        hideLoading();
        showError(error.message);
      }
    });

    document.getElementById('reloadNginxBtn')?.addEventListener('click', async () => {
      if (!confirm('Reload nginx configuration?')) return;
      
      showLoading();
      try {
        const result = await api.reloadNginx();
        hideLoading();
        alert(result.success ? 'Nginx reloaded successfully!' : `Reload failed:\n${result.error}`);
      } catch (error) {
        hideLoading();
        showError(error.message);
      }
    });

  } catch (error) {
    showError(error.message);
    container.innerHTML = '<div class="empty-state"><h2>Failed to load dashboard</h2></div>';
  } finally {
    hideLoading();
  }
}
