import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess, setHeader } from '../app.js';

let refreshInterval = null;
let stubStatusData = null;
let previousData = null;

export async function renderNginxPerformance(container) {
  setHeader('Nginx Performance Monitor');
  showLoading();

  try {
    // Fetch initial data
    const result = await api.getStubStatus();
    stubStatusData = result;

    if (!result.success || !result.configured) {
      renderSetupInstructions(container, result);
      return;
    }

    renderPerformanceDashboard(container, result);
    startAutoRefresh(container);

  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <h2>Failed to load nginx performance metrics</h2>
        <p style="color: var(--text-secondary);">${error.message}</p>
      </div>
    `;
    showError(error.message);
  } finally {
    hideLoading();
  }
}

function renderSetupInstructions(container, result) {
  hideLoading();
  
  container.innerHTML = `
    <div class="card" style="max-width: 900px; margin: 0 auto;">
      <div class="card-header">
        <h3 class="card-title">Setup Required: Enable Nginx stub_status Module</h3>
      </div>
      <div style="padding: 24px;">
        <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 16px; border-radius: 4px; margin-bottom: 24px;">
          <strong>⚠️ stub_status Not Configured</strong>
          <p style="margin: 8px 0 0 0; color: #856404;">
            ${result.error || 'The nginx stub_status module is not accessible. Follow the setup instructions below to enable real-time performance monitoring.'}
          </p>
        </div>

        <h4 style="margin-top: 24px; margin-bottom: 12px;">What is stub_status?</h4>
        <p style="color: var(--text-secondary); margin-bottom: 20px;">
          The <code>stub_status</code> module provides real-time metrics about nginx performance, including active connections, 
          requests per second, connection states, and more. This is essential for monitoring nginx health and performance.
        </p>

        <h4 style="margin-top: 24px; margin-bottom: 12px;">Setup Instructions</h4>
        
        <div style="background: var(--card-bg); padding: 16px; border-radius: 4px; border: 1px solid var(--border-color); margin-bottom: 16px;">
          <h5 style="margin-top: 0;">Step 1: Check if stub_status is compiled</h5>
          <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 12px;">
            Run this command to verify the module is available:
          </p>
          <pre style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px; overflow-x: auto;"><code>nginx -V 2>&1 | grep -o with-http_stub_status_module</code></pre>
          <p style="color: var(--text-secondary); font-size: 14px; margin-top: 12px;">
            If you see <code>with-http_stub_status_module</code>, the module is available. If not, you'll need to recompile nginx or install a version with the module included.
          </p>
        </div>

        <div style="background: var(--card-bg); padding: 16px; border-radius: 4px; border: 1px solid var(--border-color); margin-bottom: 16px;">
          <h5 style="margin-top: 0;">Step 2: Add stub_status location to nginx config</h5>
          <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 12px;">
            Edit your nginx configuration (typically <code>/etc/nginx/nginx.conf</code> or <code>/etc/nginx/conf.d/default.conf</code>) and add this location block in the <code>server</code> section:
          </p>
          <pre style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px; overflow-x: auto;"><code>server {
    listen 80;
    server_name localhost;

    # Add this location block
    location /nginx_status {
        stub_status on;
        access_log off;
        allow 127.0.0.1;
        deny all;
    }

    # ... rest of your config
}</code></pre>
          <p style="color: var(--text-secondary); font-size: 14px; margin-top: 12px;">
            <strong>Note:</strong> This configuration only allows access from localhost (127.0.0.1) for security. Do not expose this endpoint publicly!
          </p>
        </div>

        <div style="background: var(--card-bg); padding: 16px; border-radius: 4px; border: 1px solid var(--border-color); margin-bottom: 16px;">
          <h5 style="margin-top: 0;">Step 3: Test and reload nginx</h5>
          <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 12px;">
            Test your configuration for syntax errors:
          </p>
          <pre style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px; overflow-x: auto;"><code>sudo nginx -t</code></pre>
          <p style="color: var(--text-secondary); font-size: 14px; margin-top: 12px; margin-bottom: 12px;">
            If the test passes, reload nginx:
          </p>
          <pre style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px; overflow-x: auto;"><code>sudo systemctl reload nginx</code></pre>
        </div>

        <div style="background: var(--card-bg); padding: 16px; border-radius: 4px; border: 1px solid var(--border-color); margin-bottom: 16px;">
          <h5 style="margin-top: 0;">Step 4: Verify stub_status is working</h5>
          <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 12px;">
            Test the endpoint from the command line:
          </p>
          <pre style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px; overflow-x: auto;"><code>curl http://127.0.0.1/nginx_status</code></pre>
          <p style="color: var(--text-secondary); font-size: 14px; margin-top: 12px;">
            You should see output like:
          </p>
          <pre style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 4px; overflow-x: auto;"><code>Active connections: 291
server accepts handled requests
 16630948 16630948 31070465
Reading: 6 Writing: 179 Waiting: 106</code></pre>
        </div>

        <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 16px; border-radius: 4px; margin-top: 24px;">
          <strong>✓ Custom stub_status URL</strong>
          <p style="margin: 8px 0 0 0; color: #065f46;">
            If you configured stub_status at a different URL, set the <code>STUB_STATUS_URL</code> environment variable in your <code>.env</code> file:
          </p>
          <pre style="background: rgba(0,0,0,0.1); padding: 8px; border-radius: 4px; margin-top: 8px; font-size: 13px;"><code>STUB_STATUS_URL=http://127.0.0.1:8080/status</code></pre>
        </div>

        <div style="margin-top: 24px; text-align: center;">
          <button class="btn btn-primary" id="retryStubStatus">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Retry Connection
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('retryStubStatus')?.addEventListener('click', async () => {
    await renderNginxPerformance(container);
  });
}

