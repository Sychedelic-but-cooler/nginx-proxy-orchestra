import api from '../api.js';
import { showError } from '../app.js';

let currentPage = 0;
let pageSize = 50;
let totalLogs = 0;
let currentFilters = {};
let logs = [];
let users = [];
let resourceTypes = [];
let actions = [];

export async function renderAuditLog(container) {
  // Set page title
  const headerTitle = document.getElementById('headerTitle');
  if (headerTitle) {
    headerTitle.textContent = 'Audit Log';
  }

  // Show loading
  container.innerHTML = '<div class="loading-text">Loading audit log...</div>';

  try {
    container.innerHTML = `
      <div class="audit-log">
        <!-- Header with actions -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <div>
            <h2 style="margin: 0 0 8px 0;">Audit Log</h2>
            <p style="margin: 0; color: var(--text-secondary);">
              Track all administrative actions and system events
            </p>
          </div>
          <button id="exportLogsBtn" class="btn btn-secondary">Export to CSV</button>
        </div>

        <!-- Filters Card -->
        <div class="card" style="margin-bottom: 20px;">
          <div class="card-header">
            <h3 class="card-title">Filters</h3>
            <button id="toggleFilters" class="btn btn-secondary" style="padding: 4px 12px; font-size: 13px;">
              ▼ Collapse
            </button>
          </div>
          <div id="filtersContainer" style="padding: 20px;">
            <form id="filtersForm" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; align-items: end;">
              <!-- Date Range -->
              <div class="form-group" style="margin: 0;">
                <label for="filterStartDate">Start Date</label>
                <input type="datetime-local" id="filterStartDate" class="form-control">
              </div>

              <div class="form-group" style="margin: 0;">
                <label for="filterEndDate">End Date</label>
                <input type="datetime-local" id="filterEndDate" class="form-control">
              </div>

              <!-- User Filter -->
              <div class="form-group" style="margin: 0;">
                <label for="filterUser">User</label>
                <select id="filterUser" class="form-control">
                  <option value="">All Users</option>
                </select>
              </div>

              <!-- Action Filter -->
              <div class="form-group" style="margin: 0;">
                <label for="filterAction">Action</label>
                <select id="filterAction" class="form-control">
                  <option value="">All Actions</option>
                </select>
              </div>

              <!-- Resource Type Filter -->
              <div class="form-group" style="margin: 0;">
                <label for="filterResourceType">Resource Type</label>
                <select id="filterResourceType" class="form-control">
                  <option value="">All Resources</option>
                </select>
              </div>

              <!-- IP Address -->
              <div class="form-group" style="margin: 0;">
                <label for="filterIPAddress">IP Address</label>
                <input type="text" id="filterIPAddress" class="form-control" placeholder="e.g., 192.168.1.1">
              </div>

              <!-- Success Filter -->
              <div class="form-group" style="margin: 0;">
                <label for="filterSuccess">Status</label>
                <select id="filterSuccess" class="form-control">
                  <option value="">All</option>
                  <option value="true">Success Only</option>
                  <option value="false">Failed Only</option>
                </select>
              </div>

              <!-- Search -->
              <div class="form-group" style="margin: 0;">
                <label for="filterSearch">Search</label>
                <input type="text" id="filterSearch" class="form-control" placeholder="Search details...">
              </div>

              <!-- Action Buttons -->
              <div style="display: flex; gap: 8px;">
                <button type="submit" class="btn btn-primary" style="flex: 1;">Apply</button>
                <button type="button" id="clearFiltersBtn" class="btn btn-secondary" style="flex: 1;">Clear</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Logs Table -->
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h3 class="card-title">Audit Entries</h3>
              <small id="logsCount" style="color: var(--text-secondary);">Loading...</small>
            </div>
          </div>
          <div id="logsContainer">
            <div class="loading-text" style="padding: 40px;">Loading logs...</div>
          </div>

          <!-- Pagination -->
          <div id="paginationContainer" style="padding: 16px 20px; border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
            <div id="paginationInfo" style="font-size: 14px; color: var(--text-secondary);"></div>
            <div style="display: flex; gap: 8px;">
              <button id="prevPageBtn" class="btn btn-secondary" style="padding: 6px 12px; font-size: 13px;">← Previous</button>
              <button id="nextPageBtn" class="btn btn-secondary" style="padding: 6px 12px; font-size: 13px;">Next →</button>
            </div>
          </div>
        </div>
      </div>

      <style>
        .audit-log {
          max-width: 100%;
        }

        .logs-table {
          width: 100%;
          border-collapse: collapse;
        }

        .logs-table th {
          background: var(--bg-color);
          padding: 12px 16px;
          text-align: left;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          border-bottom: 2px solid var(--border-color);
        }

        .logs-table td {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-color);
          font-size: 13px;
        }

        .logs-table tr:hover td {
          background: var(--bg-color);
        }

        .action-badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .action-create { background: #e0f2f1; color: #00695c; }
        .action-delete { background: #ffebee; color: #c62828; }
        .action-update { background: #fff3e0; color: #e65100; }
        .action-enable { background: #e8f5e9; color: #2e7d32; }
        .action-disable { background: #f5f5f5; color: #616161; }
        .action-login { background: #e3f2fd; color: #1565c0; }
        .action-logout { background: #f3e5f5; color: #6a1b9a; }
        .action-default { background: #e0e0e0; color: #424242; }

        .status-badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        }

        .status-success { background: #e8f5e9; color: #2e7d32; }
        .status-failed { background: #ffebee; color: #c62828; }

        .btn-details {
          padding: 4px 10px;
          font-size: 12px;
          background: var(--primary-color);
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }

        .btn-details:hover {
          opacity: 0.9;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 20px;
        }

        .modal-large {
          background: white;
          border-radius: 12px;
          width: 100%;
          max-width: 900px;
          max-height: 90vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .modal-large .modal-body {
          overflow-y: auto;
          padding: 24px;
        }

        .detail-section {
          margin-bottom: 24px;
          padding-bottom: 24px;
          border-bottom: 1px solid var(--border-color);
        }

        .detail-section:last-child {
          border-bottom: none;
          margin-bottom: 0;
          padding-bottom: 0;
        }

        .detail-section-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 12px 0;
        }

        .detail-grid {
          display: grid;
          gap: 12px;
        }

        .detail-row {
          display: grid;
          grid-template-columns: 180px 1fr;
          gap: 12px;
          font-size: 14px;
        }

        .detail-label {
          font-weight: 600;
          color: var(--text-secondary);
        }

        .detail-value {
          color: var(--text-primary);
          word-break: break-all;
        }

        .code-block {
          background: var(--bg-color);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 12px;
          font-family: monospace;
          font-size: 12px;
          overflow-x: auto;
          white-space: pre-wrap;
          word-break: break-all;
        }

        .changes-diff {
          background: var(--bg-color);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 12px;
          font-size: 13px;
        }

        .diff-line {
          padding: 4px 8px;
          margin: 2px 0;
          font-family: monospace;
          font-size: 12px;
        }

        .diff-added {
          background: #e8f5e9;
          color: #2e7d32;
        }

        .diff-removed {
          background: #ffebee;
          color: #c62828;
        }

        .truncate {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 300px;
        }
      </style>
    `;

    // Setup event listeners
    setupEventListeners();

    // Load filter options
    await loadFilterOptions();

    // Load initial logs
    await loadLogs();

  } catch (error) {
    console.error('Error loading audit log:', error);
    container.innerHTML = `
      <div class="card">
        <div style="padding: 20px; text-align: center;">
          <p style="color: var(--danger-color); margin-bottom: 16px;">
            Failed to load audit log: ${error.message}
          </p>
          <button id="retryLoadBtn" class="btn btn-secondary">Retry</button>
        </div>
      </div>
    `;

    document.getElementById('retryLoadBtn')?.addEventListener('click', () => {
      location.reload();
    });
  }
}

