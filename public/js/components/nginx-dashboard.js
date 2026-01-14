import api from '../api.js';
import { showLoading, hideLoading, showError, setHeader } from '../app.js';

export async function renderNginxDashboard(container) {
  setHeader('Nginx Dashboard');
  showLoading();

  try {
    const [nginxStatus, stubStatus, stats] = await Promise.all([
      api.getNginxStatus(),
      api.getStubStatus().catch(() => ({ success: false, configured: false })),
      api.getNginxStatistics(24)
    ]);

    container.innerHTML = `
      <!-- Nginx Status Header -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header" style="background: #1e293b; color: white;">
          <h3 class="card-title" style="color: white; display: flex; align-items: center; gap: 12px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              ${nginxStatus.running ? '<path d="M9 12l2 2 4-4"></path>' : '<path d="M15 9l-6 6M9 9l6 6"></path>'}
            </svg>
            Nginx ${nginxStatus.running ? 'Running' : 'Stopped'}
            <span style="margin-left: auto; font-size: 14px; font-weight: normal; opacity: 0.9;">
              Version ${nginxStatus.version}
            </span>
          </h3>
        </div>
        <div style="padding: 20px;">
          <div class="grid grid-3">
            <div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">Status</div>
              <div style="font-size: 18px; font-weight: 600; color: ${nginxStatus.running ? '#1e293b' : '#dc2626'};">
                ${nginxStatus.running ? 'Active' : 'Inactive'}
              </div>
            </div>
            <div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">Version</div>
              <div style="font-size: 18px; font-weight: 600;">${nginxStatus.version}</div>
            </div>
            <div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">Loaded Modules</div>
              <div style="font-size: 18px; font-weight: 600;">
                ${nginxStatus.modules.dynamic.length + nginxStatus.modules.builtin.length}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Real-Time Performance (if available) -->
      ${stubStatus.success && stubStatus.configured ? renderStubStatusQuickView(stubStatus) : renderStubStatusDisabled()}

      <!-- 24-Hour Statistics -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <h3 class="card-title">24-Hour Performance Summary</h3>
        </div>
        <div style="padding: 20px;">
          <div class="grid grid-4">
            <div class="stat-card">
              <div class="stat-value" style="color: #1e293b;">${stats.totalRequests.toLocaleString()}</div>
              <div class="stat-label">Total Requests</div>
              <small style="color: var(--text-secondary); display: block; margin-top: 8px;">
                ${stats.metrics.avgRequestsPerHour}/hour avg
              </small>
            </div>
            <div class="stat-card">
              <div class="stat-value" style="color: #1e293b;">${stats.successRate}%</div>
              <div class="stat-label">Success Rate</div>
              <small style="color: var(--text-secondary); display: block; margin-top: 8px;">
                ${stats.successfulRequests.toLocaleString()} successful
              </small>
            </div>
            <div class="stat-card">
              <div class="stat-value" style="color: #dc2626;">${stats.blockedPercentage}%</div>
              <div class="stat-label">Block Rate</div>
              <small style="color: var(--text-secondary); display: block; margin-top: 8px;">
                ${stats.blockedRequests.toLocaleString()} blocked
              </small>
            </div>
            <div class="stat-card">
              <div class="stat-value" style="color: #475569;">${stats.rateLimitedPercentage}%</div>
              <div class="stat-label">Rate Limited</div>
              <small style="color: var(--text-secondary); display: block; margin-top: 8px;">
                ${stats.rateLimitedRequests.toLocaleString()} limited
              </small>
            </div>
          </div>
        </div>
      </div>

      <!-- Loaded Modules -->
      <div class="grid grid-2" style="margin-bottom: 20px;">
        <!-- Dynamic Modules -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Dynamic Modules (${nginxStatus.modules.dynamic.length})</h3>
          </div>
          ${nginxStatus.modules.dynamic.length > 0 ? `
            <table class="table">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>File</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                ${nginxStatus.modules.dynamic.map(mod => `
                  <tr>
                    <td style="font-weight: 500;">${mod.name}</td>
                    <td><code style="font-size: 12px;">${mod.file}</code></td>
                    <td>${mod.size ? mod.size + ' KB' : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p style="padding: 16px; color: var(--text-secondary);">No dynamic modules loaded</p>'}
        </div>

        <!-- Built-in Modules -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Built-in Modules (${nginxStatus.modules.builtin.length})</h3>
          </div>
          ${nginxStatus.modules.builtin.length > 0 ? `
            <div style="padding: 16px;">
              <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                ${nginxStatus.modules.builtin.map(mod => `
                  <span style="padding: 6px 12px; background: var(--bg-color); border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px; font-weight: 500;">
                    ${mod.name}
                  </span>
                `).join('')}
              </div>
            </div>
          ` : '<p style="padding: 16px; color: var(--text-secondary);">No built-in modules detected</p>'}
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Quick Actions</h3>
        </div>
        <div style="padding: 20px; display: flex; gap: 12px; flex-wrap: wrap;">
          <button class="btn btn-primary" id="testConfigBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <path d="M9 11l3 3L22 4"></path>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>
            Test Configuration
          </button>
          <button class="btn btn-secondary" id="reloadNginxBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Reload Nginx
          </button>
          <button class="btn btn-secondary" id="viewTrafficBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
            View Traffic & Performance
          </button>
          <button class="btn btn-secondary" id="manageModulesBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="3" x2="9" y2="21"></line>
            </svg>
            Manage Modules
          </button>
        </div>
      </div>
    `;

    setupNginxDashboardHandlers();

  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>Failed to load nginx dashboard</h2>
        <p style="color: var(--text-secondary);">${error.message}</p>
      </div>
    `;
    showError(error.message);
  } finally {
    hideLoading();
  }
}

function renderStubStatusQuickView(stubStatus) {
  const data = stubStatus.data;
  return `
    <div class="card" style="margin-bottom: 20px;">
      <div class="card-header" style="background: #1e293b; color: white;">
        <h3 class="card-title" style="color: white;">Real-Time Performance</h3>
      </div>
      <div style="padding: 20px;">
        <div class="grid grid-4">
          <div style="text-align: center; padding: 16px; background: var(--bg-color); border-radius: 8px;">
            <div style="font-size: 36px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">${data.active}</div>
            <div style="font-size: 14px; font-weight: 600;">Active Connections</div>
          </div>
          <div style="text-align: center; padding: 16px; background: var(--bg-color); border-radius: 8px;">
            <div style="font-size: 36px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">${data.requestsPerConnection}</div>
            <div style="font-size: 14px; font-weight: 600;">Requests/Connection</div>
          </div>
          <div style="text-align: center; padding: 16px; background: var(--bg-color); border-radius: 8px;">
            <div style="font-size: 36px; font-weight: 700; color: #475569; margin-bottom: 8px;">${data.reading + data.writing}</div>
            <div style="font-size: 14px; font-weight: 600;">Active Processing</div>
          </div>
          <div style="text-align: center; padding: 16px; background: var(--bg-color); border-radius: 8px;">
            <div style="font-size: 36px; font-weight: 700; color: ${data.handledPercentage === '100.00' ? '#1e293b' : '#dc2626'}; margin-bottom: 8px;">${data.handledPercentage}%</div>
            <div style="font-size: 14px; font-weight: 600;">Handled</div>
          </div>
        </div>
        <div style="margin-top: 16px; text-align: center;">
          <a href="#/security/statistics" class="btn btn-primary" style="text-decoration: none;">
            View Detailed Performance →
          </a>
        </div>
      </div>
    </div>
  `;
}

function renderStubStatusDisabled() {
  return `
    <div class="card" style="margin-bottom: 20px; border: 1px solid #cbd5e1;">
      <div class="card-header" style="background: #f1f5f9;">
        <h3 class="card-title" style="color: #1e293b;">⚡ Real-Time Performance Monitoring</h3>
      </div>
      <div style="padding: 20px;">
        <p style="margin: 0 0 12px 0; color: var(--text-secondary);">
          Enable nginx <code>stub_status</code> module to see real-time connection and performance metrics.
        </p>
        <a href="#/security/statistics" class="btn btn-primary" style="text-decoration: none;">
          Set Up Real-Time Monitoring →
        </a>
      </div>
    </div>
  `;
}

function setupNginxDashboardHandlers() {
  document.getElementById('testConfigBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('testConfigBtn');
    btn.disabled = true;
    btn.innerHTML = 'Testing...';
    
    try {
      const result = await api.testNginx();
      if (result.success) {
        alert('✓ Configuration test passed!\n\n' + result.output);
      } else {
        alert('✗ Configuration test failed!\n\n' + (result.error || result.output));
      }
    } catch (error) {
      alert('Error testing configuration: ' + error.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
          <path d="M9 11l3 3L22 4"></path>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
        </svg>
        Test Configuration
      `;
    }
  });

  document.getElementById('reloadNginxBtn')?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to reload nginx?')) return;
    
    const btn = document.getElementById('reloadNginxBtn');
    btn.disabled = true;
    btn.innerHTML = 'Reloading...';
    
    try {
      const result = await api.reloadNginx();
      alert('✓ Nginx reloaded successfully!');
    } catch (error) {
      alert('Error reloading nginx: ' + error.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
          <polyline points="23 4 23 10 17 10"></polyline>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
        </svg>
        Reload Nginx
      `;
    }
  });

  document.getElementById('viewTrafficBtn')?.addEventListener('click', () => {
    window.location.hash = '#/security/statistics';
  });

  document.getElementById('manageModulesBtn')?.addEventListener('click', () => {
    window.location.hash = '#/modules';
  });
}
