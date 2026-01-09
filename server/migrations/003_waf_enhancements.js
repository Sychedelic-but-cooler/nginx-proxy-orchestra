/**
 * Migration: WAF Enhancements
 * Adds tables for WAF profiles, events, exclusions, and notification settings
 */

function runWAFEnhancementsMigration(db) {
  console.log('Running migration: WAF enhancements...');

  // WAF events table for attack logs
  db.exec(`
    CREATE TABLE IF NOT EXISTS waf_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proxy_id INTEGER,
      timestamp DATETIME NOT NULL,
      client_ip TEXT NOT NULL,
      request_uri TEXT,
      request_method TEXT,
      attack_type TEXT,
      rule_id TEXT,
      severity TEXT,
      message TEXT,
      raw_log TEXT,
      blocked INTEGER DEFAULT 0,
      notified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (proxy_id) REFERENCES proxy_hosts(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_waf_events_timestamp ON waf_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_waf_events_proxy ON waf_events(proxy_id);
    CREATE INDEX IF NOT EXISTS idx_waf_events_ip ON waf_events(client_ip);
    CREATE INDEX IF NOT EXISTS idx_waf_events_attack_type ON waf_events(attack_type);
    CREATE INDEX IF NOT EXISTS idx_waf_events_severity ON waf_events(severity);
    CREATE INDEX IF NOT EXISTS idx_waf_events_blocked ON waf_events(blocked);
  `);

  // WAF exclusions table for false positive management
  db.exec(`
    CREATE TABLE IF NOT EXISTS waf_exclusions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proxy_id INTEGER,
      rule_id TEXT NOT NULL,
      path_pattern TEXT,
      parameter_name TEXT,
      reason TEXT,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (proxy_id) REFERENCES proxy_hosts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_waf_exclusions_proxy ON waf_exclusions(proxy_id);
    CREATE INDEX IF NOT EXISTS idx_waf_exclusions_rule ON waf_exclusions(rule_id);
  `);

  // Notification history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notification_type TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_id INTEGER,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'sent',
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_notification_history_type ON notification_history(notification_type);
    CREATE INDEX IF NOT EXISTS idx_notification_history_sent_at ON notification_history(sent_at);
  `);

  // Create default WAF profiles
  const profiles = [
    {
      name: 'Default Protection',
      description: 'Balanced protection suitable for most web applications. Paranoia Level 1 with standard OWASP CRS rules.',
      ruleset: 'OWASP CRS 4.0',
      paranoia_level: 1,
      config_json: JSON.stringify({
        anomaly_threshold_inbound: 5,
        anomaly_threshold_outbound: 4,
        rule_groups: {
          sql_injection: true,
          xss: true,
          rce: true,
          rfi: true,
          lfi: true,
          session_fixation: true,
          protocol_attack: true,
          protocol_enforcement: true,
          request_limits: true,
          scanner_detection: false
        },
        blocking_mode: 'anomaly_scoring',
        log_level: 'warn'
      })
    },
    {
      name: 'Strict Protection',
      description: 'High security for sensitive applications. Paranoia Level 2 with additional checks.',
      ruleset: 'OWASP CRS 4.0',
      paranoia_level: 2,
      config_json: JSON.stringify({
        anomaly_threshold_inbound: 3,
        anomaly_threshold_outbound: 3,
        rule_groups: {
          sql_injection: true,
          xss: true,
          rce: true,
          rfi: true,
          lfi: true,
          session_fixation: true,
          protocol_attack: true,
          protocol_enforcement: true,
          request_limits: true,
          scanner_detection: true,
          file_upload_checks: true
        },
        blocking_mode: 'anomaly_scoring',
        log_level: 'info'
      })
    },
    {
      name: 'API Protection',
      description: 'Optimized for REST/GraphQL APIs. Focus on injection attacks and protocol enforcement.',
      ruleset: 'OWASP CRS 4.0',
      paranoia_level: 1,
      config_json: JSON.stringify({
        anomaly_threshold_inbound: 5,
        anomaly_threshold_outbound: 4,
        rule_groups: {
          sql_injection: true,
          xss: false,
          rce: true,
          rfi: false,
          lfi: false,
          protocol_attack: true,
          protocol_enforcement: true,
          request_limits: true,
          json_validation: true,
          method_enforcement: true
        },
        blocking_mode: 'anomaly_scoring',
        log_level: 'warn'
      })
    }
  ];

  const insertProfile = db.prepare(`
    INSERT OR IGNORE INTO waf_profiles (name, description, ruleset, paranoia_level, enabled, config_json)
    VALUES (?, ?, ?, ?, 1, ?)
  `);

  for (const profile of profiles) {
    insertProfile.run(
      profile.name,
      profile.description,
      profile.ruleset,
      profile.paranoia_level,
      profile.config_json
    );
  }

  // Update settings for WAF
  const newSettings = [
    ['waf_audit_log_path', '/var/log/modsec/audit.log'],
    ['waf_debug_log_path', '/var/log/modsec/debug.log'],
    ['waf_request_body_limit', '13107200'],  // 12.5MB
    ['waf_response_body_limit', '524288'],    // 512KB
    ['waf_log_retention_days', '30'],

    // Notification settings
    ['notifications_enabled', '0'],
    ['notification_apprise_urls', ''],  // JSON array of Apprise URLs
    ['notification_waf_blocks', '1'],   // Notify on blocked requests
    ['notification_waf_high_severity', '1'],  // Notify on high severity events
    ['notification_waf_threshold', '10'],  // Notify after X events in Y minutes
    ['notification_waf_threshold_minutes', '5'],
    ['notification_system_errors', '1'],  // Notify on system errors
    ['notification_proxy_changes', '0'],  // Notify on proxy config changes
    ['notification_cert_expiry', '1'],    // Notify on cert expiry
    ['notification_cert_expiry_days', '7']  // Days before expiry to notify
  ];

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );

  for (const [key, value] of newSettings) {
    insertSetting.run(key, value);
  }

  console.log('✓ WAF enhancements migration completed');
  console.log('  - Created waf_events table');
  console.log('  - Created waf_exclusions table');
  console.log('  - Created notification_history table');
  console.log('  - Added 3 default WAF profiles');
  console.log('  - Added WAF and notification settings');
}

module.exports = { runWAFEnhancementsMigration };
