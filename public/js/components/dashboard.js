import api from '../api.js';
import { showLoading, hideLoading, showError } from '../app.js';

// State for real-time monitoring
let refreshInterval = null;
let cpuChart = null;
let networkChart = null;
let diskIOChart = null;
let staticInfo = null;

// Chart data buffers (keep last 60 seconds)
const MAX_DATA_POINTS = 60;
let cpuData = [];
let networkRxData = [];
let networkTxData = [];
let diskReadsData = [];
let diskWritesData = [];
let timeLabels = [];

export async function renderDashboard(container) {
  showLoading();

  try {
    // Fetch static system info once
    staticInfo = await api.getStaticSystemInfo();
    
    // Initial render with static info
    container.innerHTML = `
      <div class="server-dashboard">
        <!-- Row 1: Server Info, Memory & Storage, Network -->
        <div class="dashboard-grid dashboard-grid-3">
          <!-- Server Info Card -->
          <div class="dashboard-card">
            <div class="card-header">
              <h3>Server Info</h3>
            </div>
            <div class="card-body server-info-body">
              <div class="info-row">
                <span class="info-label">Hostname</span>
                <span class="info-value">${staticInfo.hostname}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Operating System</span>
                <span class="info-value">${staticInfo.os}</span>
              </div>
              <div class="info-row">
                <span class="info-label">CPU</span>
                <span class="info-value">${staticInfo.cpu.model}</span>
              </div>
              <div class="info-row">
                <span class="info-label">CPU Cores</span>
                <span class="info-value">${staticInfo.cpu.cores} cores @ ${staticInfo.cpu.speed} MHz</span>
              </div>
              <div class="info-row" id="uptime-display">
                <span class="info-label">Uptime</span>
                <span class="info-value">Loading...</span>
              </div>
              <div class="info-row" id="load-display">
                <span class="info-label">Load Average</span>
                <span class="info-value">Loading...</span>
              </div>
            </div>
          </div>

          <!-- Memory & Storage Card -->
          <div class="dashboard-card">
            <div class="card-header">
              <h3>Memory & Storage</h3>
            </div>
            <div class="card-body gauges-body">
              <div class="gauge-container">
                <canvas id="memoryGauge" width="180" height="180"></canvas>
                <div class="gauge-label">Memory</div>
                <div class="gauge-value" id="memory-value">0%</div>
              </div>
              <div class="gauge-container">
                <canvas id="swapGauge" width="180" height="180"></canvas>
                <div class="gauge-label">Swap</div>
                <div class="gauge-value" id="swap-value">0%</div>
              </div>
              <div class="gauge-container">
                <canvas id="storageGauge" width="180" height="180"></canvas>
                <div class="gauge-label">Storage</div>
                <div class="gauge-value" id="storage-value">0%</div>
              </div>
            </div>
          </div>

          <!-- Network Card -->
          <div class="dashboard-card">
            <div class="card-header">
              <h3>Network</h3>
            </div>
            <div class="card-body network-stats">
              <div class="network-stat">
                <div class="network-icon">↓</div>
                <div class="network-info">
                  <div class="network-label">Receive</div>
                  <div class="network-value" id="network-rx">0 B/s</div>
                </div>
              </div>
              <div class="network-stat">
                <div class="network-icon">↑</div>
                <div class="network-info">
                  <div class="network-label">Send</div>
                  <div class="network-value" id="network-tx">0 B/s</div>
                </div>
              </div>
              <div class="network-totals">
                <div class="network-total-item">
                  <span>Total RX:</span>
                  <span id="network-rx-total">0 B</span>
                </div>
                <div class="network-total-item">
                  <span>Total TX:</span>
                  <span id="network-tx-total">0 B</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Row 2: Real-time Charts -->
        <div class="dashboard-grid dashboard-grid-3" style="margin-top: 20px;">
          <!-- CPU Utilization Chart -->
          <div class="dashboard-card">
            <div class="card-header">
              <h3>CPU Utilization</h3>
              <span class="chart-subtitle">Real-time (60s)</span>
            </div>
            <div class="card-body">
              <canvas id="cpuChart" width="400" height="200"></canvas>
            </div>
          </div>

          <!-- Network Send/Receive Chart -->
          <div class="dashboard-card">
            <div class="card-header">
              <h3>Network Traffic</h3>
              <span class="chart-subtitle">Real-time (60s)</span>
            </div>
            <div class="card-body">
              <canvas id="networkChart" width="400" height="200"></canvas>
            </div>
          </div>

          <!-- Disk I/O Chart -->
          <div class="dashboard-card">
            <div class="card-header">
              <h3>Disk I/O</h3>
              <span class="chart-subtitle">Real-time (60s)</span>
            </div>
            <div class="card-body">
              <canvas id="diskIOChart" width="400" height="200"></canvas>
            </div>
          </div>
        </div>
      </div>
    `;

    // Initialize charts
    initializeCharts();

    // Load historical data first
    await loadHistoricalData();

    // Start real-time updates
    await updateMetrics(); // First update
    startAutoRefresh();

  } catch (error) {
    showError(error.message);
    container.innerHTML = '<div class="empty-state"><h2>Failed to load dashboard</h2></div>';
  } finally {
    hideLoading();
  }
}