async function loadFilterOptions() {
  try {
    // Get initial logs to extract unique values for filters
    const response = await api.getAuditLog({ limit: 1000 });
    const allLogs = response.logs || [];

    // Extract unique users
    const userSet = new Set();
    const actionSet = new Set();
    const resourceTypeSet = new Set();

    allLogs.forEach(log => {
      if (log.username) userSet.add(log.username);
      if (log.action) actionSet.add(log.action);
      if (log.resource_type) resourceTypeSet.add(log.resource_type);
    });

    users = Array.from(userSet).sort();
    actions = Array.from(actionSet).sort();
    resourceTypes = Array.from(resourceTypeSet).sort();

    // Populate filter dropdowns
    const userSelect = document.getElementById('filterUser');
    if (userSelect) {
      users.forEach(user => {
        const option = document.createElement('option');
        option.value = user;
        option.textContent = user;
        userSelect.appendChild(option);
      });
    }

    const actionSelect = document.getElementById('filterAction');
    if (actionSelect) {
      actions.forEach(action => {
        const option = document.createElement('option');
        option.value = action;
        option.textContent = formatActionLabel(action);
        actionSelect.appendChild(option);
      });
    }

    const resourceTypeSelect = document.getElementById('filterResourceType');
    if (resourceTypeSelect) {
      resourceTypes.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = formatResourceTypeLabel(type);
        resourceTypeSelect.appendChild(option);
      });
    }

  } catch (error) {
    console.error('Error loading filter options:', error);
  }
}

