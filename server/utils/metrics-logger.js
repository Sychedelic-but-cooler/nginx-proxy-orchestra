/**
 * System Metrics Logger Service
 * Collects and stores system metrics at regular intervals
 */

const { db } = require('../db');
const { getRealTimeMetrics } = require('./system-metrics');

// Configuration
const COLLECTION_INTERVAL = 10000; // Collect every 10 seconds
const RETENTION_HOURS = 24; // Keep 24 hours of data
const CLEANUP_INTERVAL = 3600000; // Clean up old data every hour

let collectionInterval = null;
let cleanupInterval = null;

/**
 * Store current metrics in database
 */
function storeMetrics() {
  try {
    const metrics = getRealTimeMetrics();
    
    const stmt = db.prepare(`
      INSERT INTO system_metrics (
        timestamp,
        cpu_usage, load_1min, load_5min, load_15min,
        memory_total, memory_used, memory_free, memory_percent,
        swap_total, swap_used, swap_free, swap_percent,
        disk_total, disk_used, disk_available, disk_percent,
        network_rx_total, network_tx_total, network_rx_rate, network_tx_rate,
        disk_reads_total, disk_writes_total, disk_reads_per_sec, disk_writes_per_sec
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    
    stmt.run(
      metrics.timestamp,
      metrics.cpu.usage,
      metrics.loadAverage['1min'],
      metrics.loadAverage['5min'],
      metrics.loadAverage['15min'],
      metrics.memory.total,
      metrics.memory.used,
      metrics.memory.free,
      metrics.memory.usagePercent,
      metrics.swap.total,
      metrics.swap.used,
      metrics.swap.free,
      metrics.swap.usagePercent,
      metrics.disk.total,
      metrics.disk.used,
      metrics.disk.available,
      metrics.disk.usagePercent,
      metrics.network.rx,
      metrics.network.tx,
      metrics.network.rxRate,
      metrics.network.txRate,
      metrics.diskIO.reads,
      metrics.diskIO.writes,
      metrics.diskIO.readsPerSec,
      metrics.diskIO.writesPerSec
    );
    
  } catch (error) {
    console.error('Failed to store metrics:', error.message);
  }
}

/**
 * Clean up old metrics data
 */
function cleanupOldMetrics() {
  try {
    const cutoffTime = Date.now() - (RETENTION_HOURS * 60 * 60 * 1000);
    
    const result = db.prepare(`
      DELETE FROM system_metrics 
      WHERE timestamp < ?
    `).run(cutoffTime);
    
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} old metric records`);
    }
  } catch (error) {
    console.error('Failed to cleanup old metrics:', error.message);
  }
}

/**
 * Get historical metrics for a time range
 * @param {number} minutes - Number of minutes of history to retrieve
 * @returns {Array} Array of metric records
 */
function getHistoricalMetrics(minutes = 60) {
  try {
    const cutoffTime = Date.now() - (minutes * 60 * 1000);
    
    const metrics = db.prepare(`
      SELECT * FROM system_metrics 
      WHERE timestamp >= ?
      ORDER BY timestamp ASC
    `).all(cutoffTime);
    
    return metrics;
  } catch (error) {
    console.error('Failed to retrieve historical metrics:', error.message);
    return [];
  }
}

/**
 * Get aggregated metrics for a time range
 * @param {number} hours - Number of hours to aggregate
 * @returns {Object} Aggregated metrics
 */
function getAggregatedMetrics(hours = 24) {
  try {
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
    
    const stats = db.prepare(`
      SELECT 
        AVG(cpu_usage) as avg_cpu,
        MAX(cpu_usage) as max_cpu,
        MIN(cpu_usage) as min_cpu,
        AVG(memory_percent) as avg_memory,
        MAX(memory_percent) as max_memory,
        AVG(swap_percent) as avg_swap,
        MAX(swap_percent) as max_swap,
        AVG(disk_percent) as avg_disk,
        MAX(disk_percent) as max_disk,
        AVG(network_rx_rate) as avg_rx_rate,
        AVG(network_tx_rate) as avg_tx_rate,
        MAX(network_rx_rate) as max_rx_rate,
        MAX(network_tx_rate) as max_tx_rate,
        AVG(disk_reads_per_sec) as avg_disk_reads,
        AVG(disk_writes_per_sec) as avg_disk_writes,
        COUNT(*) as sample_count
      FROM system_metrics 
      WHERE timestamp >= ?
    `).get(cutoffTime);
    
    return stats || {};
  } catch (error) {
    console.error('Failed to retrieve aggregated metrics:', error.message);
    return {};
  }
}

/**
 * Start the metrics collection service
 */
function startMetricsCollection() {
  if (collectionInterval) {
    console.log('Metrics collection already running');
    return;
  }
  
  console.log(`Starting metrics collection service (interval: ${COLLECTION_INTERVAL}ms)`);
  
  // Store initial metrics immediately
  storeMetrics();
  
  // Start periodic collection
  collectionInterval = setInterval(storeMetrics, COLLECTION_INTERVAL);
  
  // Start periodic cleanup
  cleanupInterval = setInterval(cleanupOldMetrics, CLEANUP_INTERVAL);
  
  // Run initial cleanup
  cleanupOldMetrics();
}

/**
 * Stop the metrics collection service
 */
function stopMetricsCollection() {
  if (collectionInterval) {
    clearInterval(collectionInterval);
    collectionInterval = null;
    console.log('Metrics collection service stopped');
  }
  
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

module.exports = {
  startMetricsCollection,
  stopMetricsCollection,
  getHistoricalMetrics,
  getAggregatedMetrics,
  storeMetrics
};
