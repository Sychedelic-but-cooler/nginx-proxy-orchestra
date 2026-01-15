import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess } from '../app.js';

// State
let refreshInterval = null;
let healthData = [];

export async function renderSiteHealth(container) {
  showLoading();

  try {
    // Fetch health data
    await updateHealthData();

    // Render UI
    container.innerHTML = `
      <div class="site-health-container">
        <div class="health-header">
          <div class="health-stats">
            <div class="stat-card" id="totalSites">
              <div class="stat-value">-</div>
              <div class="stat-label">Total Sites</div>
            </div>
            <div class="stat-card stat-success" id="upSites">
              <div class="stat-value">-</div>
              <div class="stat-label">Up</div>
            </div>
            <div class="stat-card stat-danger" id="downSites">
              <div class="stat-value">-</div>
              <div class="stat-label">Down</div>
            </div>
            <div class="stat-card stat-muted" id="unknownSites">
              <div class="stat-value">-</div>
              <div class="stat-label">No Data</div>
            </div>
          </div>
        </div>

        <div class="health-table-container">
          <table class="health-table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Status</th>
                <th>Last Checked</th>
                <th>Last Seen Up</th>
                <th>Avg Response (ms)</th>
                <th>Max Response (ms)</th>
                <th>Success Rate</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="healthTableBody">
              <!-- Populated dynamically -->
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Update table
    updateHealthTable();

    // Start auto-refresh (every 5 seconds)
    startAutoRefresh();

  } catch (error) {
    showError(error.message);
    container.innerHTML = '<div class="empty-state"><h2>Failed to load site health</h2></div>';
  } finally {
    hideLoading();
  }
}

async function updateHealthData() {
  try {
    const response = await api.getAllHealthStatus();
    healthData = response.statuses || [];
  } catch (error) {
    console.error('Failed to update health data:', error);
    throw error;
  }
}

function updateHealthTable() {
  const tbody = document.getElementById('healthTableBody');
  if (!tbody) return;

  // Calculate stats
  const total = healthData.length;
  const up = healthData.filter(h => h.status === 'up').length;
  const down = healthData.filter(h => h.status === 'down').length;
  const unknown = healthData.filter(h => !h.status).length;

  // Update stat cards
  document.querySelector('#totalSites .stat-value').textContent = total;
  document.querySelector('#upSites .stat-value').textContent = up;
  document.querySelector('#downSites .stat-value').textContent = down;
  document.querySelector('#unknownSites .stat-value').textContent = unknown;

  // Render table rows
  if (healthData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-cell">
          <div class="empty-state-small">
            <p>No sites configured. Add a site to start monitoring.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = healthData.map(site => {
    const statusBadge = getStatusBadge(site.status);
    const lastChecked = site.last_checked ? formatTimestamp(site.last_checked) : 'Never';
    const lastSuccess = site.last_success ? formatTimestamp(site.last_success) : 'Never';
    const avgResponse = site.avg_response_time ? `${site.avg_response_time} ms` : '-';
    const maxResponse = site.max_response_time ? `${site.max_response_time} ms` : '-';
    
    // Calculate success rate
    const totalChecks = (site.success_count || 0) + (site.failure_count || 0);
    const successRate = totalChecks > 0
      ? `${Math.round((site.success_count / totalChecks) * 100)}%`
      : '-';

    const healthEnabled = site.health_check_enabled;

    return `
      <tr data-site-id="${site.id}">
        <td>
          <div class="site-info">
            <div class="site-name">${escapeHtml(site.name)}</div>
            <div class="site-url">${escapeHtml(site.forward_scheme)}://${escapeHtml(site.forward_host)}:${site.forward_port}</div>
          </div>
        </td>
        <td>${statusBadge}</td>
        <td>${lastChecked}</td>
        <td>${lastSuccess}</td>
        <td>${avgResponse}</td>
        <td>${maxResponse}</td>
        <td>
          <div class="success-rate ${getSuccessRateClass(successRate)}">
            ${successRate}
          </div>
        </td>
        <td>
          <div class="action-buttons">
            ${healthEnabled 
              ? `<button class="btn btn-sm btn-secondary" data-action="disable" data-site-id="${site.id}">Disable</button>`
              : `<button class="btn btn-sm btn-primary" data-action="enable" data-site-id="${site.id}">Enable</button>`
            }
            <button class="btn btn-sm btn-secondary" data-action="details" data-site-id="${site.id}">Details</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  
  // Attach event listeners for action buttons using event delegation
  attachTableEventListeners();
}

function getStatusBadge(status) {
  if (!status) {
    return '<span class="status-badge status-unknown">No Data</span>';
  }
  
  const statusMap = {
    'up': '<span class="status-badge status-up">Up</span>',
    'down': '<span class="status-badge status-down">Down</span>'
  };
  
  return statusMap[status] || '<span class="status-badge status-unknown">Unknown</span>';
}

function getSuccessRateClass(rate) {
  if (rate === '-') return '';
  
  const percent = parseInt(rate);
  if (percent >= 95) return 'rate-excellent';
  if (percent >= 80) return 'rate-good';
  if (percent >= 60) return 'rate-warning';
  return 'rate-poor';
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function startAutoRefresh() {
  stopAutoRefresh();
  refreshInterval = setInterval(async () => {
    try {
      await updateHealthData();
      updateHealthTable();
    } catch (error) {
      console.error('Failed to refresh health data:', error);
    }
  }, 5000); // Refresh every 5 seconds
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// Event delegation for action buttons
function attachTableEventListeners() {
  const tbody = document.getElementById('healthTableBody');
  if (!tbody) return;
  
  // Remove any existing listeners by cloning the tbody
  const newTbody = tbody.cloneNode(true);
  tbody.parentNode.replaceChild(newTbody, tbody);
  
  // Add event listener using delegation
  newTbody.addEventListener('click', async (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    
    const action = button.dataset.action;
    const siteId = parseInt(button.dataset.siteId, 10);
    
    if (action === 'enable') {
      await enableHealthCheck(siteId);
    } else if (action === 'disable') {
      await disableHealthCheck(siteId);
    } else if (action === 'details') {
      await viewHealthDetails(siteId);
    }
  });
}

async function enableHealthCheck(siteId) {
  try {
    showLoading();
    await api.enableHealthCheck(siteId);
    showSuccess('Health check enabled');
    await updateHealthData();
    updateHealthTable();
  } catch (error) {
    showError('Failed to enable health check: ' + error.message);
  } finally {
    hideLoading();
  }
}

async function disableHealthCheck(siteId) {
  if (!confirm('Are you sure you want to disable health checking for this site?')) {
    return;
  }
  
  try {
    showLoading();
    await api.disableHealthCheck(siteId);
    showSuccess('Health check disabled');
    await updateHealthData();
    updateHealthTable();
  } catch (error) {
    showError('Failed to disable health check: ' + error.message);
  } finally {
    hideLoading();
  }
}

async function viewHealthDetails(siteId) {
  try {
    showLoading();
    const details = await api.getProxyHealthStatus(siteId);
    showHealthDetailsModal(details);
  } catch (error) {
    showError('Failed to load health details: ' + error.message);
  } finally {
    hideLoading();
  }
}

function showHealthDetailsModal(details) {
  const pings = details.pings || [];
  
  // Reverse pings so newest is first
  pings.reverse();
  
  const modalHTML = `
    <div class="modal-overlay" id="healthDetailsModal">
      <div class="modal modal-wide">
        <div class="modal-header">
          <h3>Health Details: ${escapeHtml(details.name)}</h3>
          <button class="modal-close" id="closeHealthModal">&times;</button>
        </div>
        <div class="modal-body">
          <div class="health-details-summary">
            <div class="detail-row">
              <span class="detail-label">Current Status:</span>
              <span class="detail-value">${getStatusBadge(details.status)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Upstream:</span>
              <span class="detail-value">${escapeHtml(details.forward_scheme)}://${escapeHtml(details.forward_host)}:${details.forward_port}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Check Interval:</span>
              <span class="detail-value">${details.check_interval || 30} seconds</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Timeout:</span>
              <span class="detail-value">${details.timeout || 5000} ms</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Check Path:</span>
              <span class="detail-value">${escapeHtml(details.check_path || '/')}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Expected Status:</span>
              <span class="detail-value">${details.expected_status || 200}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Average Response:</span>
              <span class="detail-value">${details.avg_response_time ? details.avg_response_time + ' ms' : 'N/A'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Max Response:</span>
              <span class="detail-value">${details.max_response_time ? details.max_response_time + ' ms' : 'N/A'}</span>
            </div>
          </div>
          
          <h4 style="margin-top: 20px;">Recent Checks (Last 100 pings)</h4>
          <div class="ping-history">
            <table class="ping-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Status</th>
                  <th>Response Time</th>
                  <th>HTTP Status</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                ${pings.length > 0 ? pings.map(ping => `
                  <tr class="ping-row-${ping.status}">
                    <td>${new Date(ping.timestamp).toLocaleString()}</td>
                    <td>${getStatusBadge(ping.status)}</td>
                    <td>${ping.response_time ? ping.response_time + ' ms' : '-'}</td>
                    <td>${ping.http_status || '-'}</td>
                    <td class="error-cell">${escapeHtml(ping.error_message || '-')}</td>
                  </tr>
                `).join('') : '<tr><td colspan="5" class="empty-cell">No ping history available</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="closeHealthModalBtn">Close</button>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('modalContainer').innerHTML = modalHTML;
  
  // Close handlers
  document.getElementById('closeHealthModal').addEventListener('click', () => {
    document.getElementById('healthDetailsModal').remove();
  });
  
  document.getElementById('closeHealthModalBtn').addEventListener('click', () => {
    document.getElementById('healthDetailsModal').remove();
  });
}

export function cleanupSiteHealth() {
  stopAutoRefresh();
  healthData = [];
}
