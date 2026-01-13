import api from '../api.js';

let currentPage = 0;
let pageSize = 50;
let totalEvents = 0;
let currentFilters = {};
let events = [];

export async function renderWAFEvents(container) {
  // Set page title
  const headerTitle = document.getElementById('headerTitle');
  if (headerTitle) {
    headerTitle.textContent = 'WAF Events';
  }

  // Show loading
  container.innerHTML = '<div class="loading-text">Loading WAF events...</div>';

  try {
    container.innerHTML = `
      <div class="waf-events">
        <!-- Header with actions -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <div>
            <h2 style="margin: 0 0 8px 0;">WAF Events</h2>
            <p style="margin: 0; color: var(--text-secondary);">
              View and analyze all WAF security events
            </p>
          </div>
          <button id="exportEventsBtn" class="btn btn-secondary">Export to CSV</button>
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

              <!-- Severity -->
              <div class="form-group" style="margin: 0;">
                <label for="filterSeverity">Severity</label>
                <select id="filterSeverity" class="form-control">
                  <option value="">All Severities</option>
                  <option value="0">Emergency</option>
                  <option value="1">Alert</option>
                  <option value="2">Critical</option>
                  <option value="3">Error</option>
                  <option value="4">Warning</option>
                  <option value="5">Notice</option>
                </select>
              </div>

              <!-- Attack Type -->
              <div class="form-group" style="margin: 0;">
                <label for="filterAttackType">Attack Type</label>
                <select id="filterAttackType" class="form-control">
                  <option value="">All Attack Types</option>
                  <option value="sqli">SQL Injection (SQLi)</option>
                  <option value="xss">Cross-Site Scripting (XSS)</option>
                  <option value="rce">Remote Code Execution (RCE)</option>
                  <option value="lfi">Local File Inclusion (LFI)</option>
                  <option value="rfi">Remote File Inclusion (RFI)</option>
                  <option value="php-injection">PHP Code Injection</option>
                  <option value="java-injection">Java Code Injection</option>
                  <option value="fixation">Session Fixation</option>
                  <option value="multipart">Multipart Attack</option>
                  <option value="generic">Generic Application Attack</option>
                  <option value="protocol">Protocol Violation</option>
                  <option value="scanner">Scanner Detection</option>
                  <option value="disclosure">Information Disclosure</option>
                  <option value="dos">Denial of Service</option>
                </select>
              </div>

              <!-- Client IP -->
              <div class="form-group" style="margin: 0;">
                <label for="filterClientIP">Client IP</label>
                <input type="text" id="filterClientIP" class="form-control" placeholder="e.g., 192.168.1.1">
              </div>

              <!-- Blocked Status -->
              <div class="form-group" style="margin: 0;">
                <label for="filterBlocked">Status</label>
                <select id="filterBlocked" class="form-control">
                  <option value="">All</option>
                  <option value="true">Blocked Only</option>
                  <option value="false">Logged Only</option>
                </select>
              </div>

              <!-- Action Buttons -->
              <div style="display: flex; gap: 8px;">
                <button type="submit" class="btn btn-primary" style="flex: 1;">Apply</button>
                <button type="button" id="clearFiltersBtn" class="btn btn-secondary" style="flex: 1;">Clear</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Events Table -->
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h3 class="card-title">Events</h3>
              <small id="eventsCount" style="color: var(--text-secondary);">Loading...</small>
            </div>
          </div>
          <div id="eventsContainer">
            <div class="loading-text" style="padding: 40px;">Loading events...</div>
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
        .events-table {
          width: 100%;
          border-collapse: collapse;
        }

        .events-table th {
          background: #f8f9fa;
          padding: 12px 16px;
          text-align: left;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          border-bottom: 2px solid var(--border-color);
        }

        .events-table td {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-color);
          font-size: 13px;
        }

        .events-table tr:hover td {
          background: #f8f9fa;
        }

        .severity-badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .severity-critical {
          background: #ffebee;
          color: #c62828;
        }

        .severity-error {
          background: #fff3e0;
          color: #e65100;
        }

        .severity-warning {
          background: #fff9c4;
          color: #f57f17;
        }

        .severity-notice {
          background: #e3f2fd;
          color: #1565c0;
        }

        .status-badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .status-blocked {
          background: #ffebee;
          color: #c62828;
        }

        .status-logged {
          background: #e0f2f1;
          color: #00695c;
        }

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
          grid-template-columns: 150px 1fr;
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
          background: #f8f9fa;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 12px;
          font-family: monospace;
          font-size: 12px;
          overflow-x: auto;
          white-space: pre-wrap;
          word-break: break-all;
        }
      </style>
    `;

    // Setup event listeners
    setupEventListeners();

    // Load initial events
    await loadEvents();

  } catch (error) {
    console.error('Error loading WAF events:', error);
    container.innerHTML = `
      <div class="card">
        <div style="padding: 20px; text-align: center;">
          <p style="color: var(--danger-color); margin-bottom: 16px;">
            Failed to load WAF events: ${error.message}
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

function setupEventListeners() {
  // Toggle filters
  const toggleFiltersBtn = document.getElementById('toggleFilters');
  if (toggleFiltersBtn) {
    toggleFiltersBtn.addEventListener('click', () => {
      const container = document.getElementById('filtersContainer');
      const button = document.getElementById('toggleFilters');
      if (container && button) {
        if (container.style.display === 'none') {
          container.style.display = 'block';
          button.textContent = '▼ Collapse';
        } else {
          container.style.display = 'none';
          button.textContent = '▶ Expand';
        }
      }
    });
  }

  // Apply filters
  const filtersForm = document.getElementById('filtersForm');
  if (filtersForm) {
    filtersForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      currentPage = 0; // Reset to first page
      collectFilters();
      await loadEvents();
    });
  }

  // Clear filters
  const clearFiltersBtn = document.getElementById('clearFiltersBtn');
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', async () => {
      const form = document.getElementById('filtersForm');
      if (form) {
        form.reset();
      }
      currentPage = 0;
      currentFilters = {};
      await loadEvents();
    });
  }

  // Export events
  const exportEventsBtn = document.getElementById('exportEventsBtn');
  if (exportEventsBtn) {
    exportEventsBtn.addEventListener('click', exportEventsToCSV);
  }

  // Pagination
  const prevPageBtn = document.getElementById('prevPageBtn');
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', async () => {
      if (currentPage > 0) {
        currentPage--;
        await loadEvents();
      }
    });
  }

  const nextPageBtn = document.getElementById('nextPageBtn');
  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', async () => {
      const maxPage = Math.ceil(totalEvents / pageSize) - 1;
      if (currentPage < maxPage) {
        currentPage++;
        await loadEvents();
      }
    });
  }
}

function collectFilters() {
  currentFilters = {};

  const startDateEl = document.getElementById('filterStartDate');
  const endDateEl = document.getElementById('filterEndDate');
  const severityEl = document.getElementById('filterSeverity');
  const attackTypeEl = document.getElementById('filterAttackType');
  const clientIPEl = document.getElementById('filterClientIP');
  const blockedEl = document.getElementById('filterBlocked');

  const startDate = startDateEl?.value;
  const endDate = endDateEl?.value;
  const severity = severityEl?.value;
  const attackType = attackTypeEl?.value;
  const clientIP = clientIPEl?.value.trim();
  const blocked = blockedEl?.value;

  if (startDate) currentFilters.start_date = startDate;
  if (endDate) currentFilters.end_date = endDate;
  if (severity) currentFilters.severity = severity;
  if (attackType) currentFilters.attack_type = attackType;
  if (clientIP) currentFilters.client_ip = clientIP;
  if (blocked) currentFilters.blocked = blocked;
}

async function loadEvents() {
  const container = document.getElementById('eventsContainer');
  container.innerHTML = '<div class="loading-text" style="padding: 40px;">Loading events...</div>';

  try {
    const filters = {
      ...currentFilters,
      limit: pageSize,
      offset: currentPage * pageSize
    };

    const response = await api.getWAFEvents(filters);
    events = response.events || [];
    totalEvents = response.total || 0;

    // Update count
    const eventsCountEl = document.getElementById('eventsCount');
    if (eventsCountEl) {
      eventsCountEl.textContent = `${totalEvents} total events`;
    }

    // Render events
    if (events.length === 0) {
      container.innerHTML = `
        <div style="padding: 60px 20px; text-align: center; color: var(--text-secondary);">
          <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
          <h3 style="margin: 0 0 8px 0;">No Events Found</h3>
          <p style="margin: 0;">Try adjusting your filters or check back later</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <table class="events-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Client IP</th>
              <th>Proxy</th>
              <th>Request</th>
              <th>Attack Type</th>
              <th>Rule ID</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${events.map(event => renderEventRow(event)).join('')}
          </tbody>
        </table>
      `;

      // Add event listeners to details buttons
      container.querySelectorAll('.btn-details').forEach(btn => {
        btn.addEventListener('click', () => {
          const eventId = parseInt(btn.dataset.eventId);
          const event = events.find(e => e.id === eventId);
          if (event) {
            showEventDetailsModal(event);
          }
        });
      });
    }

    // Update pagination
    updatePagination();

  } catch (error) {
    console.error('Error loading events:', error);
    container.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; color: var(--danger-color);">
        <p>Failed to load events: ${error.message}</p>
      </div>
    `;
  }
}

