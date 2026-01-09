-- ============================================================================
-- Nginx Proxy Orchestra - Complete Database Schema
-- ============================================================================
-- This file contains the complete, up-to-date database schema.
-- It includes all tables, indexes, and columns from all migrations.
-- This is applied only when creating a fresh database.
-- ============================================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);

-- SSL certificates table
CREATE TABLE IF NOT EXISTS ssl_certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  domain_names TEXT NOT NULL,
  issuer TEXT,
  expires_at DATETIME,
  cert_path TEXT NOT NULL,
  key_path TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- Certbot support columns (migration 002)
  source TEXT DEFAULT 'uploaded',
  auto_renew INTEGER DEFAULT 0,
  challenge_type TEXT,
  dns_credential_id INTEGER,
  certbot_config TEXT,
  last_renewal_attempt DATETIME,
  last_renewal_status TEXT,
  renewal_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_ssl_certificates_source_autorenew
  ON ssl_certificates(source, auto_renew);
CREATE INDEX IF NOT EXISTS idx_ssl_certificates_expires
  ON ssl_certificates(expires_at);

-- Proxy hosts table
CREATE TABLE IF NOT EXISTS proxy_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'reverse',
  enabled INTEGER DEFAULT 1,
  domain_names TEXT NOT NULL,
  forward_scheme TEXT DEFAULT 'http',
  forward_host TEXT NOT NULL,
  forward_port INTEGER NOT NULL,
  ssl_enabled INTEGER DEFAULT 0,
  ssl_cert_id INTEGER,
  advanced_config TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- Config status tracking columns (from initial migrations in db.js)
  config_status TEXT DEFAULT 'active',
  config_error TEXT,
  config_filename TEXT,
  -- WAF profile assignment (migration 005 - single profile model)
  waf_profile_id INTEGER,
  FOREIGN KEY (ssl_cert_id) REFERENCES ssl_certificates(id) ON DELETE SET NULL,
  FOREIGN KEY (waf_profile_id) REFERENCES waf_profiles(id) ON DELETE SET NULL
);

-- Modules (config snippets) table
CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- Module level classification (migration 004)
  level TEXT DEFAULT 'location'
);

-- Proxy-Module junction table
CREATE TABLE IF NOT EXISTS proxy_modules (
  proxy_id INTEGER NOT NULL,
  module_id INTEGER NOT NULL,
  PRIMARY KEY (proxy_id, module_id),
  FOREIGN KEY (proxy_id) REFERENCES proxy_hosts(id) ON DELETE CASCADE,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
);

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id INTEGER,
  details TEXT,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Security rules table (migration 001)
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

-- Rate limits table (migration 001)
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

-- WAF profiles table (migration 001/003)
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

-- WAF events table (migration 003)
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

-- WAF exclusions table (migration 003/006)
CREATE TABLE IF NOT EXISTS waf_exclusions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER,
  rule_id TEXT NOT NULL,
  path_pattern TEXT,
  parameter_name TEXT,
  reason TEXT,
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES waf_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_waf_exclusions_profile ON waf_exclusions(profile_id);
CREATE INDEX IF NOT EXISTS idx_waf_exclusions_rule ON waf_exclusions(rule_id);

-- Notification history table (migration 003)
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

-- Unified credential storage for all integrations (migration 007)
CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  credential_type TEXT NOT NULL,  -- 'dns', 'firewall', 'cdn', 'monitoring'
  provider TEXT NOT NULL,  -- 'cloudflare', 'unifi', 'route53', 'pfsense', etc.
  credentials_encrypted TEXT NOT NULL,  -- AES-256 encrypted JSON
  description TEXT,

  -- Metadata
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  last_used DATETIME,

  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_credentials_type ON credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_credentials_provider ON credentials(provider);
