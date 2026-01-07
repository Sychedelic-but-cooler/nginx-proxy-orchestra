import api from '../api.js';
import { showLoading, hideLoading, showError, setHeader } from '../app.js';

export async function renderSecurityDashboard(container, tab = 'nginx') {
  if (tab === 'nginx') {
    setHeader('Nginx Security');
    container.innerHTML = `
      <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
        <strong>ℹ️ Nginx Security:</strong> Monitor and manage security features that protect your proxy hosts from threats.
      </div>
      <div id="nginxSecurityContent">Loading...</div>
    `;
    await renderNginxSecurityContent();
  } else if (tab === 'waf') {
    setHeader('WAF Dashboard');
    container.innerHTML = `
      <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
        <strong>ℹ️ WAF Dashboard:</strong> Web Application Firewall features coming soon.
      </div>
      <div class="empty-state">
        <h2>WAF Dashboard Coming Soon</h2>
        <p>Web Application Firewall features will be available in a future update.</p>
        <p style="color: var(--text-secondary); margin-top: 12px;">
          This dashboard will display advanced threat analytics, rule triggers, and attack patterns
          when ModSecurity integration is completed.
        </p>
      </div>
    `;
  }
}

async function renderNginxSecurityContent() {
  const container = document.getElementById('nginxSecurityContent');
  showLoading();

  try {
    const stats = await api.getSecurityStats('24h');

    container.innerHTML = `
      <!-- Active Security Rules Summary -->
      <div class="grid grid-4">
        <div class="stat-card" style="background: var(--card-bg); border: 1px solid var(--border-color);">
          <div class="stat-value" style="color: var(--danger-color);">${stats.activeRules.ipBlacklist}</div>
          <div class="stat-label">IP Blacklist Rules</div>
        </div>
        <div class="stat-card" style="background: var(--card-bg); border: 1px solid var(--border-color);">
          <div class="stat-value" style="color: var(--warning-color);">${stats.activeRules.rateLimit}</div>
          <div class="stat-label">Rate Limits Active</div>
        </div>
        <div class="stat-card" style="background: var(--card-bg); border: 1px solid var(--border-color);">
          <div class="stat-value" style="color: var(--warning-color);">${stats.activeRules.geoBlock}</div>
          <div class="stat-label">Geo-Block Rules</div>
        </div>
        <div class="stat-card" style="background: var(--card-bg); border: 1px solid var(--border-color);">
          <div class="stat-value" style="color: var(--warning-color);">${stats.activeRules.userAgentFilter}</div>
          <div class="stat-label">User-Agent Filters</div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="card" style="margin-top: 20px;">
        <div class="card-header">
          <h3 class="card-title">Quick Actions</h3>
        </div>
        <div style="padding: 20px; display: flex; gap: 12px; flex-wrap: wrap;">
          <button class="btn btn-primary" id="goToSettingsBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M12 1v6m0 6v6m5.66-14.66l-4.23 4.23m0 5.66l4.23 4.23M1 12h6m6 0h6M3.34 3.34l4.23 4.23m5.66 0l4.23-4.23M3.34 20.66l4.23-4.23m5.66 0l4.23 4.23"></path>
            </svg>
            Security Settings
          </button>
          <button class="btn btn-secondary" id="blockIPBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
            </svg>
            Block an IP
          </button>
          <button class="btn btn-secondary" id="rateLimitProxyBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            Add Rate Limit
          </button>
        </div>
      </div>

      <!-- Security Info Cards -->
      <div class="grid grid-2" style="margin-top: 20px;">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">IP Blacklist</h3>
          </div>
          <div style="padding: 20px;">
            <p style="color: var(--text-secondary); margin-bottom: 16px;">
              Block specific IP addresses or ranges from accessing any of your proxy hosts.
              ${stats.activeRules.ipBlacklist > 0
                ? `You currently have <strong>${stats.activeRules.ipBlacklist}</strong> IP(s) blacklisted.`
                : 'No IPs are currently blacklisted.'}
            </p>
            <p style="color: var(--text-secondary); font-size: 14px; margin-top: 12px;">
              <strong>Tip:</strong> You can block single IPs (192.168.1.100) or entire ranges (10.0.0.0/8).
            </p>
            <button class="btn btn-sm btn-primary goto-settings" style="margin-top: 12px;">
              Manage IP Blacklist
            </button>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Rate Limiting</h3>
          </div>
          <div style="padding: 20px;">
            <p style="color: var(--text-secondary); margin-bottom: 16px;">
              Control how many requests per second/minute a client can make to each proxy host.
              ${stats.activeRules.rateLimit > 0
                ? `You have rate limits configured for <strong>${stats.activeRules.rateLimit}</strong> host(s).`
                : 'No rate limits are currently configured.'}
            </p>
            <p style="color: var(--text-secondary); font-size: 14px; margin-top: 12px;">
              <strong>Tip:</strong> Rate limiting helps prevent abuse and DoS attacks by limiting request frequency.
            </p>
            <button class="btn btn-sm btn-primary goto-proxies" style="margin-top: 12px;">
              Configure Rate Limits
            </button>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Geo-Blocking</h3>
          </div>
          <div style="padding: 20px;">
            <p style="color: var(--text-secondary); margin-bottom: 16px;">
              Block or allow traffic from specific countries. Useful for compliance or security requirements.
              ${stats.activeRules.geoBlock > 0
                ? `You have <strong>${stats.activeRules.geoBlock}</strong> country rule(s) configured.`
                : 'Geo-blocking is not currently configured.'}
            </p>
            <p style="color: var(--text-secondary); font-size: 14px; margin-top: 12px;">
              <strong>Note:</strong> Requires GeoIP module to be installed on your server.
            </p>
            <button class="btn btn-sm btn-primary goto-settings" style="margin-top: 12px;">
              Configure Geo-Blocking
            </button>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">User-Agent Filtering</h3>
          </div>
          <div style="padding: 20px;">
            <p style="color: var(--text-secondary); margin-bottom: 16px;">
              Block specific bots and crawlers by their user-agent string. Protect against scrapers and bad bots.
              ${stats.activeRules.userAgentFilter > 0
                ? `You have <strong>${stats.activeRules.userAgentFilter}</strong> user-agent filter(s) active.`
                : 'No user-agent filters are currently configured.'}
            </p>
            <p style="color: var(--text-secondary); font-size: 14px; margin-top: 12px;">
              <strong>Tip:</strong> Use wildcards to match multiple variants (e.g., "BadBot*").
            </p>
            <button class="btn btn-sm btn-primary goto-settings" style="margin-top: 12px;">
              Configure User-Agent Filters
            </button>
          </div>
        </div>
      </div>
    `;

    // Quick action event listeners
    document.getElementById('goToSettingsBtn')?.addEventListener('click', () => {
      window.location.hash = '#/settings';
    });

    document.getElementById('blockIPBtn')?.addEventListener('click', showQuickBlockIPModal);

    document.getElementById('rateLimitProxyBtn')?.addEventListener('click', () => {
      window.location.hash = '#/proxies';
      alert('Select a proxy host and use the "Edit" button to configure rate limiting.');
    });

    // Settings navigation buttons
    document.querySelectorAll('.goto-settings').forEach(btn => {
      btn.addEventListener('click', () => {
        window.location.hash = '#/settings';
      });
    });

    // Proxies navigation buttons
    document.querySelectorAll('.goto-proxies').forEach(btn => {
      btn.addEventListener('click', () => {
        window.location.hash = '#/proxies';
      });
    });

  } catch (error) {
    container.innerHTML = '<div class="empty-state"><h2>Failed to load security dashboard</h2></div>';
    showError(error.message);
  } finally {
    hideLoading();
  }
}

