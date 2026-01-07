import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess, setHeader } from '../app.js';

export async function renderNginxTuning(container, excludePrivate = true) {
  setHeader('Nginx Tuning');
  showLoading();

  try {
    const stats = await api.getNginxTuningStats(24, excludePrivate);

    container.innerHTML = `
      <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
        <strong>ℹ️ Nginx Tuning:</strong> Analyze traffic patterns and take action to block suspicious IPs, user agents, or countries.
        <br><small style="color: var(--text-secondary);">Showing data from the last 24 hours</small>
      </div>

      <!-- Summary Stats -->
      <div class="grid grid-3" style="margin-bottom: 30px;">
        <div class="stat-card">
          <div class="stat-value" style="color: var(--primary-color);">${stats.totalRequests.toLocaleString()}</div>
          <div class="stat-label">Total Requests</div>
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
    await renderNginxTuning(document.getElementById('mainContent'), newValue);
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
        await renderNginxTuning(document.getElementById('mainContent'), excludePrivate);
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
        await renderNginxTuning(document.getElementById('mainContent'), excludePrivate);
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
        await renderNginxTuning(document.getElementById('mainContent'), excludePrivate);
      } catch (error) {
        hideLoading();
        showError(error.message);
      }
    });
  });
}