/**
 * Load historical metrics data to populate charts initially
 */
async function loadHistoricalData() {
  try {
    const response = await api.getHistoricalMetrics(60); // Last 60 minutes
    const historicalMetrics = response.metrics || [];
    
    if (historicalMetrics.length === 0) {
      console.log('No historical data available yet');
      return;
    }
    
    // Populate chart data from historical records
    historicalMetrics.forEach(metric => {
      const time = new Date(metric.timestamp).toLocaleTimeString();
      
      timeLabels.push(time);
      cpuData.push(metric.cpu_usage || 0);
      networkRxData.push(((metric.network_rx_rate || 0) / 1024).toFixed(2)); // Convert to KB/s
      networkTxData.push(((metric.network_tx_rate || 0) / 1024).toFixed(2));
      diskReadsData.push((metric.disk_reads_per_sec || 0).toFixed(2));
      diskWritesData.push((metric.disk_writes_per_sec || 0).toFixed(2));
    });
    
    // Keep only last 60 data points
    while (timeLabels.length > MAX_DATA_POINTS) {
      timeLabels.shift();
      cpuData.shift();
      networkRxData.shift();
      networkTxData.shift();
      diskReadsData.shift();
      diskWritesData.shift();
    }
    
    // Update charts with historical data
    if (cpuChart) cpuChart.update('none');
    if (networkChart) networkChart.update('none');
    if (diskIOChart) diskIOChart.update('none');
    
    console.log(`Loaded ${historicalMetrics.length} historical data points`);
  } catch (error) {
    console.error('Failed to load historical data:', error);
    // Continue without historical data
  }
}

/**
 * Initialize Chart.js charts
 */
