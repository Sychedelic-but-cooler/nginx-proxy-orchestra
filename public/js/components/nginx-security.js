import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess, setHeader } from '../app.js';

export async function renderNginxSecurity(container, excludePrivate = true) {
  setHeader('Nginx Security');
  showLoading();

  try {
    const [stats, securityRules] = await Promise.all([
      api.getNginxTuningStats(24, excludePrivate),
      api.getSecurityRules().catch(() => ({ rules: [] }))
    ]);

    // Count active security rules by type
    const ruleCounts = {
      ipBlacklist: securityRules.rules?.filter(r => r.rule_type === 'ip_blacklist' && r.enabled === 1).length || 0,
      geoBlock: securityRules.rules?.filter(r => r.rule_type === 'geo_block' && r.enabled === 1).length || 0,
      userAgentFilter: securityRules.rules?.filter(r => r.rule_type === 'user_agent_filter' && r.enabled === 1).length || 0
    };

    const rateLimits = await api.getRateLimits().catch(() => ({ rateLimits: [] }));
    const rateLimitCount = rateLimits.rateLimits?.filter(r => r.enabled === 1).length || 0;

    container.innerHTML = `
      <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
        <strong>ℹ️ Security Rule Management:</strong> Analyze traffic patterns and configure security rules to block suspicious IPs, user agents, or countries.
        <br><small style="color: var(--text-secondary);">Showing data from the last 24 hours</small>
      </div>

      <!-- Security Metrics -->
      <div class="grid grid-3" style="margin-bottom: 30px;">
        <div class="stat-card">
          <div class="stat-value" style="color: var(--primary-color);">${stats.totalRequests.toLocaleString()}</div>
          <div class="stat-label">Total Requests (24h)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: var(--danger-color);">${stats.blockedRequests.toLocaleString()}</div>
          <div class="stat-label">Blocked Requests</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: var(--warning-color);">${stats.rateLimitedRequests.toLocaleString()}</div>
          <div class="stat-label">Rate Limited</div>
        </div>
      </div>

      <!-- Active Security Rules Summary -->
      <div class="card" style="margin-bottom: 30px;">
        <div class="card-header">
          <h3 class="card-title">Active Security Rules</h3>
        </div>
        <div class="grid grid-4" style="padding: 20px; gap: 16px;">
          <div style="text-align: center; padding: 16px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 4px;">
            <div style="font-size: 32px; font-weight: bold; color: var(--primary-color);">${ruleCounts.ipBlacklist}</div>
            <div style="font-size: 14px; color: var(--text-secondary); margin-top: 8px;">IP Blacklist Rules</div>
            <a href="#/security/rules" style="font-size: 12px; margin-top: 8px; display: inline-block;">Manage →</a>
          </div>
          <div style="text-align: center; padding: 16px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 4px;">
            <div style="font-size: 32px; font-weight: bold; color: var(--primary-color);">${ruleCounts.geoBlock}</div>
            <div style="font-size: 14px; color: var(--text-secondary); margin-top: 8px;">Geo-Block Rules</div>
            <a href="#/security/rules" style="font-size: 12px; margin-top: 8px; display: inline-block;">Manage →</a>
          </div>
          <div style="text-align: center; padding: 16px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 4px;">
            <div style="font-size: 32px; font-weight: bold; color: var(--primary-color);">${ruleCounts.userAgentFilter}</div>
            <div style="font-size: 14px; color: var(--text-secondary); margin-top: 8px;">User-Agent Filters</div>
            <a href="#/security/rules" style="font-size: 12px; margin-top: 8px; display: inline-block;">Manage →</a>
          </div>
          <div style="text-align: center; padding: 16px; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 4px;">
            <div style="font-size: 32px; font-weight: bold; color: var(--primary-color);">${rateLimitCount}</div>
            <div style="font-size: 14px; color: var(--text-secondary); margin-top: 8px;">Rate Limits</div>
            <a href="#/security/rate-limit" style="font-size: 12px; margin-top: 8px; display: inline-block;">Manage →</a>
          </div>
        </div>
      </div>

      <!-- Threat Analysis Section -->
      <h3 style="margin: 30px 0 20px 0; padding: 10px 0; border-bottom: 2px solid var(--border-color);">Threat Analysis (Last 24h)</h3>

      <!-- Top 10 IPs -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header" style="display: flex; align-items: center; flex-wrap: wrap; gap: 12px;">
          <h3 class="card-title" style="margin: 0;">Top 10 IP Addresses</h3>
          <span class="badge badge-info">${stats.uniqueIPCount} unique IPs</span>
          <label style="display: flex; align-items: center; cursor: pointer; user-select: none; margin-left: auto;">
            <input type="checkbox" id="excludePrivateCheckbox" ${excludePrivate ? 'checked' : ''} style="margin-right: 6px;">
            <span style="font-size: 13px;">Exclude Private IPs</span>
            <span style="color: var(--text-secondary); font-size: 12px; margin-left: 6px;">
              (10.x, 172.16-31.x, 192.168.x, 127.x)
            </span>
          </label>
        </div>
        <div style="padding: 20px;">
          ${stats.topIPs.length > 0 ? `
            <table class="table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>IP Address</th>
                  <th>Requests</th>
                  <th>% of Total</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${stats.topIPs.map((ip, index) => {
                  const percentage = ((ip.count / stats.totalRequests) * 100).toFixed(2);
                  return `
                    <tr>
                      <td><strong>${index + 1}</strong></td>
                      <td><code>${ip.item}</code></td>
                      <td>${ip.count.toLocaleString()}</td>
                      <td>${percentage}%</td>
                      <td>
                        ${ip.isBlocked ? `
                          <span class="badge badge-danger">Already Blocked</span>
                        ` : `
                          <button class="btn btn-sm btn-danger block-ip-btn" data-ip="${ip.item}">
                            🚫 Block IP
                          </button>
                        `}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          ` : '<p style="color: var(--text-secondary);">No data available. Check nginx access logs.</p>'}
        </div>
      </div>

      <!-- Top 10 User Agents -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <h3 class="card-title">Top 10 User Agents</h3>
          <span class="badge badge-info">${stats.topUserAgents.length} unique agents</span>
        </div>
        <div style="padding: 20px;">
          ${stats.topUserAgents.length > 0 ? `
            <table class="table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>User Agent</th>
                  <th>Requests</th>
                  <th>% of Total</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${stats.topUserAgents.map((ua, index) => {
                  const percentage = ((ua.count / stats.totalRequests) * 100).toFixed(2);
                  const shortUA = ua.item.length > 80 ? ua.item.substring(0, 80) + '...' : ua.item;
                  return `
                    <tr>
                      <td><strong>${index + 1}</strong></td>
                      <td><code style="font-size: 12px;" title="${ua.item}">${shortUA}</code></td>
                      <td>${ua.count.toLocaleString()}</td>
                      <td>${percentage}%</td>
                      <td>
                        ${ua.isBlocked ? `
                          <span class="badge badge-danger">Already Blocked</span>
                        ` : `
                          <button class="btn btn-sm btn-danger block-ua-btn" data-ua="${escapeHtml(ua.item)}">
                            🚫 Block Agent
                          </button>
                        `}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          ` : '<p style="color: var(--text-secondary);">No data available. Check nginx access logs.</p>'}
        </div>
      </div>

      <!-- Top 10 Countries -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <h3 class="card-title">Top 10 Countries</h3>
          <span class="badge badge-info">${stats.topCountries.length} countries</span>
        </div>
        <div style="padding: 20px;">
          ${stats.topCountries.length > 0 ? `
            <table class="table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Country</th>
                  <th>Code</th>
                  <th>Requests</th>
                  <th>% of Total</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${stats.topCountries.map((country, index) => {
                  const percentage = ((country.count / stats.totalRequests) * 100).toFixed(2);
                  return `
                    <tr>
                      <td><strong>${index + 1}</strong></td>
                      <td>${country.countryName || 'Unknown'}</td>
                      <td><code>${country.country}</code></td>
                      <td>${country.count.toLocaleString()}</td>
                      <td>${percentage}%</td>
                      <td>
                        ${country.isBlocked ? `
                          <span class="badge badge-danger">Already Blocked</span>
                        ` : `
                          <button class="btn btn-sm btn-danger block-country-btn" data-code="${country.country}" data-name="${country.countryName || country.country}">
                            🚫 Block Country
                          </button>
                        `}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          ` : `
            <div class="info-banner" style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; border-radius: 4px;">
              <strong>⚠️ GeoIP Not Available:</strong> Country-level statistics require the nginx GeoIP module.
              <br><small>Install <code>nginx-mod-http-geoip</code> to enable geo-blocking features.</small>
            </div>
          `}
        </div>
      </div>
    `;

    setupTuningHandlers(excludePrivate);

  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>Failed to load tuning statistics</h2>
        <p style="color: var(--text-secondary);">${error.message}</p>
        <p style="color: var(--text-secondary); margin-top: 12px;">Make sure nginx access logs are available at <code>/var/log/nginx/access.log</code></p>
      </div>
    `;
    showError(error.message);
  } finally {
    hideLoading();
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setupTuningHandlers(excludePrivate) {
  // Checkbox change handler
  document.getElementById('excludePrivateCheckbox')?.addEventListener('change', async (e) => {
    const newValue = e.target.checked;
    await renderNginxSecurity(document.getElementById('mainContent'), newValue);
  });

  // Block IP buttons
  document.querySelectorAll('.block-ip-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ip = btn.dataset.ip;

      if (!confirm(`Block IP address ${ip}?\n\nThis will add it to the IP blacklist and block all future requests from this address.`)) {
        return;
      }

      showLoading();
      try {
        await api.createSecurityRule({
          rule_type: 'ip_blacklist',
          rule_value: ip,
          action: 'deny',
          description: `Blocked from Nginx Tuning dashboard`,
          enabled: 1
        });

        hideLoading();
        showSuccess(`Successfully blocked IP: ${ip}`);

        // Reload the tuning page
        await renderNginxSecurity(document.getElementById('mainContent'), excludePrivate);
      } catch (error) {
        hideLoading();
        showError(error.message);
      }
    });
  });

  // Block User Agent buttons
  document.querySelectorAll('.block-ua-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ua = btn.dataset.ua;

      if (!confirm(`Block this user agent?\n\n${ua}\n\nThis will block all requests with this exact user agent string.`)) {
        return;
      }

      showLoading();
      try {
        // Don't escape - store the original user agent for regex matching
        await api.createSecurityRule({
          rule_type: 'user_agent_filter',
          rule_value: ua,
          action: 'deny',
          description: `Blocked from Nginx Tuning dashboard`,
          enabled: 1
        });

        hideLoading();
        showSuccess(`Successfully blocked user agent`);

        // Reload the tuning page
        await renderNginxSecurity(document.getElementById('mainContent'), excludePrivate);
      } catch (error) {
        hideLoading();
        showError(error.message);
      }
    });
  });

  // Block Country buttons
  document.querySelectorAll('.block-country-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.code;
      const name = btn.dataset.name;

      if (!confirm(`Block all traffic from ${name} (${code})?\n\nThis will add ${code} to the geo-blocking list.`)) {
        return;
      }

      showLoading();
      try {
        await api.createSecurityRule({
          rule_type: 'geo_block',
          rule_value: code,
          action: 'deny',
          description: `${name} - Blocked from Nginx Tuning dashboard`,
          enabled: 1
        });

        hideLoading();
        showSuccess(`Successfully blocked country: ${name} (${code})`);

        // Reload the tuning page
        await renderNginxSecurity(document.getElementById('mainContent'), excludePrivate);
      } catch (error) {
        hideLoading();
        showError(error.message);
      }
    });
  });
}