function renderPerformanceDashboard(container, result) {
  const data = result.data;
  const timestamp = new Date(result.timestamp).toLocaleTimeString();

  // Calculate rates if we have previous data
  let requestRate = 0;
  let connectionRate = 0;
  
  if (previousData && result.timestamp > previousData.timestamp) {
    const timeDiff = (result.timestamp - previousData.timestamp) / 1000; // seconds
    requestRate = ((data.requests - previousData.data.requests) / timeDiff).toFixed(2);
    connectionRate = ((data.accepts - previousData.data.accepts) / timeDiff).toFixed(2);
  }

  container.innerHTML = `
    <!-- Auto-refresh indicator -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <div class="info-banner" style="background: #d1fae5; border-left: 4px solid #10b981; padding: 12px 16px; border-radius: 4px; flex: 1; margin-right: 16px;">
        <strong>✓ Real-Time Monitoring:</strong> Performance metrics refresh automatically every 5 seconds. Last update: ${timestamp}
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="pauseRefresh" class="btn btn-secondary" style="padding: 8px 16px; font-size: 14px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
          Pause
        </button>
        <button id="refreshNow" class="btn btn-primary" style="padding: 8px 16px; font-size: 14px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
          Refresh
        </button>
      </div>
    </div>

    <!-- Key Metrics -->
    <div class="grid grid-4" style="margin-bottom: 30px;">
      <div class="stat-card">
        <div class="stat-value" style="color: var(--primary-color);">${data.active}</div>
        <div class="stat-label">Active Connections</div>
        <small style="color: var(--text-secondary); display: block; margin-top: 8px;">
          Current open connections
        </small>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: var(--success-color);">${data.requests.toLocaleString()}</div>
        <div class="stat-label">Total Requests</div>
        <small style="color: var(--text-secondary); display: block; margin-top: 8px;">
          ${requestRate > 0 ? `${requestRate} req/sec` : 'Since nginx started'}
        </small>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: var(--warning-color);">${data.requestsPerConnection}</div>
        <div class="stat-label">Requests/Connection</div>
        <small style="color: var(--text-secondary); display: block; margin-top: 8px;">
          Average reuse rate
        </small>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: ${data.handledPercentage === '100.00' ? 'var(--success-color)' : 'var(--danger-color)'};">${data.handledPercentage}%</div>
        <div class="stat-label">Handled Percentage</div>
        <small style="color: var(--text-secondary); display: block; margin-top: 8px;">
          ${data.handled.toLocaleString()} / ${data.accepts.toLocaleString()} connections
        </small>
      </div>
    </div>

    <!-- Connection States -->
    <div class="card" style="margin-bottom: 20px;">
      <div class="card-header">
        <h3 class="card-title">Connection States</h3>
      </div>
      <div style="padding: 20px;">
        <div class="grid grid-3">
          <div style="text-align: center; padding: 20px; background: var(--bg-color); border-radius: 8px;">
            <div style="font-size: 48px; font-weight: 700; color: #3b82f6; margin-bottom: 8px;">${data.reading}</div>
            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Reading</div>
            <div style="font-size: 12px; color: var(--text-secondary);">Requests being read</div>
          </div>
          <div style="text-align: center; padding: 20px; background: var(--bg-color); border-radius: 8px;">
            <div style="font-size: 48px; font-weight: 700; color: #10b981; margin-bottom: 8px;">${data.writing}</div>
            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Writing</div>
            <div style="font-size: 12px; color: var(--text-secondary);">Responses being written</div>
          </div>
          <div style="text-align: center; padding: 20px; background: var(--bg-color); border-radius: 8px;">
            <div style="font-size: 48px; font-weight: 700; color: #f59e0b; margin-bottom: 8px;">${data.waiting}</div>
            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">Waiting</div>
            <div style="font-size: 12px; color: var(--text-secondary);">Keep-alive connections</div>
          </div>
        </div>

        <!-- Visual representation -->
        <div style="margin-top: 24px;">
          <div style="display: flex; height: 40px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border-color);">
            ${renderConnectionBar(data)}
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 12px; font-size: 13px; color: var(--text-secondary);">
            <span>Total: ${data.active} active connections</span>
            <span>${connectionRate > 0 ? `${connectionRate} conn/sec` : ''}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Performance Metrics Grid -->
    <div class="grid grid-2" style="margin-bottom: 20px;">
      <!-- Server Statistics -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Server Statistics</h3>
        </div>
        <div style="padding: 20px;">
          <table class="table">
            <tbody>
              <tr>
                <td style="font-weight: 500;">Total Accepts</td>
                <td style="text-align: right; font-family: 'Courier New', monospace; font-size: 14px;">${data.accepts.toLocaleString()}</td>
              </tr>
              <tr>
                <td style="font-weight: 500;">Total Handled</td>
                <td style="text-align: right; font-family: 'Courier New', monospace; font-size: 14px;">${data.handled.toLocaleString()}</td>
              </tr>
              <tr>
                <td style="font-weight: 500;">Total Requests</td>
                <td style="text-align: right; font-family: 'Courier New', monospace; font-size: 14px;">${data.requests.toLocaleString()}</td>
              </tr>
              <tr>
                <td style="font-weight: 500;">Dropped Connections</td>
                <td style="text-align: right; font-family: 'Courier New', monospace; font-size: 14px; color: ${data.accepts - data.handled > 0 ? 'var(--danger-color)' : 'var(--success-color)'};">
                  ${(data.accepts - data.handled).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Performance Insights -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Performance Insights</h3>
        </div>
        <div style="padding: 20px;">
          ${generatePerformanceInsights(data, requestRate, connectionRate)}
        </div>
      </div>
    </div>

    <!-- About stub_status -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">About These Metrics</h3>
      </div>
      <div style="padding: 20px;">
        <div class="grid grid-2">
          <div>
            <h4 style="margin-top: 0; font-size: 14px; color: var(--text-primary);">Connection States</h4>
            <ul style="font-size: 13px; color: var(--text-secondary); line-height: 1.8;">
              <li><strong>Reading:</strong> Nginx is reading the request header from the client</li>
              <li><strong>Writing:</strong> Nginx is writing the response back to the client</li>
              <li><strong>Waiting:</strong> Keep-alive connections waiting for new requests</li>
            </ul>
          </div>
          <div>
            <h4 style="margin-top: 0; font-size: 14px; color: var(--text-primary);">Server Metrics</h4>
            <ul style="font-size: 13px; color: var(--text-secondary); line-height: 1.8;">
              <li><strong>Accepts:</strong> Total connection attempts</li>
              <li><strong>Handled:</strong> Successfully handled connections</li>
              <li><strong>Requests:</strong> Total HTTP requests processed</li>
              <li><strong>Requests/Connection:</strong> HTTP keep-alive efficiency</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `;

  setupPerformanceHandlers(container);
  previousData = result;
}

