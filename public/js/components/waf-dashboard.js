import api from '../api.js';

let currentTimeRange = '24h';
let eventSource = null;
let timelineChart = null;
let distributionChart = null;
let stats = null;
let recentEvents = [];

export async function renderWAFDashboard(container) {
  // Set page title
  const headerTitle = document.getElementById('headerTitle');
  if (headerTitle) {
    headerTitle.textContent = 'WAF Dashboard';
  }

  // Show loading
  container.innerHTML = '<div class="loading-text">Loading WAF dashboard...</div>';

  try {
    // Load initial statistics
    stats = await api.getWAFStats(parseInt(currentTimeRange));

    // Render dashboard
    container.innerHTML = `
      <div class="waf-dashboard">
        <!-- Header with controls -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <h2 style="margin: 0;">WAF Dashboard</h2>
            <div id="liveIndicator" class="live-indicator">
              <span class="live-dot"></span>
              <span>LIVE</span>
            </div>
          </div>
          <div style="display: flex; gap: 10px;">
            <select id="timeRangeSelect" class="form-control" style="width: auto;">
              <option value="1">Last 1 Hour</option>
              <option value="6">Last 6 Hours</option>
              <option value="24" selected>Last 24 Hours</option>
              <option value="168">Last 7 Days</option>
            </select>
            <button id="refreshStatsBtn" class="btn btn-secondary">🔄 Refresh</button>
            <button id="manageProfilesBtn" class="btn btn-primary">⚙️ Manage Profiles</button>
            <button id="exportCsvBtn" class="btn btn-secondary">📥 Export CSV</button>
          </div>
        </div>

        <!-- Overview Cards -->
        <div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 30px;">
          <div class="stat-card">
            <div class="stat-icon" style="background: #e3f2fd;">🛡️</div>
            <div class="stat-content">
              <div class="stat-label">Total Events</div>
              <div class="stat-value" id="totalEvents">${stats.total_events || 0}</div>
              <div class="stat-change">Last ${getTimeRangeLabel()}</div>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon" style="background: #ffebee;">🚫</div>
            <div class="stat-content">
              <div class="stat-label">Blocked Attacks</div>
              <div class="stat-value" id="blockedAttacks">${stats.blocked_attacks || 0}</div>
              <div class="stat-change">${calculatePercentage(stats.blocked_attacks, stats.total_events)}% of total</div>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon" style="background: #e8f5e9;">✅</div>
            <div class="stat-content">
              <div class="stat-label">Active Profiles</div>
              <div class="stat-value" id="activeProfiles">${stats.active_profiles || 0}</div>
              <div class="stat-change">WAF profiles enabled</div>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon" style="background: #fff3e0;">⚠️</div>
            <div class="stat-content">
              <div class="stat-label">Top Attack Type</div>
              <div class="stat-value" style="font-size: 16px;" id="topAttackType">${getTopAttackType(stats.by_type)}</div>
              <div class="stat-change">${getTopAttackCount(stats.by_type)} occurrences</div>
            </div>
          </div>
        </div>

        <!-- Charts Row -->
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 30px;">
          <!-- Timeline Chart -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Events Timeline</h3>
              <small style="color: var(--text-secondary);">Real-time event monitoring</small>
            </div>
            <div style="padding: 20px;">
              <canvas id="timelineChart" height="250"></canvas>
            </div>
          </div>

          <!-- Distribution Chart -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Attack Distribution</h3>
              <small style="color: var(--text-secondary);">By attack type</small>
            </div>
            <div style="padding: 20px;">
              <canvas id="distributionChart" height="250"></canvas>
            </div>
          </div>
        </div>

        <!-- Top Attacking IPs -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Top Attacking IPs</h3>
            <small style="color: var(--text-secondary);">Most active sources</small>
          </div>
          <div id="topIPsContainer">
            <div class="loading-text" style="padding: 20px;">Loading top IPs...</div>
          </div>
        </div>

        <!-- Recent Events - Full Width -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Recent Events</h3>
            <a href="#/waf/events" style="color: var(--primary-color); text-decoration: none; font-size: 14px;">
              View All →
            </a>
          </div>
          <div id="recentEventsContainer">
            <div class="loading-text" style="padding: 20px;">Loading recent events...</div>
          </div>
        </div>
      </div>

      <style>
        .live-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          background: #e8f5e9;
          border-radius: 16px;
          font-size: 12px;
          font-weight: 600;
          color: #2e7d32;
        }

        .live-dot {
          width: 8px;
          height: 8px;
          background: #4caf50;
          border-radius: 50%;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .stat-card {
          background: white;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 20px;
          display: flex;
          gap: 16px;
          align-items: center;
        }

        .stat-icon {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          flex-shrink: 0;
        }

        .stat-content {
          flex: 1;
        }

        .stat-label {
          font-size: 14px;
          color: var(--text-secondary);
          margin-bottom: 4px;
        }

        .stat-value {
          font-size: 32px;
          font-weight: 700;
          color: var(--text-primary);
          line-height: 1;
          margin-bottom: 4px;
        }

        .stat-change {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .event-row {
          display: grid;
          grid-template-columns: 140px 120px 180px 1fr 150px 80px 100px 90px;
          gap: 12px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-color);
          align-items: center;
          font-size: 13px;
        }

        .event-row:hover {
          background: #f8f9fa;
        }

        .event-row.header {
          background: #f8f9fa;
          font-weight: 600;
          color: var(--text-secondary);
          font-size: 12px;
          text-transform: uppercase;
        }

        .event-row.new-event {
          animation: highlightEvent 2s ease-out;
        }

        @keyframes highlightEvent {
          0% { background: #e3f2fd; }
          100% { background: transparent; }
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

        .ip-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-color);
          font-size: 13px;
        }

        .ip-row:hover {
          background: #f8f9fa;
        }

        .ip-info {
          flex: 1;
        }

        .ip-address {
          font-family: monospace;
          font-weight: 600;
          color: var(--text-primary);
        }

        .ip-count {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 2px;
        }

        .btn-block-ip {
          padding: 4px 10px;
          font-size: 12px;
          background: var(--danger-color);
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }

        .btn-block-ip:hover {
          opacity: 0.9;
        }
      </style>
    `;

    // Initialize charts
    renderTimelineChart(stats.timeline);
    renderDistributionChart(stats.by_type);

    // Load recent events
    loadRecentEvents();

    // Load top IPs
    renderTopIPs(stats.top_ips);

    // Setup event listeners
    setupEventListeners();

    // Start real-time updates
    startRealtimeUpdates();

  } catch (error) {
    console.error('Error loading WAF dashboard:', error);
    container.innerHTML = `
      <div class="card">
        <div style="padding: 20px; text-align: center;">
          <p style="color: var(--danger-color); margin-bottom: 16px;">
            ❌ Failed to load WAF dashboard: ${error.message}
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

function getTimeRangeLabel() {
  const labels = {
    '1': '1 hour',
    '6': '6 hours',
    '24': '24 hours',
    '168': '7 days'
  };
  return labels[currentTimeRange] || '24 hours';
}

function calculatePercentage(value, total) {
  if (!total || total === 0) return '0';
  return ((value / total) * 100).toFixed(1);
}

function getTopAttackType(byType) {
  if (!byType || Object.keys(byType).length === 0) return 'None';

  const sorted = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  return sorted[0][0] || 'None';
}

function getTopAttackCount(byType) {
  if (!byType || Object.keys(byType).length === 0) return 0;

  const sorted = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  return sorted[0][1] || 0;
}

function renderTimelineChart(timelineData) {
  const ctx = document.getElementById('timelineChart');
  if (!ctx) return;

  // Destroy existing chart
  if (timelineChart) {
    timelineChart.destroy();
  }

  // Prepare data
  const labels = timelineData ? timelineData.map(d => d.hour) : [];
  const totalData = timelineData ? timelineData.map(d => d.count) : [];
  const blockedData = timelineData ? timelineData.map(d => d.blocked_count) : [];

  timelineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Events',
          data: totalData,
          borderColor: '#2196F3',
          backgroundColor: 'rgba(33, 150, 243, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          fill: true
        },
        {
          label: 'Blocked',
          data: blockedData,
          borderColor: '#f44336',
          backgroundColor: 'rgba(244, 67, 54, 0.1)',
          borderWidth: 2,
          tension: 0.4,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0
          }
        }
      }
    }
  });
}

function renderDistributionChart(byTypeData) {
  const ctx = document.getElementById('distributionChart');
  if (!ctx) return;

  // Destroy existing chart
  if (distributionChart) {
    distributionChart.destroy();
  }

  // Prepare data
  const labels = byTypeData ? Object.keys(byTypeData) : [];
  const data = byTypeData ? Object.values(byTypeData) : [];
  const colors = [
    '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
    '#2196F3', '#03a9f4', '#00bcd4', '#009688', '#4caf50'
  ];

  distributionChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom'
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value / total) * 100).toFixed(1);
              return `${label}: ${value} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

async function loadRecentEvents() {
  const container = document.getElementById('recentEventsContainer');

  try {
    const response = await api.getWAFEvents({ limit: 10, offset: 0 });
    recentEvents = response.events || [];

    if (recentEvents.length === 0) {
      container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
          <p>No WAF events recorded yet</p>
          <small>Events will appear here as attacks are detected</small>
        </div>
      `;
      return;
    }

    let html = `
      <div class="event-row header">
        <div>Timestamp</div>
        <div>Client IP</div>
        <div>Target Host</div>
        <div>Request</div>
        <div>Attack Type</div>
        <div>HTTP Status</div>
        <div>Severity</div>
        <div>Status</div>
      </div>
    `;

    recentEvents.forEach(event => {
      html += createEventRow(event);
    });

    container.innerHTML = html;

  } catch (error) {
    console.error('Error loading recent events:', error);
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--danger-color);">
        Failed to load recent events
      </div>
    `;
  }
}

function createEventRow(event, isNew = false) {
  const eventDate = new Date(event.timestamp);

  // Format timestamp with full details including seconds
  const timestamp = eventDate.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  // Calculate relative time
  const now = new Date();
  const diffMs = now - eventDate;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let relativeTime;
  if (diffMs < 5000) relativeTime = 'just now';
  else if (diffMs < 60000) relativeTime = `${Math.floor(diffMs / 1000)}s ago`;
  else if (diffMins < 60) relativeTime = `${diffMins}m ago`;
  else if (diffHours < 24) relativeTime = `${diffHours}h ago`;
  else relativeTime = `${diffDays}d ago`;

  const request = `${event.request_method || 'GET'} ${event.request_uri || '/'}`;
  const severityClass = `severity-${event.severity?.toLowerCase() || 'notice'}`;
  const statusClass = event.blocked ? 'status-blocked' : 'status-logged';
  const statusText = event.blocked ? 'Blocked' : 'Allowed';

  // Extract target host from raw_log (Host header) for accurate attack target display
  let targetHost = 'Unknown';
  try {
    if (event.raw_log) {
      const rawLog = typeof event.raw_log === 'string' ? JSON.parse(event.raw_log) : event.raw_log;
      const hostHeader = rawLog?.transaction?.request?.headers?.Host || rawLog?.transaction?.request?.headers?.host;
      if (hostHeader) {
        targetHost = hostHeader;
      } else {
        // Fallback to proxy_name/domain_names if Host header not available
        targetHost = event.domain_names || event.proxy_name || 'Unknown';
      }
    } else {
      targetHost = event.domain_names || event.proxy_name || 'Unknown';
    }
  } catch (e) {
    // If parsing fails, fall back to proxy_name/domain_names
    targetHost = event.domain_names || event.proxy_name || 'Unknown';
  }
  const displayHost = targetHost.split(',')[0].trim(); // Show first domain if multiple

  // HTTP status with color coding
  const httpStatus = event.http_status || '-';
  let httpStatusColor = 'var(--text-secondary)';
  if (httpStatus !== '-') {
    const statusCode = parseInt(httpStatus);
    if (statusCode >= 200 && statusCode < 300) httpStatusColor = 'var(--success-color)';
    else if (statusCode >= 300 && statusCode < 400) httpStatusColor = 'var(--primary-color)';
    else if (statusCode >= 400 && statusCode < 500) httpStatusColor = 'var(--warning-color)';
    else if (statusCode >= 500) httpStatusColor = 'var(--danger-color)';
  }

  return `
    <div class="event-row ${isNew ? 'new-event' : ''}" data-event-id="${event.id}">
      <div style="font-size: 12px; color: var(--text-secondary);" title="${timestamp}">
        <div style="font-weight: 500;">${relativeTime}</div>
        <div style="font-size: 10px; opacity: 0.8;">${timestamp}</div>
      </div>
      <div style="font-family: monospace; font-size: 12px;">${escapeHtml(event.client_ip)}</div>
      <div style="font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(targetHost)}">
        ${escapeHtml(displayHost)}
      </div>
      <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(request)}">
        ${escapeHtml(request)}
      </div>
      <div>${escapeHtml(event.attack_type || 'Unknown')}</div>
      <div style="font-family: monospace; font-weight: 600; color: ${httpStatusColor};">${httpStatus}</div>
      <div><span class="severity-badge ${severityClass}">${event.severity || 'NOTICE'}</span></div>
      <div><span class="status-badge ${statusClass}">${statusText}</span></div>
    </div>
  `;
}

function renderTopIPs(topIPs) {
  const container = document.getElementById('topIPsContainer');

  if (!topIPs || topIPs.length === 0) {
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
        <p>No attacking IPs detected</p>
      </div>
    `;
    return;
  }

  let html = '';
  topIPs.forEach(item => {
    html += `
      <div class="ip-row">
        <div class="ip-info">
          <div class="ip-address">${escapeHtml(item.client_ip)}</div>
          <div class="ip-count">${item.count} attacks</div>
        </div>
        <button class="btn-block-ip" data-ip="${escapeHtml(item.client_ip)}">🚫 Block</button>
      </div>
    `;
  });

  container.innerHTML = html;

  // Add event listeners to block buttons
  container.querySelectorAll('.btn-block-ip').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ip = btn.dataset.ip;
      if (!confirm(`Block all traffic from ${ip}?`)) return;

      try {
        // TODO: Implement IP blocking via security rules API
        alert(`IP blocking feature coming soon. IP: ${ip}`);
      } catch (error) {
        alert(`Failed to block IP: ${error.message}`);
      }
    });
  });
}

function setupEventListeners() {
  // Time range selector
  document.getElementById('timeRangeSelect').addEventListener('change', async (e) => {
    currentTimeRange = e.target.value;
    await refreshStats();
  });

  // Refresh button
  document.getElementById('refreshStatsBtn').addEventListener('click', async () => {
    await refreshStats();
  });

  // Manage profiles button
  document.getElementById('manageProfilesBtn').addEventListener('click', () => {
    window.location.hash = '#/waf/profiles';
  });

  // Export CSV button
  document.getElementById('exportCsvBtn').addEventListener('click', async () => {
    await exportEventsToCSV();
  });

  // Update relative timestamps every 30 seconds
  setInterval(() => {
    const recentEventsContainer = document.getElementById('recentEventsContainer');
    if (recentEventsContainer) {
      const eventRows = recentEventsContainer.querySelectorAll('.event-row:not(.header)');
      // Just reload recent events to refresh timestamps
      loadRecentEvents();
    }
  }, 30000);
}

async function refreshStats() {
  try {
    stats = await api.getWAFStats(parseInt(currentTimeRange));

    // Update overview cards
    document.getElementById('totalEvents').textContent = stats.total_events || 0;
    document.getElementById('blockedAttacks').textContent = stats.blocked_attacks || 0;
    document.getElementById('activeProfiles').textContent = stats.active_profiles || 0;
    document.getElementById('topAttackType').textContent = getTopAttackType(stats.by_type);

    // Update percentage
    const blockedCard = document.getElementById('blockedAttacks').closest('.stat-card');
    const changeDiv = blockedCard.querySelector('.stat-change');
    changeDiv.textContent = `${calculatePercentage(stats.blocked_attacks, stats.total_events)}% of total`;

    const topAttackCard = document.getElementById('topAttackType').closest('.stat-card');
    const topChangeDiv = topAttackCard.querySelector('.stat-change');
    topChangeDiv.textContent = `${getTopAttackCount(stats.by_type)} occurrences`;

    // Update charts
    renderTimelineChart(stats.timeline);
    renderDistributionChart(stats.by_type);

    // Update top IPs
    renderTopIPs(stats.top_ips);

    // Reload recent events
    await loadRecentEvents();

  } catch (error) {
    console.error('Error refreshing stats:', error);
    alert(`Failed to refresh statistics: ${error.message}`);
  }
}

async function exportEventsToCSV() {
  try {
    const response = await api.getWAFEvents({ limit: 10000 });
    const events = response.events || [];

    if (events.length === 0) {
      alert('No events to export');
      return;
    }

    // Create CSV content
    const headers = ['Timestamp', 'Client IP', 'Proxy', 'Method', 'URI', 'Attack Type', 'Rule ID', 'Severity', 'Blocked'];
    let csv = headers.join(',') + '\n';

    events.forEach(event => {
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

      const row = [
        event.timestamp,
        event.client_ip,
        targetHost,
        event.request_method || 'GET',
        `"${(event.request_uri || '').replace(/"/g, '""')}"`,
        event.attack_type || 'Unknown',
        event.rule_id || '',
        event.severity || 'NOTICE',
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

function startRealtimeUpdates() {
  try {
    eventSource = api.createWAFEventStream();

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        if (data.type === 'waf_event' && data.event) {
          handleNewEvent(data.event);
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);

      // Update live indicator
      const indicator = document.getElementById('liveIndicator');
      if (indicator) {
        indicator.style.background = '#ffebee';
        indicator.style.color = '#c62828';
        indicator.querySelector('.live-dot').style.background = '#f44336';
        indicator.querySelector('span:last-child').textContent = 'DISCONNECTED';
      }

      // Attempt reconnect after 5 seconds
      setTimeout(() => {
        if (eventSource && eventSource.readyState === EventSource.CLOSED) {
          console.log('Attempting to reconnect SSE...');
          startRealtimeUpdates();
        }
      }, 5000);
    };

    eventSource.onopen = () => {
      console.log('SSE connection established');

      // Update live indicator
      const indicator = document.getElementById('liveIndicator');
      if (indicator) {
        indicator.style.background = '#e8f5e9';
        indicator.style.color = '#2e7d32';
        indicator.querySelector('.live-dot').style.background = '#4caf50';
        indicator.querySelector('span:last-child').textContent = 'LIVE';
      }
    };

  } catch (error) {
    console.error('Error starting real-time updates:', error);
  }
}

function handleNewEvent(event) {
  // Update counters
  if (stats) {
    stats.total_events = (stats.total_events || 0) + 1;
    if (event.blocked) {
      stats.blocked_attacks = (stats.blocked_attacks || 0) + 1;
    }

    // Update overview cards
    document.getElementById('totalEvents').textContent = stats.total_events;
    document.getElementById('blockedAttacks').textContent = stats.blocked_attacks;

    const blockedCard = document.getElementById('blockedAttacks').closest('.stat-card');
    const changeDiv = blockedCard.querySelector('.stat-change');
    changeDiv.textContent = `${calculatePercentage(stats.blocked_attacks, stats.total_events)}% of total`;
  }

  // Add to recent events table
  const container = document.getElementById('recentEventsContainer');
  const headerRow = container.querySelector('.event-row.header');

  if (headerRow) {
    const newRow = createEventRow(event, true);
    headerRow.insertAdjacentHTML('afterend', newRow);

    // Keep only last 10 events
    const eventRows = container.querySelectorAll('.event-row:not(.header)');
    if (eventRows.length > 10) {
      eventRows[eventRows.length - 1].remove();
    }
  }

  // Flash live indicator
  const indicator = document.getElementById('liveIndicator');
  if (indicator) {
    indicator.style.transform = 'scale(1.1)';
    setTimeout(() => {
      indicator.style.transform = 'scale(1)';
    }, 200);
  }
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

export function cleanupWAFDashboard() {
  // Close SSE connection
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  // Destroy Chart.js instances
  if (timelineChart) {
    timelineChart.destroy();
    timelineChart = null;
  }

  if (distributionChart) {
    distributionChart.destroy();
    distributionChart = null;
  }

  console.log('WAF Dashboard cleaned up');
}