function initializeCharts() {
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        display: true,
        position: 'top'
      }
    },
    scales: {
      x: {
        display: true,
        grid: {
          color: 'rgba(128, 128, 128, 0.1)'
        }
      },
      y: {
        display: true,
        beginAtZero: true,
        grid: {
          color: 'rgba(128, 128, 128, 0.1)'
        }
      }
    }
  };

  // CPU Chart
  const cpuCtx = document.getElementById('cpuChart')?.getContext('2d');
  if (cpuCtx) {
    cpuChart = new Chart(cpuCtx, {
      type: 'line',
      data: {
        labels: timeLabels,
        datasets: [{
          label: 'CPU Usage (%)',
          data: cpuData,
          borderColor: '#1e293b',
          backgroundColor: 'rgba(30, 41, 59, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        ...chartOptions,
        scales: {
          ...chartOptions.scales,
          y: {
            ...chartOptions.scales.y,
            max: 100
          }
        }
      }
    });
  }

  // Network Chart
  const networkCtx = document.getElementById('networkChart')?.getContext('2d');
  if (networkCtx) {
    networkChart = new Chart(networkCtx, {
      type: 'line',
      data: {
        labels: timeLabels,
        datasets: [
          {
            label: 'Receive (KB/s)',
            data: networkRxData,
            borderColor: '#1e293b',
            backgroundColor: 'rgba(30, 41, 59, 0.1)',
            tension: 0.4,
            fill: true
          },
          {
            label: 'Send (KB/s)',
            data: networkTxData,
            borderColor: '#475569',
            backgroundColor: 'rgba(71, 85, 105, 0.1)',
            tension: 0.4,
            fill: true
          }
        ]
      },
      options: chartOptions
    });
  }

  // Disk I/O Chart
  const diskIOCtx = document.getElementById('diskIOChart')?.getContext('2d');
  if (diskIOCtx) {
    diskIOChart = new Chart(diskIOCtx, {
      type: 'line',
      data: {
        labels: timeLabels,
        datasets: [
          {
            label: 'Reads/s',
            data: diskReadsData,
            borderColor: '#1e293b',
            backgroundColor: 'rgba(30, 41, 59, 0.1)',
            tension: 0.4,
            fill: true
          },
          {
            label: 'Writes/s',
            data: diskWritesData,
            borderColor: '#475569',
            backgroundColor: 'rgba(71, 85, 105, 0.1)',
            tension: 0.4,
            fill: true
          }
        ]
      },
      options: chartOptions
    });
  }
}

/**
 * Update real-time metrics
 */
async function updateMetrics() {
  // Check if still on dashboard page
  if (!document.getElementById('cpuChart')) {
    stopAutoRefresh();
    return;
  }

  try {
    const metrics = await api.getRealTimeMetrics();

    // Update uptime
    const uptimeEl = document.querySelector('#uptime-display .info-value');
    if (uptimeEl) {
      uptimeEl.textContent = formatUptime(metrics.uptime);
    }

    // Update load average
    const loadEl = document.querySelector('#load-display .info-value');
    if (loadEl) {
      loadEl.textContent = `${metrics.loadAverage['1min'].toFixed(2)}, ${metrics.loadAverage['5min'].toFixed(2)}, ${metrics.loadAverage['15min'].toFixed(2)}`;
    }

    // Update memory gauge
    updateGauge('memoryGauge', metrics.memory.usagePercent, 'memory-value', 
                `${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}`);

    // Update swap gauge
    const swapLabel = metrics.swap.total === 0 ? 'No Swap' : 
                      `${formatBytes(metrics.swap.used)} / ${formatBytes(metrics.swap.total)}`;
    updateGauge('swapGauge', metrics.swap.usagePercent, 'swap-value', swapLabel);

    // Update storage gauge
    updateGauge('storageGauge', metrics.disk.usagePercent, 'storage-value',
                `${formatBytes(metrics.disk.used)} / ${formatBytes(metrics.disk.total)}`);

    // Update network stats
    document.getElementById('network-rx').textContent = formatBytes(metrics.network.rxRate) + '/s';
    document.getElementById('network-tx').textContent = formatBytes(metrics.network.txRate) + '/s';
    document.getElementById('network-rx-total').textContent = formatBytes(metrics.network.rx);
    document.getElementById('network-tx-total').textContent = formatBytes(metrics.network.tx);

    // Update chart data
    const currentTime = new Date().toLocaleTimeString();
    
    // Add new data point
    timeLabels.push(currentTime);
    cpuData.push(metrics.cpu.usage);
    networkRxData.push((metrics.network.rxRate / 1024).toFixed(2)); // Convert to KB/s
    networkTxData.push((metrics.network.txRate / 1024).toFixed(2));
    diskReadsData.push(metrics.diskIO.readsPerSec.toFixed(2));
    diskWritesData.push(metrics.diskIO.writesPerSec.toFixed(2));

    // Keep only last 60 data points
    if (timeLabels.length > MAX_DATA_POINTS) {
      timeLabels.shift();
      cpuData.shift();
      networkRxData.shift();
      networkTxData.shift();
      diskReadsData.shift();
      diskWritesData.shift();
    }

    // Update charts
    if (cpuChart) cpuChart.update('none');
    if (networkChart) networkChart.update('none');
    if (diskIOChart) diskIOChart.update('none');

  } catch (error) {
    console.error('Failed to update metrics:', error);
  }
}

/**
 * Draw gauge chart on canvas
 */
function updateGauge(canvasId, percentage, valueLabelId, detailText) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = 70;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw background arc
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0.75 * Math.PI, 2.25 * Math.PI);
  ctx.lineWidth = 20;
  ctx.strokeStyle = '#e2e8f0';
  ctx.stroke();

  // Draw progress arc
  const endAngle = 0.75 * Math.PI + (percentage / 100) * 1.5 * Math.PI;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0.75 * Math.PI, endAngle);
  ctx.lineWidth = 20;
  
  // Color based on percentage - using brand color with opacity variations
  if (percentage < 70) {
    ctx.strokeStyle = '#1e293b'; // Brand color - normal
  } else if (percentage < 85) {
    ctx.strokeStyle = '#475569'; // Lighter slate - warning
  } else {
    ctx.strokeStyle = '#dc2626'; // Red only for critical
  }
  ctx.stroke();

  // Draw percentage text
  ctx.fillStyle = '#333';
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${percentage.toFixed(1)}%`, centerX, centerY);

  // Update detail text
  const valueEl = document.getElementById(valueLabelId);
  if (valueEl) {
    valueEl.textContent = detailText;
  }
}

/**
 * Start auto-refresh (every second)
 */
function startAutoRefresh() {
  stopAutoRefresh();
  refreshInterval = setInterval(updateMetrics, 1000);
}

/**
 * Stop auto-refresh
 */
function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

/**
 * Cleanup function (called when navigating away)
 */
export function cleanupDashboard() {
  stopAutoRefresh();
  
  // Destroy charts
  if (cpuChart) {
    cpuChart.destroy();
    cpuChart = null;
  }
  if (networkChart) {
    networkChart.destroy();
    networkChart = null;
  }
  if (diskIOChart) {
    diskIOChart.destroy();
    diskIOChart = null;
  }

  // Clear data buffers
  cpuData = [];
  networkRxData = [];
  networkTxData = [];
  diskReadsData = [];
  diskWritesData = [];
  timeLabels = [];
  staticInfo = null;
}

/**
 * Format uptime seconds into readable format
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  
  return parts.join(' ') || '< 1m';
}

/**
 * Format bytes into human-readable format
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