function showQuickBlockIPModal() {
  const modal = document.getElementById('modalContainer');
  modal.innerHTML = `
    <div class="modal-overlay" id="blockIPModal">
      <div class="modal">
        <div class="modal-header">
          <h3>Quick Block IP Address</h3>
          <button class="modal-close" id="closeBlockIPModal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="blockIPForm">
            <div class="form-group">
              <label for="ipAddress">IP Address or Range *</label>
              <input type="text" id="ipAddress" required placeholder="e.g., 192.168.1.100 or 10.0.0.0/8">
              <small>Enter a single IP address or CIDR notation for a range</small>
            </div>

            <div class="form-group">
              <label for="ipDescription">Reason (optional)</label>
              <input type="text" id="ipDescription" placeholder="e.g., Suspicious activity detected">
              <small>Help yourself remember why you blocked this IP</small>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="cancelBlockBtn">Cancel</button>
              <button type="submit" class="btn btn-danger">Block IP</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  // Close button handlers
  const closeModal = () => {
    document.getElementById('blockIPModal')?.remove();
  };

  document.getElementById('closeBlockIPModal').addEventListener('click', closeModal);
  document.getElementById('cancelBlockBtn').addEventListener('click', closeModal);

  // Click outside to close
  document.getElementById('blockIPModal').addEventListener('click', (e) => {
    if (e.target.id === 'blockIPModal') {
      closeModal();
    }
  });

  // Form submit handler
  document.getElementById('blockIPForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const ipAddress = document.getElementById('ipAddress').value.trim();
    const description = document.getElementById('ipDescription').value.trim();

    showLoading();
    try {
      await api.createSecurityRule({
        rule_type: 'ip_blacklist',
        rule_value: ipAddress,
        action: 'deny',
        description: description || null,
        enabled: 1
      });

      closeModal();
      hideLoading();
      alert(`Successfully blocked IP: ${ipAddress}`);

      // Reload the security dashboard
      await renderNginxSecurityContent();
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  });
}
