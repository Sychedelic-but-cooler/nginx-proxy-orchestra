/**
 * Migration: Security Features
 * Adds tables for IP blacklist, geo-blocking, user-agent filtering, rate limiting, and WAF
 */

function runSecurityMigration(db) {
  console.log('Running migration: Security features...');

  // Create security_rules table
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_type TEXT NOT NULL,
      rule_value TEXT NOT NULL,
      action TEXT DEFAULT 'deny',
      description TEXT,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_security_rules_type_enabled
      ON security_rules(rule_type, enabled);
  `);

  // Create rate_limits table
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proxy_id INTEGER NOT NULL,
      zone_name TEXT NOT NULL,
      rate TEXT NOT NULL,
      burst INTEGER DEFAULT 5,
      nodelay INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (proxy_id) REFERENCES proxy_hosts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_rate_limits_proxy
      ON rate_limits(proxy_id);
  `);

  // Create WAF tables (future-ready, not yet implemented)
  db.exec(`
    CREATE TABLE IF NOT EXISTS waf_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      ruleset TEXT NOT NULL,
      paranoia_level INTEGER DEFAULT 1,
      enabled INTEGER DEFAULT 1,
      config_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS proxy_waf (
      proxy_id INTEGER NOT NULL,
      waf_profile_id INTEGER NOT NULL,
      PRIMARY KEY (proxy_id, waf_profile_id),
      FOREIGN KEY (proxy_id) REFERENCES proxy_hosts(id) ON DELETE CASCADE,
      FOREIGN KEY (waf_profile_id) REFERENCES waf_profiles(id) ON DELETE CASCADE
    );
  `);

  // Add default security settings
  const settings = [
    ['security_ip_blacklist_enabled', '1'],
    ['security_geo_blocking_enabled', '0'],
    ['security_user_agent_filtering_enabled', '0'],
    ['security_default_deny_countries', ''],
    ['security_geoip_database_path', '/usr/share/GeoIP/GeoIP.dat'],
    ['waf_enabled', '0'],
    ['waf_mode', 'detection'],
    ['waf_default_profile_id', '']
  ];

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );

  for (const [key, value] of settings) {
    insertSetting.run(key, value);
  }

  console.log('✓ Security features migration completed');
}

module.exports = { runSecurityMigration };