function getSeverityInfo(severity) {
  const severityMap = {
    '0': { text: 'EMERGENCY', class: 'critical' },
    '1': { text: 'ALERT', class: 'critical' },
    '2': { text: 'CRITICAL', class: 'critical' },
    '3': { text: 'ERROR', class: 'error' },
    '4': { text: 'WARNING', class: 'warning' },
    '5': { text: 'NOTICE', class: 'notice' }
  };

  const info = severityMap[String(severity)] || { text: 'NOTICE', class: 'notice' };
  return info;
}

function renderEventRow(event) {
  const timestamp = new Date(event.timestamp).toLocaleString();
  const request = `${event.request_method || 'GET'} ${truncate(event.request_uri || '/', 40)}`;

  const severityInfo = getSeverityInfo(event.severity);
  const severityClass = `severity-${severityInfo.class}`;
  const severityText = severityInfo.text;

  const statusClass = event.blocked ? 'status-blocked' : 'status-logged';
  const statusText = event.blocked ? 'Blocked' : 'Logged';

  // Extract target host from raw_log (Host header) for accurate attack target display
  let targetHost = 'Unknown';
  try {
    if (event.raw_log) {
      const rawLog = typeof event.raw_log === 'string' ? JSON.parse(event.raw_log) : event.raw_log;
      const hostHeader = rawLog?.transaction?.request?.headers?.Host || rawLog?.transaction?.request?.headers?.host;
      targetHost = hostHeader || event.domain_names || event.proxy_name || 'Unknown';
    } else {
      targetHost = event.domain_names || event.proxy_name || 'Unknown';
    }
  } catch (e) {
    targetHost = event.domain_names || event.proxy_name || 'Unknown';
  }

  return `
    <tr>
      <td style="font-size: 12px; white-space: nowrap;">${timestamp}</td>
      <td style="font-family: monospace; font-size: 12px;">${escapeHtml(event.client_ip)}</td>
      <td>${escapeHtml(targetHost)}</td>
      <td style="font-family: monospace; font-size: 12px;" title="${escapeHtml(event.request_uri || '/')}">${escapeHtml(request)}</td>
      <td>${escapeHtml(event.attack_type || 'Unknown')}</td>
      <td style="font-family: monospace; font-size: 11px;">${escapeHtml(event.rule_id || '-')}</td>
      <td><span class="severity-badge ${severityClass}">${severityText}</span></td>
      <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      <td>
        <button class="btn-details" data-event-id="${event.id}">Details</button>
      </td>
    </tr>
  `;
}

