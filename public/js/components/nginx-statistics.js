import api from '../api.js';
import { showLoading, hideLoading, showError, setHeader } from '../app.js';

export async function renderNginxStatistics(container, timeRange = '24h') {
  setHeader('Traffic & Performance');
  showLoading();

  try {
    const hours = timeRange === '24h' ? 24 : 168;
    const [stats, trafficStats, wafStats, banStats] = await Promise.all([
      api.getNginxStatistics(hours),
      api.getStatistics(timeRange),
      api.getWAFStats(hours).catch(() => ({ totalEvents: 0, blockedEvents: 0 })),
      api.getBanStats().catch(() => ({ totalBans: 0, activeBans: 0 }))
    ]);

    container.innerHTML = `
      <!-- Time Range Selector -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; border-radius: 4px; flex: 1; margin-right: 16px;">
          <strong>ℹ️ Traffic & Performance Analytics:</strong> Deep-dive into traffic patterns, performance metrics, and security effectiveness.
        </div>
        <div style="display: flex; gap: 8px; background: var(--card-bg); padding: 4px; border-radius: 8px; border: 1px solid var(--border-color);">
          <button id="range24h" class="btn ${timeRange === '24h' ? 'btn-primary' : 'btn-secondary'}" style="padding: 8px 16px; font-size: 14px;">24h</button>
          <button id="range7d" class="btn ${timeRange === '7d' ? 'btn-primary' : 'btn-secondary'}" style="padding: 8px 16px; font-size: 14px;">7d</button>
        </div>
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

      <!-- Traffic Timeline -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <h3 class="card-title">Requests by Hour</h3>
        </div>
        <div style="padding: 20px;">
          ${trafficStats.totalRequests > 0 && trafficStats.requestsByHour ? renderHourlyChart(trafficStats.requestsByHour) : '<p style="color: var(--text-secondary);">No traffic data available</p>'}
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

      <!-- Top Traffic Sources -->
      <div class="grid grid-2" style="margin-bottom: 20px;">
        <!-- Top IPs -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Top Connecting IPs</h3>
          </div>
          ${trafficStats.topIPs && trafficStats.topIPs.length > 0 ? `
            <table class="table">
              <thead>
                <tr>
                  <th>IP Address</th>
                  <th>Requests</th>
                  <th>% of Total</th>
                </tr>
              </thead>
              <tbody>
                ${trafficStats.topIPs.map(ipData => {
                  const percentage = trafficStats.totalRequests > 0 ? ((ipData.count / trafficStats.totalRequests) * 100).toFixed(2) : '0.00';
                  return `
                    <tr>
                      <td><code>${ipData.item || ipData.ip}</code></td>
                      <td>${ipData.count.toLocaleString()}</td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <div style="flex: 1; height: 6px; background: var(--border-color); border-radius: 3px; overflow: hidden;">
                            <div style="width: ${percentage}%; height: 100%; background: var(--primary-color);"></div>
                          </div>
                          <span style="min-width: 45px; text-align: right; font-size: 12px;">${percentage}%</span>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          ` : '<p style="padding: 16px; color: var(--text-secondary);">No traffic data available</p>'}
        </div>

        <!-- Top Hosts -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Top Hosts by Traffic</h3>
          </div>
          ${trafficStats.topHosts && trafficStats.topHosts.length > 0 ? `
            <table class="table">
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Requests</th>
                  <th>% of Total</th>
                </tr>
              </thead>
              <tbody>
                ${trafficStats.topHosts.map(host => {
                  const percentage = trafficStats.totalRequests > 0 ? ((host.count / trafficStats.totalRequests) * 100).toFixed(2) : '0.00';
                  return `
                    <tr>
                      <td><strong>${host.item}</strong></td>
                      <td>${host.count.toLocaleString()}</td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 8px;">
                          <div style="flex: 1; height: 6px; background: var(--border-color); border-radius: 3px; overflow: hidden;">
                            <div style="width: ${percentage}%; height: 100%; background: var(--primary-color);"></div>
                          </div>
                          <span style="min-width: 45px; text-align: right; font-size: 12px;">${percentage}%</span>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          ` : '<p style="padding: 16px; color: var(--text-secondary);">No host data available</p>'}
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

            <div style="margin-bottom: 20px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-weight: 500;">WAF Blocks</span>
                <span style="font-weight: 600; color: var(--danger-color);">${(wafStats.blockedEvents || 0).toLocaleString()}</span>
              </div>
              <div style="background: var(--bg-color); border-radius: 4px; height: 8px; overflow: hidden;">
                <div style="background: var(--danger-color); height: 100%; width: ${wafStats.totalEvents > 0 ? ((wafStats.blockedEvents / wafStats.totalEvents) * 100).toFixed(0) : 0}%;"></div>
              </div>
            </div>

            <div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-weight: 500;">Ban System Actions</span>
                <span style="font-weight: 600; color: var(--danger-color);">${(banStats.activeBans || 0).toLocaleString()}</span>
              </div>
              <div style="background: var(--bg-color); border-radius: 4px; height: 8px; overflow: hidden;">
                <div style="background: var(--danger-color); height: 100%; width: ${banStats.totalBans > 0 ? Math.min(((banStats.activeBans / banStats.totalBans) * 100), 100).toFixed(0) : 0}%;"></div>
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
          <button class="btn btn-primary" id="goToSecurityBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <path d="M12 20v-6M6 20V10m12 10V4"></path>
            </svg>
            Manage Security Rules
          </button>
          <button class="btn btn-secondary" id="goToWAFBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="9" x2="15" y2="15"></line>
              <line x1="15" y1="9" x2="9" y2="15"></line>
            </svg>
            View WAF Events
          </button>
          <button class="btn btn-secondary" id="goToBansBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
            </svg>
            View Banned IPs
          </button>
        </div>
      </div>
    `;

    setupStatisticsHandlers(timeRange);

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

function setupStatisticsHandlers(timeRange) {
  // Time range switchers
  document.getElementById('range24h')?.addEventListener('click', async () => {
    await renderNginxStatistics(document.getElementById('mainContent'), '24h');
  });

  document.getElementById('range7d')?.addEventListener('click', async () => {
    await renderNginxStatistics(document.getElementById('mainContent'), '7d');
  });

  // Quick action buttons
  document.getElementById('goToSecurityBtn')?.addEventListener('click', () => {
    window.location.hash = '#/security/tuning';
  });

  document.getElementById('goToWAFBtn')?.addEventListener('click', () => {
    window.location.hash = '#/waf/events';
  });

  document.getElementById('goToBansBtn')?.addEventListener('click', () => {
    window.location.hash = '#/waf/bans';
  });
}
