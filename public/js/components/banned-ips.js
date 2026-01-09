import api from '../api.js';

let bans = [];
let stats = null;
let eventSource = null;
let currentContainer = null;

export async function renderBannedIPs(container) {
  // Show loading
  container.innerHTML = '<div class="loading-text">Loading banned IPs...</div>';

  // Store container reference for real-time updates
  currentContainer = container;

  try {
    await loadBans();
    renderBansList(container);

    // Start real-time updates
    startRealtimeUpdates();
  } catch (error) {
    container.innerHTML = `<div class="error-message">Failed to load banned IPs: ${error.message}</div>`;
  }
}

/**
 * Start SSE connection for real-time ban updates
 */
function startRealtimeUpdates() {
  // Close existing connection if any
  if (eventSource) {
    eventSource.close();
  }

  try {
    eventSource = api.createWAFEventStream();

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        // Listen for ban events
        if (data.type === 'ban_event') {
          console.log('Received ban event:', data.eventType);
          handleBanEvent(data.eventType, data.data);
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error for bans:', error);
      // Will automatically attempt to reconnect
    };

    eventSource.onopen = () => {
      console.log('Real-time ban updates connected');
    };
  } catch (error) {
    console.error('Failed to start real-time updates:', error);
  }
}

/**
 * Handle incoming ban events
 */
async function handleBanEvent(eventType, data) {
  if (!currentContainer) return;

  // Show toast notification
  if (eventType === 'ban_created') {
    showToast(`IP ${data.ip_address} was banned`, 'info');
  } else if (eventType === 'ban_removed') {
    showToast(`IP ${data.ip_address} was unbanned`, 'info');
  } else if (eventType === 'ban_updated') {
    showToast(`Ban updated for ${data.ip_address}`, 'info');
  }

  // Reload bans list
  try {
    await loadBans();
    renderBansList(currentContainer);
  } catch (error) {
    console.error('Failed to reload bans after event:', error);
  }
}

/**
 * Cleanup SSE connection when navigating away
 */
export function cleanupBannedIPs() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  currentContainer = null;
}

async function loadBans() {
  const [bansResponse, statsResponse] = await Promise.all([
    api.getBans(200),
    api.getBanStats()
  ]);

  bans = bansResponse.bans || [];
  stats = statsResponse;
}