function updatePagination() {
  const maxPage = Math.ceil(totalEvents / pageSize);
  const start = currentPage * pageSize + 1;
  const end = Math.min((currentPage + 1) * pageSize, totalEvents);

  const paginationInfoEl = document.getElementById('paginationInfo');
  if (paginationInfoEl) {
    paginationInfoEl.textContent =
      `Showing ${start}-${end} of ${totalEvents} events (Page ${currentPage + 1} of ${maxPage})`;
  }

  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  
  if (prevBtn) {
    prevBtn.disabled = currentPage === 0;
  }
  
  if (nextBtn) {
    nextBtn.disabled = currentPage >= maxPage - 1 || totalEvents === 0;
  }
}


function showEventDetailsModal(event) {
  const severityInfo = getSeverityInfo(event.severity);
  const severityClass = `severity-${severityInfo.class}`;
  const severityText = severityInfo.text;

  const statusClass = event.blocked ? 'status-blocked' : 'status-logged';
  const statusText = event.blocked ? 'Blocked' : 'Logged';

  // Extract target host from raw_log (Host header) for accurate attack target display
  let targetHost = 'Unknown';
  try {
    if (event.raw_log) {
      const rawLog = typeof event.raw_log === 'string' ? JSON.parse(event.raw_log) : event.raw_log;
      const hostHeader = rawLog?.transaction?.request?.headers?.Host || rawLog?.transaction?.request?.headers?.host;
      targetHost = hostHeader || event.domain_names || event.proxy_name || 'Unknown';
    } else {
      targetHost = event.domain_names || event.proxy_name || 'Unknown';
    }
  } catch (e) {
    targetHost = event.domain_names || event.proxy_name || 'Unknown';
  }

  const modalHTML = `
    <div class="modal-overlay" id="eventDetailsModal">
      <div class="modal-large">
        <div class="modal-header">
          <h3>Event Details</h3>
          <button class="modal-close" id="closeEventModal">&times;</button>
        </div>
        <div class="modal-body">
          <!-- Event Overview -->
          <div class="detail-section">
            <h4 class="detail-section-title">Event Overview</h4>
            <div class="detail-grid">
              <div class="detail-row">
                <div class="detail-label">Timestamp</div>
                <div class="detail-value">${new Date(event.timestamp).toLocaleString()}</div>
              </div>
              <div class="detail-row">
                <div class="detail-label">Event ID</div>
                <div class="detail-value">${event.id}</div>
              </div>
              <div class="detail-row">
                <div class="detail-label">Severity</div>
                <div class="detail-value"><span class="severity-badge ${severityClass}">${severityText}</span></div>
              </div>
              <div class="detail-row">
                <div class="detail-label">Status</div>
                <div class="detail-value"><span class="status-badge ${statusClass}">${statusText}</span></div>
              </div>
            </div>
          </div>

          <!-- Request Information -->
          <div class="detail-section">
            <h4 class="detail-section-title">Request Information</h4>
            <div class="detail-grid">
              <div class="detail-row">
                <div class="detail-label">Client IP</div>
                <div class="detail-value" style="font-family: monospace;">${escapeHtml(event.client_ip)}</div>
              </div>
              <div class="detail-row">
                <div class="detail-label">Target Host</div>
                <div class="detail-value">${escapeHtml(targetHost)}</div>
              </div>
              <div class="detail-row">
                <div class="detail-label">Method</div>
                <div class="detail-value">${escapeHtml(event.request_method || 'GET')}</div>
              </div>
              <div class="detail-row">
                <div class="detail-label">URI</div>
                <div class="detail-value" style="font-family: monospace;">${escapeHtml(event.request_uri || '/')}</div>
              </div>
              ${event.request_headers ? `
                <div class="detail-row">
                  <div class="detail-label">Headers</div>
                  <div class="detail-value">
                    <div class="code-block">${escapeHtml(event.request_headers)}</div>
                  </div>
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Attack Information -->
          <div class="detail-section">
            <h4 class="detail-section-title">Attack Information</h4>
            <div class="detail-grid">
              <div class="detail-row">
                <div class="detail-label">Attack Type</div>
                <div class="detail-value">${escapeHtml(event.attack_type || 'Unknown')}</div>
              </div>
              <div class="detail-row">
                <div class="detail-label">Rule ID</div>
                <div class="detail-value" style="font-family: monospace;">${escapeHtml(event.rule_id || 'N/A')}</div>
              </div>
              <div class="detail-row">
                <div class="detail-label">Rule Message</div>
                <div class="detail-value">${escapeHtml(event.rule_message || 'No message available')}</div>
              </div>
            </div>
          </div>

          ${event.raw_log ? `
            <!-- Raw Log Entry -->
            <div class="detail-section">
              <h4 class="detail-section-title">Raw ModSecurity Log</h4>
              <div class="code-block">${escapeHtml(event.raw_log)}</div>
            </div>
          ` : ''}

          <!-- Actions -->
          <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--border-color);">
            <button class="btn btn-secondary" id="createExclusionBtn" data-event-id="${event.id}">
              Create Exclusion Rule
            </button>
            <small style="display: block; margin-top: 8px; color: var(--text-secondary);">
              Add an exclusion if this is a false positive
            </small>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="closeEventModalBtn">Close</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modalContainer').innerHTML = modalHTML;

  // Close handlers
  document.getElementById('closeEventModal').addEventListener('click', closeEventModal);
  document.getElementById('closeEventModalBtn').addEventListener('click', closeEventModal);

  // Create exclusion button
  const createExclusionBtn = document.getElementById('createExclusionBtn');
  if (createExclusionBtn) {
    createExclusionBtn.addEventListener('click', () => {
      closeEventModal();
      showCreateExclusionModal(event);
    });
  }
}

