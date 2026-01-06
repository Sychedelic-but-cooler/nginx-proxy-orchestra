import api from '../api.js';
import { showLoading, hideLoading, showError } from '../app.js';
import { escapeHtml } from '../utils/sanitize.js';

export async function renderDashboard(container) {
  showLoading();

  try {
    const [stats, trafficStats] = await Promise.all([
      api.getDashboardStats(),
      api.getStatistics('24h')
    ]);
    
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
          <div class="stat-label">TLS Certificates</div>
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

      <!-- Traffic Statistics -->
      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h3 class="card-title">Traffic Statistics (Last 24 Hours)</h3>
        </div>
        <div class="grid grid-4" style="padding: 20px; gap: 20px;">
          <div class="stat-card" style="background: var(--card-bg); border: 1px solid var(--border-color);">
            <div class="stat-value">${trafficStats.totalRequests.toLocaleString()}</div>
            <div class="stat-label">Total Requests</div>
          </div>
          <div class="stat-card" style="background: var(--card-bg); border: 1px solid var(--border-color);">
            <div class="stat-value">${trafficStats.uniqueVisitors.toLocaleString()}</div>
            <div class="stat-label">Unique Visitors</div>
          </div>
          <div class="stat-card" style="background: var(--card-bg); border: 1px solid var(--border-color);">
            <div class="stat-value text-warning">${trafficStats.errors4xx.toLocaleString()}</div>
            <div class="stat-label">4XX Errors (${trafficStats.errorRate4xx}%)</div>
          </div>
          <div class="stat-card" style="background: var(--card-bg); border: 1px solid var(--border-color);">
            <div class="stat-value text-danger">${trafficStats.errors5xx.toLocaleString()}</div>
            <div class="stat-label">5XX Errors (${trafficStats.errorRate5xx}%)</div>
          </div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top: 20px;">
        <!-- Top Hosts -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Top Hosts by Traffic</h3>
          </div>
          ${trafficStats.topHosts.length > 0 ? `
            <table class="table">
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Requests</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                ${trafficStats.topHosts.map(host => {
                  const percentage = ((host.count / trafficStats.totalRequests) * 100).toFixed(1);
                  return `
                    <tr>
                      <td><strong>${escapeHtml(host.host)}</strong></td>
                      <td>${host.count.toLocaleString()}</td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <div style="flex: 1; height: 8px; background: var(--border-color); border-radius: 4px; overflow: hidden;">
                            <div style="width: ${percentage}%; height: 100%; background: var(--primary-color);"></div>
                          </div>
                          <span style="min-width: 45px; text-align: right;">${percentage}%</span>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          ` : '<p style="padding: 16px; color: var(--text-secondary);">No traffic data available</p>'}
        </div>

        <!-- Top IPs -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Top Connecting IPs</h3>
          </div>
          ${trafficStats.topIPs.length > 0 ? `
            <table class="table">
              <thead>
                <tr>
                  <th>IP Address</th>
                  <th>Requests</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                ${trafficStats.topIPs.map(ipData => {
                  const errorData = trafficStats.topErrorIPs.find(e => e.ip === ipData.ip);
                  const errorCount = errorData ? errorData.count : 0;
                  return `
                    <tr>
                      <td><code>${escapeHtml(ipData.ip)}</code></td>
                      <td>${ipData.count.toLocaleString()}</td>
                      <td>
                        ${errorCount > 0
                          ? `<span class="badge badge-warning">${errorCount}</span>`
                          : '<span class="badge badge-success">0</span>'}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          ` : '<p style="padding: 16px; color: var(--text-secondary);">No traffic data available</p>'}
        </div>
      </div>

      <!-- Requests by Hour Chart -->
      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h3 class="card-title">Requests by Hour (24h)</h3>
        </div>
        <div style="padding: 20px;">
          ${trafficStats.totalRequests > 0 ? renderHourlyChart(trafficStats.requestsByHour) : '<p style="color: var(--text-secondary);">No traffic data available</p>'}
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

/**
 * Render a simple hourly bar chart
 */
function renderHourlyChart(requestsByHour) {
  const maxRequests = Math.max(...requestsByHour, 1);
  const currentHour = new Date().getHours();

  return `
    <div style="display: flex; align-items: flex-end; gap: 4px; height: 200px; padding: 10px; background: var(--card-bg); border-radius: 4px;">
      ${requestsByHour.map((count, hour) => {
        const heightPercent = (count / maxRequests) * 100;
        const isCurrentHour = hour === currentHour;
        return `
          <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;">
            <div style="width: 100%; height: ${heightPercent}%; background: ${isCurrentHour ? 'var(--primary-color)' : 'var(--secondary-color)'}; border-radius: 2px 2px 0 0; min-height: 2px; position: relative;" title="${count.toLocaleString()} requests at ${hour}:00">
              ${count > 0 ? `<span style="position: absolute; top: -20px; left: 50%; transform: translateX(-50%); font-size: 10px; white-space: nowrap;">${count}</span>` : ''}
            </div>
            <div style="font-size: 10px; color: var(--text-secondary); ${isCurrentHour ? 'font-weight: bold; color: var(--primary-color);' : ''}">${hour}</div>
          </div>
        `;
      }).join('')}
    </div>
    <div style="margin-top: 10px; text-align: center; font-size: 12px; color: var(--text-secondary);">
      Hour of Day (0-23) · Current hour highlighted
    </div>
  `;
}