function setupEventListeners() {
  // Toggle filters
  document.getElementById('toggleFilters').addEventListener('click', () => {
    const container = document.getElementById('filtersContainer');
    const button = document.getElementById('toggleFilters');
    if (container.style.display === 'none') {
      container.style.display = 'block';
      button.textContent = '▼ Collapse';
    } else {
      container.style.display = 'none';
      button.textContent = '▶ Expand';
    }
  });

  // Apply filters
  document.getElementById('filtersForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    currentPage = 0; // Reset to first page
    collectFilters();
    await loadLogs();
  });

  // Clear filters
  document.getElementById('clearFiltersBtn').addEventListener('click', async () => {
    document.getElementById('filtersForm').reset();
    currentPage = 0;
    currentFilters = {};
    await loadLogs();
  });

  // Export logs
  document.getElementById('exportLogsBtn').addEventListener('click', exportLogsToCSV);

  // Pagination
  document.getElementById('prevPageBtn').addEventListener('click', async () => {
    if (currentPage > 0) {
      currentPage--;
      await loadLogs();
    }
  });

  document.getElementById('nextPageBtn').addEventListener('click', async () => {
    const maxPage = Math.ceil(totalLogs / pageSize) - 1;
    if (currentPage < maxPage) {
      currentPage++;
      await loadLogs();
    }
  });
}

function collectFilters() {
  currentFilters = {};

  const startDate = document.getElementById('filterStartDate').value;
  const endDate = document.getElementById('filterEndDate').value;
  const username = document.getElementById('filterUser').value;
  const action = document.getElementById('filterAction').value;
  const resourceType = document.getElementById('filterResourceType').value;
  const ipAddress = document.getElementById('filterIPAddress').value.trim();
  const success = document.getElementById('filterSuccess').value;
  const search = document.getElementById('filterSearch').value.trim();

  if (startDate) currentFilters.start_date = startDate;
  if (endDate) currentFilters.end_date = endDate;
  if (username) currentFilters.username = username;
  if (action) currentFilters.action = action;
  if (resourceType) currentFilters.resource_type = resourceType;
  if (ipAddress) currentFilters.ip_address = ipAddress;
  if (success) currentFilters.success = success;
  if (search) currentFilters.search = search;
}