function closeEventModal() {
  const modal = document.getElementById('eventDetailsModal');
  if (modal) modal.remove();
}


async function exportEventsToCSV() {
  try {
    // Fetch all events (up to 10,000)
    const response = await api.getWAFEvents({ ...currentFilters, limit: 10000, offset: 0 });
    const allEvents = response.events || [];

    if (allEvents.length === 0) {
      alert('No events to export');
      return;
    }

    // Create CSV content
    const headers = ['Timestamp', 'Client IP', 'Proxy', 'Method', 'URI', 'Attack Type', 'Rule ID', 'Severity', 'Status', 'Blocked'];
    let csv = headers.join(',') + '\n';

    allEvents.forEach(event => {
      // Extract target host from raw_log (Host header) for accurate attack target display
      let targetHost = 'Unknown';
      try {
        if (event.raw_log) {
          const rawLog = typeof event.raw_log === 'string' ? JSON.parse(event.raw_log) : event.raw_log;
          const hostHeader = rawLog?.transaction?.request?.headers?.Host || rawLog?.transaction?.request?.headers?.host;
          targetHost = hostHeader || event.domain_names || event.proxy_name || 'Unknown';
        } else {
          targetHost = event.domain_names || event.proxy_name || 'Unknown';
        }
      } catch (e) {
        targetHost = event.domain_names || event.proxy_name || 'Unknown';
      }

      const severityInfo = getSeverityInfo(event.severity);

      const row = [
        event.timestamp,
        event.client_ip,
        targetHost,
        event.request_method || 'GET',
        `"${(event.request_uri || '/').replace(/"/g, '""')}"`,
        event.attack_type || 'Unknown',
        event.rule_id || '',
        severityInfo.text,
        event.blocked ? 'Blocked' : 'Logged',
        event.blocked ? 'Yes' : 'No'
      ];
      csv += row.join(',') + '\n';
    });

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waf-events-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (error) {
    console.error('Error exporting events:', error);
    alert(`Failed to export events: ${error.message}`);
  }
}

function truncate(str, maxLength) {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// ============================================================================
// WAF Exclusion Modal Functions
// ============================================================================

function showCreateExclusionModal(event) {
  const modalHTML = `
    <div class="modal-overlay" id="createExclusionModal">
      <div class="modal">
        <div class="modal-header">
          <h3>Create WAF Exclusion Rule</h3>
          <button class="modal-close" id="closeExclusionModal">&times;</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom: 16px; padding: 12px; background: #fff3cd; border-radius: 4px; border-left: 4px solid #ffc107;">
            <strong>⚠️ False Positive Detected?</strong>
            <p style="margin: 8px 0 0 0; font-size: 14px;">Create an exclusion if this detection is a false positive. The exclusion will apply to all proxies using the same WAF profile.</p>
          </div>

          <form id="exclusionForm">
            <div class="form-group">
              <label>Rule ID *</label>
              <input type="text" id="exclusionRuleId" value="${escapeHtml(event.rule_id || '')}" readonly>
              <small>The ModSecurity rule that triggered this event</small>
            </div>

            <div class="form-group">
              <label>Attack Type</label>
              <input type="text" value="${escapeHtml(event.attack_type || 'Unknown')}" readonly>
            </div>

            <div class="form-group">
              <label>Scope</label>
              <select id="exclusionScope">
                <option value="global">Global - Disable rule entirely for this profile</option>
                <option value="path" selected>Path-based - Disable rule for specific path</option>
                <option value="parameter">Parameter-based - Exclude specific parameter</option>
                <option value="path_parameter">Path + Parameter - Most specific</option>
              </select>
            </div>

            <div class="form-group" id="pathPatternGroup">
              <label>Path Pattern</label>
              <input type="text" id="exclusionPathPattern" value="${escapeHtml(event.request_uri || '')}" placeholder="/api/authentik/">
              <small>Requests matching this path prefix will be excluded</small>
            </div>

            <div class="form-group" id="parameterGroup" style="display: none;">
              <label>Parameter Name</label>
              <input type="text" id="exclusionParameter" placeholder="csrf_token">
              <small>Exclude this parameter from WAF inspection</small>
            </div>

            <div class="form-group">
              <label>Reason *</label>
              <textarea id="exclusionReason" rows="3" required placeholder="Example: Authentik uses non-standard JSON format that triggers SQL injection false positive"></textarea>
              <small>Explain why this is a false positive</small>
            </div>

            <input type="hidden" id="exclusionProxyId" value="${event.proxy_id}">

            <div id="exclusionError" style="color: var(--danger-color); margin-top: 12px; display: none;"></div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="cancelExclusionBtn">Cancel</button>
          <button type="submit" form="exclusionForm" class="btn btn-primary" id="saveExclusionBtn">Create Exclusion</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // Scope selector logic
  const scopeSelect = document.getElementById('exclusionScope');
  const pathGroup = document.getElementById('pathPatternGroup');
  const paramGroup = document.getElementById('parameterGroup');

  scopeSelect.addEventListener('change', () => {
    const scope = scopeSelect.value;
    pathGroup.style.display = (scope === 'path' || scope === 'path_parameter') ? 'block' : 'none';
    paramGroup.style.display = (scope === 'parameter' || scope === 'path_parameter') ? 'block' : 'none';
  });

  // Close handlers
  document.getElementById('closeExclusionModal').addEventListener('click', closeCreateExclusionModal);
  document.getElementById('cancelExclusionBtn').addEventListener('click', closeCreateExclusionModal);

  // Form submit
  document.getElementById('exclusionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveExclusion();
  });
}

function closeCreateExclusionModal() {
  const modal = document.getElementById('createExclusionModal');
  if (modal) modal.remove();
}

async function saveExclusion() {
  const errorDiv = document.getElementById('exclusionError');
  const saveBtn = document.getElementById('saveExclusionBtn');

  const ruleId = document.getElementById('exclusionRuleId').value;
  const scope = document.getElementById('exclusionScope').value;
  const pathPattern = document.getElementById('exclusionPathPattern').value;
  const parameter = document.getElementById('exclusionParameter').value;
  const reason = document.getElementById('exclusionReason').value.trim();
  const proxyId = document.getElementById('exclusionProxyId').value;

  if (!reason) {
    errorDiv.textContent = 'Reason is required';
    errorDiv.style.display = 'block';
    return;
  }

  errorDiv.style.display = 'none';
  saveBtn.disabled = true;
  saveBtn.textContent = 'Creating...';

  try {
    const data = {
      proxy_id: proxyId,  // Used for auto-detection of profile
      rule_id: ruleId,
      reason: reason
    };

    // Add scope-specific fields
    if (scope === 'path' || scope === 'path_parameter') {
      data.path_pattern = pathPattern;
    }
    if (scope === 'parameter' || scope === 'path_parameter') {
      data.parameter_name = parameter;
    }

    await api.createWAFExclusion(data);

    closeCreateExclusionModal();
    showToast('WAF exclusion created successfully', 'success');

    // Reload events to show the exclusion took effect
    await loadEvents();
  } catch (error) {
    errorDiv.textContent = error.message || 'Failed to create exclusion';
    errorDiv.style.display = 'block';
    saveBtn.disabled = false;
    saveBtn.textContent = 'Create Exclusion';
  }
}
