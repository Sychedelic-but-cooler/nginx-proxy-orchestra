/**
 * Migration: System Metrics History
 * Creates table for storing historical system metrics data
 */

const { db } = require('../db');

function up() {
  console.log('Creating system_metrics table...');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      
      -- CPU metrics
      cpu_usage REAL NOT NULL,
      load_1min REAL NOT NULL,
      load_5min REAL NOT NULL,
      load_15min REAL NOT NULL,
      
      -- Memory metrics (in bytes)
      memory_total INTEGER NOT NULL,
      memory_used INTEGER NOT NULL,
      memory_free INTEGER NOT NULL,
      memory_percent REAL NOT NULL,
      
      -- Swap metrics (in bytes)
      swap_total INTEGER NOT NULL,
      swap_used INTEGER NOT NULL,
      swap_free INTEGER NOT NULL,
      swap_percent REAL NOT NULL,
      
      -- Disk metrics (in bytes)
      disk_total INTEGER NOT NULL,
      disk_used INTEGER NOT NULL,
      disk_available INTEGER NOT NULL,
      disk_percent REAL NOT NULL,
      
      -- Network metrics (in bytes)
      network_rx_total INTEGER NOT NULL,
      network_tx_total INTEGER NOT NULL,
      network_rx_rate REAL NOT NULL,
      network_tx_rate REAL NOT NULL,
      
      -- Disk I/O metrics
      disk_reads_total INTEGER NOT NULL,
      disk_writes_total INTEGER NOT NULL,
      disk_reads_per_sec REAL NOT NULL,
      disk_writes_per_sec REAL NOT NULL,
      
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create index on timestamp for efficient queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp 
    ON system_metrics(timestamp DESC)
  `);

  // Create index on created_at for cleanup queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_system_metrics_created_at 
    ON system_metrics(created_at DESC)
  `);

  console.log('system_metrics table created successfully');
}

function down() {
  console.log('Dropping system_metrics table...');
  
  db.exec('DROP INDEX IF EXISTS idx_system_metrics_created_at');
  db.exec('DROP INDEX IF EXISTS idx_system_metrics_timestamp');
  db.exec('DROP TABLE IF EXISTS system_metrics');
  
  console.log('system_metrics table dropped successfully');
}

module.exports = { up, down };