async function loadLogs() {
  const container = document.getElementById('logsContainer');
  container.innerHTML = '<div class="loading-text" style="padding: 40px;">Loading logs...</div>';

  try {
    const filters = {
      ...currentFilters,
      limit: pageSize,
      offset: currentPage * pageSize
    };

    const response = await api.getAuditLog(filters);
    logs = response.logs || [];
    totalLogs = response.total || 0;

    // Update count
    document.getElementById('logsCount').textContent = `${totalLogs} total entries`;

    // Update pagination info
    const start = currentPage * pageSize + 1;
    const end = Math.min((currentPage + 1) * pageSize, totalLogs);
    document.getElementById('paginationInfo').textContent = 
      totalLogs > 0 ? `Showing ${start}-${end} of ${totalLogs}` : 'No entries';

    // Update pagination buttons
    document.getElementById('prevPageBtn').disabled = currentPage === 0;
    const maxPage = Math.ceil(totalLogs / pageSize) - 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= maxPage || totalLogs === 0;

    // Render logs
    if (logs.length === 0) {
      container.innerHTML = `
        <div style="padding: 60px 20px; text-align: center; color: var(--text-secondary);">
          <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
          <h3 style="margin: 0 0 8px 0;">No Audit Entries Found</h3>
          <p style="margin: 0;">Try adjusting your filters or check back later</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <table class="logs-table">
          <thead>
            <tr>
              <th style="width: 160px;">Timestamp</th>
              <th style="width: 120px;">User</th>
              <th style="width: 100px;">Action</th>
              <th style="width: 120px;">Resource Type</th>
              <th>Description</th>
              <th style="width: 120px;">IP Address</th>
              <th style="width: 80px;">Status</th>
              <th style="width: 80px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map(log => renderLogRow(log)).join('')}
          </tbody>
        </table>
      `;

      // Add event listeners to details buttons
      logs.forEach(log => {
        document.getElementById(`details-${log.id}`)?.addEventListener('click', () => {
          showDetailsModal(log);
        });
      });
    }

  } catch (error) {
    console.error('Error loading logs:', error);
    showError(error.message);
    container.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; color: var(--danger-color);">
        <p>Failed to load audit logs: ${error.message}</p>
      </div>
    `;
  }
}

/**
 * Parse IP address to extract IPv4 if available
 * Handles formats like:
 * - "192.168.1.1"
 * - "::ffff:192.168.1.1" (IPv4-mapped IPv6)
 * - "2001:db8::1"
 * - null/undefined
 */
function parseIPAddress(ipAddress) {
  if (!ipAddress) {
    return {
      display: '-',
      full: 'Unknown',
      ipv4: null,
      ipv6: null,
      hasIPv6: false
    };
  }

  // Check for IPv4-mapped IPv6 format (::ffff:x.x.x.x)
  const ipv4MappedMatch = ipAddress.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/i);
  if (ipv4MappedMatch) {
    return {
      display: ipv4MappedMatch[1], // Show the IPv4 address
      full: ipAddress,
      ipv4: ipv4MappedMatch[1],
      ipv6: ipAddress,
      hasIPv6: true
    };
  }

  // Check if it's a pure IPv4 address
  const ipv4Match = ipAddress.match(/^(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    return {
      display: ipv4Match[1],
      full: ipAddress,
      ipv4: ipv4Match[1],
      ipv6: null,
      hasIPv6: false
    };
  }

  // Must be pure IPv6
  return {
    display: ipAddress.length > 20 ? ipAddress.substring(0, 20) + '...' : ipAddress,
    full: ipAddress,
    ipv4: null,
    ipv6: ipAddress,
    hasIPv6: true
  };
}

function renderLogRow(log) {
  const timestamp = new Date(log.created_at).toLocaleString();
  const username = log.username || 'System';
  const action = log.action;
  const resourceType = log.resource_type;
  const parsedIP = parseIPAddress(log.ip_address);
  const success = log.success !== undefined ? log.success : 1;

  // Format description
  let description = formatDescription(log);

  return `
    <tr>
      <td style="white-space: nowrap; font-size: 12px;">${timestamp}</td>
      <td><strong>${username}</strong></td>
      <td>${renderActionBadge(action)}</td>
      <td>${formatResourceTypeLabel(resourceType)}</td>
      <td class="truncate" title="${description}">${description}</td>
      <td style="font-family: monospace; font-size: 12px;" title="${parsedIP.full}">${parsedIP.display}</td>
      <td>${renderStatusBadge(success)}</td>
      <td>
        <button id="details-${log.id}" class="btn-details">Details</button>
      </td>
    </tr>
  `;
}

function renderActionBadge(action) {
  const actionLower = action.toLowerCase();
  let className = 'action-default';
  
  if (actionLower === 'create') className = 'action-create';
  else if (actionLower === 'delete') className = 'action-delete';
  else if (actionLower === 'update') className = 'action-update';
  else if (actionLower === 'enable') className = 'action-enable';
  else if (actionLower === 'disable') className = 'action-disable';
  else if (actionLower === 'login') className = 'action-login';
  else if (actionLower === 'logout') className = 'action-logout';

  return `<span class="action-badge ${className}">${action}</span>`;
}

function renderStatusBadge(success) {
  const isSuccess = success === 1 || success === true;
  const className = isSuccess ? 'status-success' : 'status-failed';
  const label = isSuccess ? 'Success' : 'Failed';
  return `<span class="status-badge ${className}">${label}</span>`;
}

function formatDescription(log) {
  let resourceName = '';
  
  try {
    const details = JSON.parse(log.details || '{}');
    resourceName = details.name || '';
  } catch (e) {
    // Ignore parsing errors
  }

  const action = log.action.charAt(0).toUpperCase() + log.action.slice(1);
  const resourceLabel = formatResourceTypeLabel(log.resource_type);

  if (resourceName) {
    return `${action} ${resourceLabel}: ${resourceName}`;
  } else {
    return `${action} ${resourceLabel}`;
  }
}

function formatActionLabel(action) {
  return action.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

function formatResourceTypeLabel(resourceType) {
  const labels = {
    'proxy': 'Proxy Host',
    'certificate': 'Certificate',
    'ssl_certificate': 'SSL Certificate',
    'module': 'Module',
    'user': 'User',
    'settings': 'Settings',
    'waf_profile': 'WAF Profile',
    'waf_exclusion': 'WAF Exclusion',
    'security_rule': 'Security Rule',
    'ban_integration': 'Ban Integration',
    'ip_ban': 'IP Ban',
    'ip_whitelist': 'IP Whitelist',
    'detection_rule': 'Detection Rule',
    'credential': 'Credential',
    'dns_credential': 'DNS Credential',
    'session': 'Session',
    'nginx': 'Nginx'
  };
  
  return labels[resourceType] || resourceType.split('_').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

function showDetailsModal(log) {
  // Parse details
  let detailsObj = {};
  try {
    detailsObj = JSON.parse(log.details || '{}');
  } catch (e) {
    detailsObj = { raw: log.details };
  }

  // Parse before/after states if available
  let beforeState = null;
  let afterState = null;
  try {
    if (log.before_state) beforeState = JSON.parse(log.before_state);
    if (log.after_state) afterState = JSON.parse(log.after_state);
  } catch (e) {
    // Ignore
  }

  const timestamp = new Date(log.created_at).toLocaleString();
  const username = log.username || 'System';
  const success = log.success !== undefined ? log.success : 1;
  const isSuccess = success === 1 || success === true;
  const parsedIP = parseIPAddress(log.ip_address);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-large">
      <div class="modal-header">
        <h2 class="modal-title">Audit Log Details</h2>
        <button class="btn-close" id="closeDetailsModal">&times;</button>
      </div>
      <div class="modal-body">
        <!-- Event Overview -->
        <div class="detail-section">
          <h3 class="detail-section-title">Event Overview</h3>
          <div class="detail-grid">
            <div class="detail-row">
              <span class="detail-label">ID:</span>
              <span class="detail-value">${log.id}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Timestamp:</span>
              <span class="detail-value">${timestamp}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">User:</span>
              <span class="detail-value"><strong>${username}</strong></span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Action:</span>
              <span class="detail-value">${renderActionBadge(log.action)}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Resource Type:</span>
              <span class="detail-value">${formatResourceTypeLabel(log.resource_type)}</span>
            </div>
            ${log.resource_id ? `
              <div class="detail-row">
                <span class="detail-label">Resource ID:</span>
                <span class="detail-value">${log.resource_id}</span>
              </div>
            ` : ''}
            <div class="detail-row">
              <span class="detail-label">Status:</span>
              <span class="detail-value">${renderStatusBadge(success)}</span>
            </div>
            ${log.error_message ? `
              <div class="detail-row">
                <span class="detail-label">Error Message:</span>
                <span class="detail-value" style="color: var(--danger-color);">${log.error_message}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Client Information -->
        <div class="detail-section">
          <h3 class="detail-section-title">Client Information</h3>
          <div class="detail-grid">
            <div class="detail-row">
              <span class="detail-label">IP Address:</span>
              <span class="detail-value" style="font-family: monospace;">${parsedIP.display}</span>
            </div>
            ${parsedIP.hasIPv6 ? `
              <div class="detail-row">
                <span class="detail-label">IPv6 Address:</span>
                <span class="detail-value" style="font-family: monospace; font-size: 11px; color: var(--text-secondary);">${parsedIP.ipv6}</span>
              </div>
            ` : ''}
            ${log.user_agent ? `
              <div class="detail-row">
                <span class="detail-label">User Agent:</span>
                <span class="detail-value" style="font-size: 12px;">${log.user_agent}</span>
              </div>
            ` : ''}
            ${log.session_id ? `
              <div class="detail-row">
                <span class="detail-label">Session ID:</span>
                <span class="detail-value" style="font-family: monospace; font-size: 11px;">${log.session_id}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Event Details -->
        ${Object.keys(detailsObj).length > 0 ? `
          <div class="detail-section">
            <h3 class="detail-section-title">Event Details</h3>
            <div class="code-block">${JSON.stringify(detailsObj, null, 2)}</div>
          </div>
        ` : ''}

        <!-- Before/After Comparison -->
        ${beforeState || afterState ? `
          <div class="detail-section">
            <h3 class="detail-section-title">State Changes</h3>
            ${renderStateComparison(beforeState, afterState)}
          </div>
        ` : ''}

        <!-- Raw Audit Log -->
        <div class="detail-section">
          <h3 class="detail-section-title">Raw Audit Log</h3>
          <div class="code-block">${JSON.stringify(log, null, 2)}</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="closeDetailsModalBtn">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close modal handlers
  document.getElementById('closeDetailsModal').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  document.getElementById('closeDetailsModalBtn').addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
}

function renderStateComparison(beforeState, afterState) {
  if (!beforeState && !afterState) {
    return '<p style="color: var(--text-secondary);">No state information available</p>';
  }

  let html = '<div class="changes-diff">';

  if (beforeState && afterState) {
    // Show differences
    const allKeys = new Set([...Object.keys(beforeState), ...Object.keys(afterState)]);
    
    allKeys.forEach(key => {
      const beforeVal = beforeState[key];
      const afterVal = afterState[key];
      
      if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
        html += `
          <div style="margin-bottom: 12px;">
            <strong style="color: var(--text-secondary);">${key}:</strong>
            ${beforeVal !== undefined ? `
              <div class="diff-line diff-removed">- ${JSON.stringify(beforeVal)}</div>
            ` : ''}
            ${afterVal !== undefined ? `
              <div class="diff-line diff-added">+ ${JSON.stringify(afterVal)}</div>
            ` : ''}
          </div>
        `;
      }
    });
  } else if (beforeState) {
    html += `<strong>Before State:</strong><div class="code-block">${JSON.stringify(beforeState, null, 2)}</div>`;
  } else if (afterState) {
    html += `<strong>After State:</strong><div class="code-block">${JSON.stringify(afterState, null, 2)}</div>`;
  }

  html += '</div>';
  return html;
}

function exportLogsToCSV() {
  const url = api.getAuditLogExportUrl(currentFilters);
  window.open(url, '_blank');
}
