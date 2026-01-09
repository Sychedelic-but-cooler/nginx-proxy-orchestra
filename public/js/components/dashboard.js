import api from '../api.js';
import { showLoading, hideLoading, showError } from '../app.js';
import { escapeHtml } from '../utils/sanitize.js';

export async function renderDashboard(container) {
  showLoading();

  try {
    const [stats, quickMetrics, wafStats, banStats] = await Promise.all([
      api.getDashboardStats(),
      api.getStatistics('24h'),
      api.getWAFStats(24).catch(() => ({ totalEvents: 0, blockedEvents: 0, profileCount: 0, enabled: false })),
      api.getBanStats().catch(() => ({ totalBans: 0, activeBans: 0, integrationCount: 0 }))
    ]);

    container.innerHTML = `
      <!-- Status Cards -->
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
          <div class="stat-label">TLS Certificates</div>
        </div>
        <div class="stat-card">
          <div class="stat-value ${stats.nginx.running ? 'text-success' : 'text-danger'}">
            ${stats.nginx.running ? '✓' : '✗'}
          </div>
          <div class="stat-label">Nginx Status</div>
        </div>
      </div>

      <!-- WAF & Ban System Status -->
      <div class="grid grid-2" style="margin-top: 20px;">
        <div class="stat-card" style="background: var(--card-bg); border: 2px solid ${wafStats.enabled ? 'var(--success-color)' : 'var(--border-color)'};">
          <div class="stat-value ${wafStats.enabled ? 'text-success' : 'text-muted'}">
            ${wafStats.enabled ? '✓' : '○'}
          </div>
          <div class="stat-label">WAF ${wafStats.enabled ? 'Enabled' : 'Disabled'}</div>
          <div style="font-size: 0.85em; color: var(--text-secondary); margin-top: 8px;">
            ${wafStats.profileCount || 0} profile${wafStats.profileCount !== 1 ? 's' : ''} active
          </div>
        </div>
        <div class="stat-card" style="background: var(--card-bg); border: 2px solid var(--border-color);">
          <div class="stat-value">${banStats.activeBans || 0}</div>
          <div class="stat-label">Active IP Bans</div>
          <div style="font-size: 0.85em; color: var(--text-secondary); margin-top: 8px;">
            ${banStats.integrationCount || 0} integration${banStats.integrationCount !== 1 ? 's' : ''} configured
          </div>
        </div>
      </div>

      <!-- Quick Metrics (24h) -->
      <div class="grid grid-3" style="margin-top: 20px;">
        <div class="stat-card" style="background: var(--card-bg); border: 1px solid var(--border-color);">
          <div class="stat-value">${(quickMetrics.totalRequests || 0).toLocaleString()}</div>
          <div class="stat-label">Total Requests (24h)</div>
        </div>
        <div class="stat-card" style="background: var(--card-bg); border: 1px solid var(--border-color);">
          <div class="stat-value text-danger">${(quickMetrics.statusCategories ? quickMetrics.statusCategories['4xx'] + quickMetrics.statusCategories['5xx'] : 0).toLocaleString()}</div>
          <div class="stat-label">Blocked/Errors (${quickMetrics.errorRate || '0.00'}%)</div>
        </div>
        <div class="stat-card" style="background: var(--card-bg); border: 1px solid var(--border-color);">
          <div class="stat-value text-success">${quickMetrics.successRate || '0.00'}%</div>
          <div class="stat-label">Success Rate (24h)</div>
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
            ${stats.nginx.modules && (stats.nginx.modules.dynamic.length > 0 || stats.nginx.modules.builtin.length > 0) ? `
              <tr>
                <td colspan="2" style="padding-top: 16px;">
                  <strong>Loaded Modules:</strong>
                  <div style="margin-top: 8px;">
                    ${stats.nginx.modules.dynamic.length > 0 ? `
                      <div style="margin-bottom: 12px;">
                        <div style="font-size: 0.9em; color: var(--text-secondary); margin-bottom: 4px;">Dynamic Modules:</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                          ${stats.nginx.modules.dynamic.map(mod => `
                            <span class="badge badge-primary" style="font-size: 0.85em;" title="${mod.file}${mod.size ? ' (' + mod.size + ' KB)' : ''}">
                              ${escapeHtml(mod.name)}
                            </span>
                          `).join('')}
                        </div>
                      </div>
                    ` : ''}
                    ${stats.nginx.modules.builtin.length > 0 ? `
                      <div>
                        <div style="font-size: 0.9em; color: var(--text-secondary); margin-bottom: 4px;">Built-in Modules:</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                          ${stats.nginx.modules.builtin.map(mod => `
                            <span class="badge" style="background: var(--border-color); color: var(--text-primary); font-size: 0.85em;">
                              ${escapeHtml(mod.name)}
                            </span>
                          `).join('')}
                        </div>
                      </div>
                    ` : ''}
                  </div>
                </td>
              </tr>
            ` : ''}
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
                      <td><strong>${escapeHtml(cert.name)}</strong></td>
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