function renderBansList(container) {
  container.innerHTML = `
    <div class="info-banner" style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 16px 20px; margin-bottom: 24px; border-radius: 4px;">
      <strong>Ban System:</strong> Bans are queued for upstream firewall integrations.
      Check Settings &gt; Ban Integrations to configure firewall connections.
    </div>

    <!-- Statistics Cards -->
    <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-bottom: 28px;">
      <div class="stat-card">
        <div class="stat-label">Active Bans</div>
        <div class="stat-value">${stats.total_bans || 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Auto-Bans</div>
        <div class="stat-value">${stats.auto_bans || 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Manual Bans</div>
        <div class="stat-value">${stats.manual_bans || 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Last 24h</div>
        <div class="stat-value">${stats.bans_last_24h || 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Tracked IPs</div>
        <div class="stat-value">${stats.detection?.tracked_ips || 0}</div>
        <div class="stat-description">${stats.detection?.tracked_events || 0} events</div>
      </div>
    </div>

    <!-- Bans List -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Banned IP Addresses</h3>
        <div class="card-actions">
          <button id="refreshBansBtn" class="btn btn-secondary">Refresh</button>
        </div>
      </div>

      ${bans.length === 0 ? `
        <div style="padding: 50px 30px; text-align: center; color: var(--text-secondary);">
          <p style="font-size: 16px; margin-bottom: 8px;">No active bans</p>
          <small>IPs that violate detection rules will appear here</small>
        </div>
      ` : `
        <div class="table-container" style="padding: 20px;">
          <table class="data-table" style="width: 100%;">
            <thead>
              <tr>
                <th style="padding: 14px 12px;">IP Address</th>
                <th style="padding: 14px 12px;">Reason</th>
                <th style="padding: 14px 12px;">Severity</th>
                <th style="padding: 14px 12px;">Type</th>
                <th style="padding: 14px 12px;">Duration</th>
                <th style="padding: 14px 12px;">Banned At</th>
                <th style="padding: 14px 12px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${bans.map(ban => `
                <tr>
                  <td style="padding: 14px 12px;">
                    <span style="font-family: monospace; font-weight: 600; font-size: 14px;">${escapeHtml(ban.ip_address)}</span>
                    ${ban.proxy_domain ? `<br><small style="color: var(--text-secondary);">${escapeHtml(ban.proxy_domain)}</small>` : ''}
                  </td>
                  <td style="padding: 14px 12px;">
                    <div style="max-width: 320px; word-break: break-word; line-height: 1.5;">${escapeHtml(ban.reason)}</div>
                    ${ban.attack_type ? `<div style="margin-top: 4px;"><small style="color: var(--text-secondary);">Attack: ${escapeHtml(ban.attack_type)}</small></div>` : ''}
                    ${ban.event_count ? `<div style="margin-top: 2px;"><small style="color: var(--text-secondary);">${ban.event_count} events</small></div>` : ''}
                  </td>
                  <td style="padding: 14px 12px;">
                    <span class="badge badge-${getSeverityColor(ban.severity)}">${ban.severity || 'MEDIUM'}</span>
                  </td>
                  <td style="padding: 14px 12px;">
                    <span class="badge ${ban.auto_banned ? 'badge-info' : 'badge-warning'}">
                      ${ban.auto_banned ? 'Auto' : 'Manual'}
                    </span>
                  </td>
                  <td style="padding: 14px 12px;">
                    ${ban.expires_at ? `
                      <span style="color: ${isExpiringSoon(ban.expires_at) ? 'var(--warning-color)' : 'inherit'};">
                        ${formatDuration(ban.expires_at)}
                      </span>
                      <br><small style="color: var(--text-secondary);">${formatDateTime(ban.expires_at)}</small>
                    ` : '<strong>Permanent</strong>'}
                  </td>
                  <td style="padding: 14px 12px;">
                    <span>${formatDateTime(ban.banned_at)}</span>
                    ${ban.banned_by_username ? `<br><small style="color: var(--text-secondary);">by ${escapeHtml(ban.banned_by_username)}</small>` : ''}
                  </td>
                  <td style="padding: 14px 12px;">
                    <div class="btn-group">
                      ${ban.expires_at ? `
                        <button class="btn btn-sm btn-secondary btn-make-permanent" data-id="${ban.id}" data-ip="${escapeHtml(ban.ip_address)}">
                          Make Permanent
                        </button>
                      ` : ''}
                      <button class="btn btn-sm btn-danger btn-unban" data-id="${ban.id}" data-ip="${escapeHtml(ban.ip_address)}">
                        Unban
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  // Attach event listeners
  attachEventListeners();
}

function attachEventListeners() {
  // Add Ban button (from header)
  const addBanBtn = document.getElementById('addBanBtn');
  if (addBanBtn) {
    addBanBtn.addEventListener('click', showAddBanModal);
  }

  // Refresh button
  const refreshBtn = document.getElementById('refreshBansBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      const mainContent = document.getElementById('mainContent');
      await renderBannedIPs(mainContent);
    });
  }

  // Unban buttons
  document.querySelectorAll('.btn-unban').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const ip = e.currentTarget.dataset.ip;

      if (confirm(`Unban IP ${ip}?\n\nThis will remove the ban from the local database and queue an unban request to all notified integrations.`)) {
        await handleUnban(id);
      }
    });
  });

  // Make permanent buttons
  document.querySelectorAll('.btn-make-permanent').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      const ip = e.currentTarget.dataset.ip;

      if (confirm(`Make ban permanent for ${ip}?\n\nThis will remove the expiry time, keeping the IP banned indefinitely.`)) {
        await handleMakePermanent(id);
      }
    });
  });
}

