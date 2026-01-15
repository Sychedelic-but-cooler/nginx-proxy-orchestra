/**
 * Migration 018: Upstream Health Checks
 * 
 * Adds health checking infrastructure to monitor upstream availability:
 * - upstream_health_config: Configuration for health checks per proxy
 * - upstream_health_pings: Historical ping records (last 100 per upstream)
 * - upstream_health_current: Current aggregated health status
 */

module.exports = function(db) {
  console.log('  Creating upstream health check tables...');

  // Configuration table - stores health check settings per proxy
  db.exec(`
    CREATE TABLE IF NOT EXISTS upstream_health_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proxy_id INTEGER NOT NULL UNIQUE,
      enabled INTEGER DEFAULT 1,
      check_interval INTEGER DEFAULT 30,
      timeout INTEGER DEFAULT 5000,
      check_path TEXT DEFAULT '/',
      expected_status INTEGER DEFAULT 200,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (proxy_id) REFERENCES proxy_hosts(id) ON DELETE CASCADE
    )
  `);

  // Ping history table - stores last 100 pings per upstream
  db.exec(`
    CREATE TABLE IF NOT EXISTS upstream_health_pings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proxy_id INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL,
      response_time INTEGER,
      http_status INTEGER,
      error_message TEXT,
      FOREIGN KEY (proxy_id) REFERENCES proxy_hosts(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for efficient queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_health_pings_proxy_timestamp 
      ON upstream_health_pings(proxy_id, timestamp DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_health_pings_status 
      ON upstream_health_pings(status)
  `);

  // Current health status table - aggregated current state
  db.exec(`
    CREATE TABLE IF NOT EXISTS upstream_health_current (
      proxy_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      last_checked DATETIME,
      last_success DATETIME,
      avg_response_time REAL,
      max_response_time INTEGER,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (proxy_id) REFERENCES proxy_hosts(id) ON DELETE CASCADE
    )
  `);

  // Initialize health config for all existing enabled proxies
  db.exec(`
    INSERT INTO upstream_health_config (proxy_id, enabled)
    SELECT id, 1 FROM proxy_hosts WHERE enabled = 1
    ON CONFLICT(proxy_id) DO NOTHING
  `);

  console.log('  ✓ Upstream health check tables created');
};
