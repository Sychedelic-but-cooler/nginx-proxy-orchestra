import api from '../api.js';
import { showLoading, hideLoading, showError, setHeader } from '../app.js';

export async function renderNginxStatistics(container) {
  setHeader('Nginx Statistics');
  showLoading();

  try {
    const stats = await api.getNginxStatistics(24);

    container.innerHTML = `
      <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
        <strong>ℹ️ Nginx Statistics:</strong> View effectiveness metrics and understand how your security rules are protecting your proxy hosts.
        <br><small style="color: var(--text-secondary);">Showing data from the last 24 hours</small>
      </div>

      <!-- Main Metrics -->
      <div class="grid grid-4" style="margin-bottom: 30px;">
        <div class="stat-card">
          <div class="stat-value" style="color: var(--primary-color);">${stats.totalRequests.toLocaleString()}</div>
          <div class="stat-label">Total Requests</div>
          <small style="color: var(--text-secondary); display: block; margin-top: 8px;">
            ${stats.metrics.avgRequestsPerHour}/hour avg
          </small>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: var(--success-color);">${stats.successRate}%</div>
          <div class="stat-label">Success Rate</div>
          <small style="color: var(--text-secondary); display: block; margin-top: 8px;">
            ${stats.successfulRequests.toLocaleString()} successful
          </small>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: var(--danger-color);">${stats.blockedPercentage}%</div>
          <div class="stat-label">Block Rate</div>
          <small style="color: var(--text-secondary); display: block; margin-top: 8px;">
            ${stats.blockedRequests.toLocaleString()} blocked (${stats.metrics.avgBlocksPerHour}/hour)
          </small>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color: var(--warning-color);">${stats.rateLimitedPercentage}%</div>
          <div class="stat-label">Rate Limit Rate</div>
          <small style="color: var(--text-secondary); display: block; margin-top: 8px;">
            ${stats.rateLimitedRequests.toLocaleString()} limited (${stats.metrics.avgRateLimitsPerHour}/hour)
          </small>
        </div>
      </div>

      <!-- Active Security Rules -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <h3 class="card-title">Active Security Rules</h3>
        </div>
        <div style="padding: 20px;">
          <div class="grid grid-4">
            <div style="text-align: center; padding: 16px; background: var(--bg-color); border-radius: 4px;">
              <div style="font-size: 32px; font-weight: 700; color: var(--danger-color);">${stats.activeRules.ipBlacklist}</div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">IP Blacklist Rules</div>
            </div>
            <div style="text-align: center; padding: 16px; background: var(--bg-color); border-radius: 4px;">
              <div style="font-size: 32px; font-weight: 700; color: var(--warning-color);">${stats.activeRules.geoBlock}</div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">Geo-Block Rules</div>
            </div>
            <div style="text-align: center; padding: 16px; background: var(--bg-color); border-radius: 4px;">
              <div style="font-size: 32px; font-weight: 700; color: var(--warning-color);">${stats.activeRules.userAgentFilter}</div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">User-Agent Filters</div>
            </div>
            <div style="text-align: center; padding: 16px; background: var(--bg-color); border-radius: 4px;">
              <div style="font-size: 32px; font-weight: 700; color: var(--primary-color);">${stats.activeRules.rateLimit}</div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">Rate Limits</div>
            </div>
          </div>
        </div>
      </div>

      <!-- HTTP Status Breakdown -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <h3 class="card-title">HTTP Status Code Breakdown</h3>
        </div>
        <div style="padding: 20px;">
          <table class="table">
            <thead>
              <tr>
                <th>Status Code</th>
                <th>Description</th>
                <th>Count</th>
                <th>% of Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>200</code></td>
                <td>OK (Successful)</td>
                <td>${stats.statusBreakdown['200'].toLocaleString()}</td>
                <td style="color: var(--success-color); font-weight: 600;">
                  ${((stats.statusBreakdown['200'] / stats.totalRequests) * 100).toFixed(2)}%
                </td>
              </tr>
              <tr>
                <td><code>403</code></td>
                <td>Forbidden (Blocked by Security Rules)</td>
                <td>${stats.statusBreakdown['403'].toLocaleString()}</td>
                <td style="color: var(--danger-color); font-weight: 600;">
                  ${((stats.statusBreakdown['403'] / stats.totalRequests) * 100).toFixed(2)}%
                </td>
              </tr>
              <tr>
                <td><code>404</code></td>
                <td>Not Found</td>
                <td>${stats.statusBreakdown['404'].toLocaleString()}</td>
                <td style="color: var(--text-secondary);">
                  ${((stats.statusBreakdown['404'] / stats.totalRequests) * 100).toFixed(2)}%
                </td>
              </tr>
              <tr>
                <td><code>429</code></td>
                <td>Too Many Requests (Rate Limited)</td>
                <td>${stats.statusBreakdown['429'].toLocaleString()}</td>
                <td style="color: var(--warning-color); font-weight: 600;">
                  ${((stats.statusBreakdown['429'] / stats.totalRequests) * 100).toFixed(2)}%
                </td>
              </tr>
              <tr>
                <td><code>500</code></td>
                <td>Internal Server Error</td>
                <td>${stats.statusBreakdown['500'].toLocaleString()}</td>
                <td style="color: var(--danger-color);">
                  ${((stats.statusBreakdown['500'] / stats.totalRequests) * 100).toFixed(2)}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Security Effectiveness -->
      <div class="grid grid-2" style="margin-bottom: 20px;">
        <!-- Protection Summary -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Protection Summary</h3>
          </div>
          <div style="padding: 20px;">
            <div style="margin-bottom: 20px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-weight: 500;">IP Blacklist Blocks</span>
                <span style="font-weight: 600; color: var(--danger-color);">${stats.blockedRequests.toLocaleString()}</span>
              </div>
              <div style="background: var(--bg-color); border-radius: 4px; height: 8px; overflow: hidden;">
                <div style="background: var(--danger-color); height: 100%; width: ${stats.blockedPercentage}%;"></div>
              </div>
            </div>

            <div style="margin-bottom: 20px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-weight: 500;">Rate Limit Triggers</span>
                <span style="font-weight: 600; color: var(--warning-color);">${stats.rateLimitedRequests.toLocaleString()}</span>
              </div>
              <div style="background: var(--bg-color); border-radius: 4px; height: 8px; overflow: hidden;">
                <div style="background: var(--warning-color); height: 100%; width: ${stats.rateLimitedPercentage}%;"></div>
              </div>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-weight: 500;">Successful Requests</span>
                <span style="font-weight: 600; color: var(--success-color);">${stats.successfulRequests.toLocaleString()}</span>
              </div>
              <div style="background: var(--bg-color); border-radius: 4px; height: 8px; overflow: hidden;">
                <div style="background: var(--success-color); height: 100%; width: ${stats.successRate}%;"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Insights -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Insights & Recommendations</h3>
          </div>
          <div style="padding: 20px;">
            ${generateInsights(stats)}
          </div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Quick Actions</h3>
        </div>
        <div style="padding: 20px; display: flex; gap: 12px; flex-wrap: wrap;">
          <button class="btn btn-primary" id="goToTuningBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <path d="M12 20v-6M6 20V10m12 10V4"></path>
            </svg>
            Go to Nginx Tuning
          </button>
          <button class="btn btn-secondary" id="goToSettingsBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M12 1v6m0 6v6m5.66-14.66l-4.23 4.23m0 5.66l4.23 4.23M1 12h6m6 0h6M3.34 3.34l4.23 4.23m5.66 0l4.23-4.23M3.34 20.66l4.23-4.23m5.66 0l4.23 4.23"></path>
            </svg>
            Security Settings
          </button>
          <button class="btn btn-secondary" id="refreshStatsBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            Refresh Statistics
          </button>
        </div>
      </div>
    `;

    setupStatisticsHandlers();

  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>Failed to load nginx statistics</h2>
        <p style="color: var(--text-secondary);">${error.message}</p>
        <p style="color: var(--text-secondary); margin-top: 12px;">Make sure nginx access logs are available at <code>/var/log/nginx/access.log</code></p>
      </div>
    `;
    showError(error.message);
  } finally {
    hideLoading();
  }
}

function generateInsights(stats) {
  const insights = [];

  // High block rate
  if (parseFloat(stats.blockedPercentage) > 10) {
    insights.push(`
      <div style="padding: 12px; background: #fee2e2; border-left: 3px solid var(--danger-color); border-radius: 4px; margin-bottom: 12px;">
        <strong>⚠️ High Block Rate:</strong> ${stats.blockedPercentage}% of requests are being blocked. Review your IP blacklist rules.
      </div>
    `);
  } else if (parseFloat(stats.blockedPercentage) > 0) {
    insights.push(`
      <div style="padding: 12px; background: #d1fae5; border-left: 3px solid var(--success-color); border-radius: 4px; margin-bottom: 12px;">
        <strong>✓ Blocking Working:</strong> IP blacklist is blocking ${stats.blockedPercentage}% of requests (${stats.blockedRequests.toLocaleString()} total).
      </div>
    `);
  }

  // Rate limiting
  if (parseFloat(stats.rateLimitedPercentage) > 5) {
    insights.push(`
      <div style="padding: 12px; background: #fef3c7; border-left: 3px solid var(--warning-color); border-radius: 4px; margin-bottom: 12px;">
        <strong>⚠️ High Rate Limiting:</strong> ${stats.rateLimitedPercentage}% of requests are rate limited. Consider adjusting limits.
      </div>
    `);
  } else if (stats.activeRules.rateLimit > 0 && parseFloat(stats.rateLimitedPercentage) > 0) {
    insights.push(`
      <div style="padding: 12px; background: #d1fae5; border-left: 3px solid var(--success-color); border-radius: 4px; margin-bottom: 12px;">
        <strong>✓ Rate Limiting Active:</strong> ${stats.rateLimitedRequests.toLocaleString()} requests throttled (${stats.rateLimitedPercentage}%).
      </div>
    `);
  }

  // No security rules
  if (stats.activeRules.ipBlacklist === 0 && stats.activeRules.geoBlock === 0 && stats.activeRules.userAgentFilter === 0) {
    insights.push(`
      <div style="padding: 12px; background: #e3f2fd; border-left: 3px solid var(--primary-color); border-radius: 4px; margin-bottom: 12px;">
        <strong>ℹ️ No Security Rules:</strong> You haven't configured any blocking rules yet. Visit <a href="#/security/tuning" style="color: var(--primary-color); text-decoration: underline;">Nginx Tuning</a> to get started.
      </div>
    `);
  }

  // High success rate
  if (parseFloat(stats.successRate) > 95) {
    insights.push(`
      <div style="padding: 12px; background: #d1fae5; border-left: 3px solid var(--success-color); border-radius: 4px; margin-bottom: 12px;">
        <strong>✓ Excellent Success Rate:</strong> ${stats.successRate}% of requests are successful.
      </div>
    `);
  }

  if (insights.length === 0) {
    return `<p style="color: var(--text-secondary);">Everything looks good! Your security rules are working effectively.</p>`;
  }

  return insights.join('');
}

function setupStatisticsHandlers() {
  document.getElementById('goToTuningBtn')?.addEventListener('click', () => {
    window.location.hash = '#/security/tuning';
  });

  document.getElementById('goToSettingsBtn')?.addEventListener('click', () => {
    window.location.hash = '#/settings/security';
  });

  document.getElementById('refreshStatsBtn')?.addEventListener('click', async () => {
    await renderNginxStatistics(document.getElementById('mainContent'));
  });
}
