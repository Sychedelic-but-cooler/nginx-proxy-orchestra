/**
 * Migration: Traffic Bouncer / Ban System
 *
 * Creates tables for:
 * - Ban integrations (UniFi, Cloudflare, etc.)
 * - IP bans tracking
 * - IP whitelist (safety)
 * - IPS detection rules (auto-ban triggers)
 */

function runBanSystemMigration(db) {
  console.log('Running migration: Traffic Bouncer / Ban System...');

  try {
    db.exec('BEGIN TRANSACTION');

    // 1. Ban Integrations Table
    const banIntegrationsExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ban_integrations'"
    ).get();

    if (!banIntegrationsExists) {
      db.exec(`
        CREATE TABLE ban_integrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL,  -- 'unifi', 'cloudflare', 'pfsense', 'iptables'
          enabled BOOLEAN DEFAULT 1,
          priority INTEGER DEFAULT 100,  -- Lower = higher priority

          -- Credential reference (NEW: uses unified credentials)
          credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,

          -- Additional configuration (non-sensitive)
          config_json TEXT,  -- JSON: { rule_priority: 1, custom_settings: {} }

          -- Status
          last_success DATETIME,
          last_error TEXT,
          total_bans_sent INTEGER DEFAULT 0,
          total_unbans_sent INTEGER DEFAULT 0,

          -- Metadata
          created_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      db.exec(`
        CREATE INDEX idx_ban_integrations_enabled ON ban_integrations(enabled, priority);
        CREATE INDEX idx_ban_integrations_credential ON ban_integrations(credential_id);
      `);

      console.log('  ✓ Created ban_integrations table');
    } else {
      console.log('  Ban integrations table already exists, checking for credential_id column...');

      // Add credential_id if it doesn't exist
      const columns = db.prepare("PRAGMA table_info(ban_integrations)").all();
      const hasCredentialId = columns.some(col => col.name === 'credential_id');

      if (!hasCredentialId) {
        db.exec(`
          ALTER TABLE ban_integrations
          ADD COLUMN credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL
        `);
        console.log('  ✓ Added credential_id column to ban_integrations');
      }
    }

    // 2. IP Bans Table
    const ipBansExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ip_bans'"
    ).get();

    if (!ipBansExists) {
      db.exec(`
        CREATE TABLE ip_bans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip_address TEXT NOT NULL,

          -- Ban details
          reason TEXT NOT NULL,
          detection_rule_id INTEGER,
          attack_type TEXT,  -- 'SQL Injection', 'XSS', 'Rate Limit', etc.
          event_count INTEGER DEFAULT 0,
          severity TEXT DEFAULT 'MEDIUM',  -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'

          -- Timing
          banned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME,  -- NULL = permanent ban
          unbanned_at DATETIME,  -- When manually unbanned

          -- Actions taken
          integrations_notified TEXT,  -- JSON array of {id, name, ban_id, notified_at}
          local_action TEXT,  -- 'nginx', 'iptables', 'none'

          -- Who did what
          auto_banned BOOLEAN DEFAULT 1,  -- 0 = manual ban
          banned_by INTEGER,
          unbanned_by INTEGER,

          -- Related data
          proxy_id INTEGER,
          sample_events TEXT,  -- JSON array of WAF event IDs

          FOREIGN KEY (detection_rule_id) REFERENCES ips_detection_rules(id) ON DELETE SET NULL,
          FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (unbanned_by) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (proxy_id) REFERENCES proxy_hosts(id) ON DELETE SET NULL
        )
      `);

      db.exec(`
        CREATE INDEX idx_ip_bans_address ON ip_bans(ip_address);
        CREATE INDEX idx_ip_bans_active ON ip_bans(ip_address, unbanned_at, expires_at);
        CREATE INDEX idx_ip_bans_expires ON ip_bans(expires_at)
          WHERE unbanned_at IS NULL;
        CREATE INDEX idx_ip_bans_banned_at ON ip_bans(banned_at DESC);
      `);

      console.log('  ✓ Created ip_bans table');
    }

    // 3. IP Whitelist Table
    const ipWhitelistExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ip_whitelist'"
    ).get();

    if (!ipWhitelistExists) {
      db.exec(`
        CREATE TABLE ip_whitelist (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip_address TEXT,  -- Individual IP or NULL for CIDR only
          ip_range TEXT,  -- CIDR notation: '10.0.0.0/8', '192.168.1.0/24'
          type TEXT NOT NULL DEFAULT 'manual',  -- 'manual', 'admin_auto', 'system'
          reason TEXT NOT NULL,
          priority INTEGER DEFAULT 100,  -- Lower = higher priority, never override
          added_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

          FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL,
          UNIQUE(ip_address, ip_range)
        )
      `);

      db.exec(`
        CREATE INDEX idx_ip_whitelist_address ON ip_whitelist(ip_address);
        CREATE INDEX idx_ip_whitelist_priority ON ip_whitelist(priority);
      `);

      // Pre-populate with safe ranges
      db.exec(`
        INSERT INTO ip_whitelist (ip_address, ip_range, type, reason, priority) VALUES
          ('127.0.0.1', '127.0.0.0/8', 'system', 'Localhost', 1),
          ('::1', '::1/128', 'system', 'IPv6 Localhost', 1),
          (NULL, '10.0.0.0/8', 'system', 'Private Network (RFC1918)', 10),
          (NULL, '172.16.0.0/12', 'system', 'Private Network (RFC1918)', 10),
          (NULL, '192.168.0.0/16', 'system', 'Private Network (RFC1918)', 10)
      `);

      console.log('  ✓ Created ip_whitelist table with default entries');
    }

    // 4. IPS Detection Rules Table
    const ipsDetectionRulesExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ips_detection_rules'"
    ).get();

    if (!ipsDetectionRulesExists) {
      db.exec(`
        CREATE TABLE ips_detection_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          enabled BOOLEAN DEFAULT 1,
          priority INTEGER DEFAULT 100,

          -- Detection criteria
          threshold INTEGER NOT NULL,  -- Number of events
          time_window INTEGER NOT NULL,  -- Seconds
          attack_types TEXT,  -- JSON array: ['SQL Injection', 'XSS'] or NULL for all
          severity_filter TEXT DEFAULT 'ALL',  -- 'CRITICAL', 'ERROR', 'WARNING', 'ALL'
          proxy_id INTEGER,  -- NULL = applies to all proxies

          -- Ban action
          ban_duration INTEGER,  -- Seconds, NULL = permanent
          ban_severity TEXT DEFAULT 'MEDIUM',

          -- Metadata
          created_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

          FOREIGN KEY (proxy_id) REFERENCES proxy_hosts(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        )
      `);

      db.exec(`
        CREATE INDEX idx_ips_rules_enabled ON ips_detection_rules(enabled, priority);
        CREATE INDEX idx_ips_rules_proxy ON ips_detection_rules(proxy_id);
      `);

      // Create default detection rules
      db.exec(`
        INSERT INTO ips_detection_rules
        (name, description, enabled, priority, threshold, time_window, attack_types, severity_filter, ban_duration, ban_severity)
        VALUES
        ('High Frequency Attack',
         'Ban IPs that trigger 20+ WAF events in 60 seconds',
         1, 10, 20, 60, NULL, 'ALL', 3600, 'HIGH'),

        ('Critical Attack Pattern',
         'Ban IPs that trigger 5+ CRITICAL severity events in 30 seconds',
         1, 5, 5, 30, NULL, 'CRITICAL', 86400, 'CRITICAL'),

        ('SQL Injection Attempts',
         'Ban IPs with 10+ SQL injection attempts in 2 minutes',
         1, 15, 10, 120, '["SQL Injection"]', 'ALL', 7200, 'HIGH'),

        ('Scanner Detection',
         'Ban automated scanners (15+ events in 2 minutes)',
         1, 20, 15, 120, '["Scanner Detection"]', 'ALL', 3600, 'MEDIUM')
      `);

      console.log('  ✓ Created ips_detection_rules table with default rules');
    }

    // 5. IP Event Tracker Table (for in-memory tracking backup)
    const ipEventTrackerExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ip_event_tracker'"
    ).get();

    if (!ipEventTrackerExists) {
      db.exec(`
        CREATE TABLE ip_event_tracker (
          ip_address TEXT NOT NULL,
          event_timestamp INTEGER NOT NULL,  -- Unix timestamp
          attack_type TEXT,
          severity TEXT,
          proxy_id INTEGER,
          waf_event_id INTEGER,

          PRIMARY KEY (ip_address, event_timestamp),
          FOREIGN KEY (waf_event_id) REFERENCES waf_events(id) ON DELETE CASCADE
        )
      `);

      db.exec(`
        CREATE INDEX idx_ip_tracker_timestamp ON ip_event_tracker(event_timestamp);
        CREATE INDEX idx_ip_tracker_ip ON ip_event_tracker(ip_address);
      `);

      console.log('  ✓ Created ip_event_tracker table');
    }

    db.exec('COMMIT');

    console.log('✓ Traffic Bouncer / Ban System migration completed');
    console.log('  - Created ban_integrations table');
    console.log('  - Created ip_bans table');
    console.log('  - Created ip_whitelist table (with default safe ranges)');
    console.log('  - Created ips_detection_rules table (with 4 default rules)');
    console.log('  - Created ip_event_tracker table');

  } catch (error) {
    db.exec('ROLLBACK');
    console.error('❌ Ban system migration failed:', error);
    throw error;
  }
}

module.exports = { runBanSystemMigration };