function showAddBanModal() {
  const modalHTML = `
    <div class="modal-overlay" id="addBanModal">
      <div class="modal">
        <div class="modal-header">
          <h3>Ban IP Address</h3>
          <button class="modal-close" id="closeBanModal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="addBanForm">
            <div class="form-group">
              <label for="banIpAddress">IP Address *</label>
              <input type="text" id="banIpAddress" placeholder="192.168.1.100" required>
              <small>The IP address to ban</small>
            </div>

            <div class="form-group">
              <label for="banReason">Reason *</label>
              <textarea id="banReason" rows="3" placeholder="Describe why this IP is being banned" required></textarea>
              <small>Explain the reason for banning this IP</small>
            </div>

            <div class="form-group">
              <label for="banSeverity">Severity</label>
              <select id="banSeverity">
                <option value="LOW">Low</option>
                <option value="MEDIUM" selected>Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>

            <div class="form-group">
              <label for="banDuration">Duration</label>
              <select id="banDuration">
                <option value="0">Permanent</option>
                <option value="3600">1 hour</option>
                <option value="21600">6 hours</option>
                <option value="86400">24 hours</option>
                <option value="604800">7 days</option>
                <option value="2592000">30 days</option>
              </select>
              <small>How long the ban should last</small>
            </div>

            <div id="banError" style="color: var(--danger-color); margin-top: 12px; display: none;"></div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="cancelBanBtn">Cancel</button>
          <button type="submit" form="addBanForm" class="btn btn-danger" id="saveBanBtn">Ban IP</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // Close handlers
  document.getElementById('closeBanModal').addEventListener('click', closeAddBanModal);
  document.getElementById('cancelBanBtn').addEventListener('click', closeAddBanModal);

  // Form submit
  document.getElementById('addBanForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleAddBan();
  });
}

function closeAddBanModal() {
  const modal = document.getElementById('addBanModal');
  if (modal) modal.remove();
}

async function handleAddBan() {
  const errorDiv = document.getElementById('banError');
  const saveBtn = document.getElementById('saveBanBtn');

  const ipAddress = document.getElementById('banIpAddress').value.trim();
  const reason = document.getElementById('banReason').value.trim();
  const severity = document.getElementById('banSeverity').value;
  const duration = parseInt(document.getElementById('banDuration').value);

  if (!ipAddress || !reason) {
    errorDiv.textContent = 'IP address and reason are required';
    errorDiv.style.display = 'block';
    return;
  }

  errorDiv.style.display = 'none';
  saveBtn.disabled = true;
  saveBtn.textContent = 'Banning...';

  try {
    const result = await api.createBan({
      ip_address: ipAddress,
      reason: reason,
      severity: severity,
      duration: duration || null
    });

    closeAddBanModal();
    showToast(`IP ${ipAddress} banned successfully. Queued for ${result.integrations_queued || 0} integration(s).`, 'success');

    // Reload bans list
    const mainContent = document.getElementById('mainContent');
    await renderBannedIPs(mainContent);
  } catch (error) {
    errorDiv.textContent = error.message || 'Failed to ban IP';
    errorDiv.style.display = 'block';
    saveBtn.disabled = false;
    saveBtn.textContent = 'Ban IP';
  }
}

async function handleUnban(id) {
  try {
    const result = await api.unban(id);
    showToast(result.message || 'IP unbanned successfully', 'success');

    // Reload bans list
    const mainContent = document.getElementById('mainContent');
    await renderBannedIPs(mainContent);
  } catch (error) {
    showToast(`Failed to unban IP: ${error.message}`, 'error');
  }
}

async function handleMakePermanent(id) {
  try {
    const result = await api.makeBanPermanent(id);
    showToast(result.message || 'Ban made permanent', 'success');

    // Reload bans list
    const mainContent = document.getElementById('mainContent');
    await renderBannedIPs(mainContent);
  } catch (error) {
    showToast(`Failed to make ban permanent: ${error.message}`, 'error');
  }
}

// Helper functions
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getSeverityColor(severity) {
  const colors = {
    'LOW': 'info',
    'MEDIUM': 'warning',
    'HIGH': 'danger',
    'CRITICAL': 'danger'
  };
  return colors[severity] || 'info';
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function formatDuration(expiresAt) {
  if (!expiresAt) return 'Permanent';

  const now = new Date();
  const expires = new Date(expiresAt);
  const diff = expires - now;

  if (diff < 0) return 'Expired';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours < 1) return `${minutes}m`;
  if (hours < 24) return `${hours}h ${minutes}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function isExpiringSoon(expiresAt) {
  if (!expiresAt) return false;
  const now = new Date();
  const expires = new Date(expiresAt);
  const diff = expires - now;
  return diff < (60 * 60 * 1000); // Less than 1 hour
}

function showToast(message, type = 'info') {
  // Simple toast notification
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196F3'};
    color: white;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