function renderConnectionBar(data) {
  const total = data.active;
  if (total === 0) {
    return '<div style="flex: 1; background: var(--bg-color); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); font-size: 13px;">No active connections</div>';
  }

  const readingPercent = (data.reading / total) * 100;
  const writingPercent = (data.writing / total) * 100;
  const waitingPercent = (data.waiting / total) * 100;

  return `
    ${data.reading > 0 ? `<div style="flex: ${readingPercent}; background: #3b82f6; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 600;" title="${data.reading} reading (${readingPercent.toFixed(1)}%)">${data.reading > 5 ? data.reading : ''}</div>` : ''}
    ${data.writing > 0 ? `<div style="flex: ${writingPercent}; background: #10b981; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 600;" title="${data.writing} writing (${writingPercent.toFixed(1)}%)">${data.writing > 5 ? data.writing : ''}</div>` : ''}
    ${data.waiting > 0 ? `<div style="flex: ${waitingPercent}; background: #f59e0b; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 600;" title="${data.waiting} waiting (${waitingPercent.toFixed(1)}%)">${data.waiting > 5 ? data.waiting : ''}</div>` : ''}
  `;
}

function generatePerformanceInsights(data, requestRate, connectionRate) {
  const insights = [];

  // Check if connections are being dropped
  const droppedConnections = data.accepts - data.handled;
  if (droppedConnections > 0) {
    const dropRate = (droppedConnections / data.accepts) * 100;
    insights.push(`
      <div style="padding: 12px; background: #fee2e2; border-left: 3px solid var(--danger-color); border-radius: 4px; margin-bottom: 12px;">
        <strong>⚠️ Connections Dropped:</strong> ${droppedConnections.toLocaleString()} connections (${dropRate.toFixed(2)}%) were dropped. This may indicate resource constraints or configuration limits.
      </div>
    `);
  } else {
    insights.push(`
      <div style="padding: 12px; background: #d1fae5; border-left: 3px solid var(--success-color); border-radius: 4px; margin-bottom: 12px;">
        <strong>✓ No Dropped Connections:</strong> All connection attempts are being handled successfully.
      </div>
    `);
  }

  // Check keep-alive efficiency
  const keepAliveRatio = parseFloat(data.requestsPerConnection);
  if (keepAliveRatio > 10) {
    insights.push(`
      <div style="padding: 12px; background: #d1fae5; border-left: 3px solid var(--success-color); border-radius: 4px; margin-bottom: 12px;">
        <strong>✓ Excellent Keep-Alive:</strong> ${keepAliveRatio} requests per connection. HTTP keep-alive is working efficiently.
      </div>
    `);
  } else if (keepAliveRatio < 2) {
    insights.push(`
      <div style="padding: 12px; background: #fef3c7; border-left: 3px solid var(--warning-color); border-radius: 4px; margin-bottom: 12px;">
        <strong>⚠️ Low Keep-Alive Efficiency:</strong> Only ${keepAliveRatio} requests per connection. Consider tuning keep-alive settings.
      </div>
    `);
  }

  // Check waiting connections ratio
  if (data.active > 0) {
    const waitingRatio = (data.waiting / data.active) * 100;
    if (waitingRatio > 80) {
      insights.push(`
        <div style="padding: 12px; background: #e3f2fd; border-left: 3px solid var(--primary-color); border-radius: 4px; margin-bottom: 12px;">
          <strong>ℹ️ High Keep-Alive Usage:</strong> ${waitingRatio.toFixed(0)}% of connections are in keep-alive state. This is normal for idle periods.
        </div>
      `);
    }
  }

  // Performance rates
  if (requestRate > 0) {
    insights.push(`
      <div style="padding: 12px; background: #e3f2fd; border-left: 3px solid var(--primary-color); border-radius: 4px; margin-bottom: 12px;">
        <strong>📊 Current Rate:</strong> ${requestRate} requests/sec, ${connectionRate} connections/sec
      </div>
    `);
  }

  if (insights.length === 0) {
    return `<p style="color: var(--text-secondary);">Everything looks good! Monitor these metrics over time to identify performance patterns.</p>`;
  }

  return insights.join('');
}

function setupPerformanceHandlers(container) {
  let isPaused = false;

  document.getElementById('pauseRefresh')?.addEventListener('click', (e) => {
    isPaused = !isPaused;
    const btn = e.target.closest('button');
    
    if (isPaused) {
      stopAutoRefresh();
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Resume
      `;
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-warning');
      showSuccess('Auto-refresh paused');
    } else {
      startAutoRefresh(container);
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        Pause
      `;
      btn.classList.remove('btn-warning');
      btn.classList.add('btn-secondary');
      showSuccess('Auto-refresh resumed');
    }
  });

  document.getElementById('refreshNow')?.addEventListener('click', async () => {
    try {
      const result = await api.getStubStatus();
      if (result.success && result.configured) {
        renderPerformanceDashboard(container, result);
        showSuccess('Metrics refreshed');
      }
    } catch (error) {
      showError('Failed to refresh metrics');
    }
  });
}

function startAutoRefresh(container) {
  stopAutoRefresh();
  
  refreshInterval = setInterval(async () => {
    try {
      const result = await api.getStubStatus();
      if (result.success && result.configured) {
        renderPerformanceDashboard(container, result);
      }
    } catch (error) {
      console.error('Auto-refresh error:', error);
    }
  }, 5000); // Refresh every 5 seconds
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// Clean up when leaving the page
export function cleanupPerformanceMonitor() {
  stopAutoRefresh();
  previousData = null;
  stubStatusData = null;
}
