const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'database.sqlite');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

/**
 * Check if this is a brand new database
 */
function isNewDatabase() {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `).all();

  return tables.length === 0;
}

/**
 * Apply complete schema from schema.sql file
 */
function applyCompleteSchema() {
  console.log('Initializing fresh database with complete schema...');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  db.exec(schemaSql);

  console.log('✓ Database schema created successfully');
}

/**
 * Run legacy migrations for existing databases
 * This ensures backwards compatibility for installations created before schema.sql
 */
function runLegacyMigrations() {
  console.log('Running compatibility checks for existing database...');

  // Check if proxy_hosts table exists (basic check)
  const tableInfo = db.pragma('table_info(proxy_hosts)');

  if (tableInfo.length === 0) {
    // Table doesn't exist, apply base schema first
    db.exec(`
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
        FOREIGN KEY (ssl_cert_id) REFERENCES ssl_certificates(id) ON DELETE SET NULL
      )
    `);
  }

  const columnNames = tableInfo.map(col => col.name);

  // Add missing columns from old migrations
  if (!columnNames.includes('config_status')) {
    console.log('  Adding config_status column...');
    db.exec(`ALTER TABLE proxy_hosts ADD COLUMN config_status TEXT DEFAULT 'active'`);
  }

  if (!columnNames.includes('config_error')) {
    console.log('  Adding config_error column...');
    db.exec(`ALTER TABLE proxy_hosts ADD COLUMN config_error TEXT`);
  }

  if (!columnNames.includes('config_filename')) {
    console.log('  Adding config_filename column...');
    db.exec(`ALTER TABLE proxy_hosts ADD COLUMN config_filename TEXT`);
  }

  if (!columnNames.includes('waf_profile_id')) {
    console.log('  Adding waf_profile_id column...');
    db.exec(`ALTER TABLE proxy_hosts ADD COLUMN waf_profile_id INTEGER REFERENCES waf_profiles(id) ON DELETE SET NULL`);
  }

  // Run old migrations for backwards compatibility
  try {
    const { runSecurityMigration } = require('./migrations/001_security_features');
    runSecurityMigration(db);
  } catch (error) {
    // Ignore if migration already applied
  }

  try {
    const { runCertbotMigration } = require('./migrations/002_certbot_support');
    runCertbotMigration(db);
  } catch (error) {
    // Ignore if migration already applied
  }

  try {
    const { runWAFEnhancementsMigration } = require('./migrations/003_waf_enhancements');
    runWAFEnhancementsMigration(db);
  } catch (error) {
    // Ignore if migration already applied
  }

  try {
    const { runModularConfigMigration } = require('./migrations/004_modular_config');
    runModularConfigMigration(db);
  } catch (error) {
    // Ignore if migration already applied
  }

  try {
    const { runSingleWAFProfileMigration } = require('./migrations/005_single_waf_profile');
    runSingleWAFProfileMigration(db);
  } catch (error) {
    // Ignore if migration already applied
  }

  console.log('✓ Compatibility checks completed');
}

/**
 * Initialize default data
 */
function initializeDefaultData() {
  // Users table (ensure it exists even for legacy migrations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    )
  `);

  // SSL certificates table (ensure it exists)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ssl_certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      domain_names TEXT NOT NULL,
      issuer TEXT,
      expires_at DATETIME,
      cert_path TEXT NOT NULL,
      key_path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Modules table (ensure it exists)
  db.exec(`
    CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Proxy-Module junction table
  db.exec(`
    CREATE TABLE IF NOT EXISTS proxy_modules (
      proxy_id INTEGER NOT NULL,
      module_id INTEGER NOT NULL,
      PRIMARY KEY (proxy_id, module_id),
      FOREIGN KEY (proxy_id) REFERENCES proxy_hosts(id) ON DELETE CASCADE,
      FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
    )
  `);

  // Audit log table
  db.exec(`
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
    )
  `);

  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Initialize default settings
  initializeSettings();

  // Check if admin user exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');

  if (!adminExists) {
    // Generate secure random password
    const password = crypto.randomBytes(16).toString('base64').substring(0, 16);
    const hash = bcrypt.hashSync(password, 10);

    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');

    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('           FIRST TIME SETUP - ADMIN CREDENTIALS            ');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('  🔐 Username: admin');
    console.log(`  🔑 Password: ${password}`);
    console.log('');
    console.log('  ⚠️  IMPORTANT: Save these credentials immediately!');
    console.log('  ⚠️  Change the password after first login.');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\n');
  }

  // Create default modules if none exist
  initializeDefaultModules();

  // Create default WAF profiles if none exist
  initializeDefaultWAFProfiles();

  // Update Brotli modules if installed
  updateBrotliModulesIfInstalled();
}

/**
 * Initialize default settings
 */
function initializeSettings() {
  const defaultSettings = [
    // Default server behavior
    ['default_server_behavior', 'drop'],
    ['default_server_custom_page', `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Service Unavailable</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 {
      font-size: 3rem;
      margin: 0 0 1rem 0;
    }
    p {
      font-size: 1.25rem;
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Service Unavailable</h1>
    <p>The requested service is not currently available.</p>
  </div>
</body>
</html>`],
    ['default_server_custom_url', ''],
    ['admin_cert_id', ''],

    // Security settings (migration 001)
    ['security_ip_blacklist_enabled', '1'],
    ['security_geo_blocking_enabled', '0'],
    ['security_user_agent_filtering_enabled', '0'],
    ['security_default_deny_countries', ''],
    ['security_geoip_database_path', '/usr/share/GeoIP/GeoIP.dat'],

    // WAF settings (migration 001/003)
    ['waf_enabled', '0'],
    ['waf_mode', 'detection'],
    ['waf_default_profile_id', ''],
    ['waf_audit_log_path', '/var/log/modsec/audit.log'],
    ['waf_debug_log_path', '/var/log/modsec/debug.log'],
    ['waf_request_body_limit', '13107200'],  // 12.5MB
    ['waf_response_body_limit', '524288'],    // 512KB
    ['waf_log_retention_days', '30'],

    // Notification settings (migration 003)
    ['notifications_enabled', '0'],
    ['notification_apprise_urls', ''],
    ['notification_waf_blocks', '1'],
    ['notification_waf_high_severity', '1'],
    ['notification_waf_threshold', '10'],
    ['notification_waf_threshold_minutes', '5'],
    ['notification_system_errors', '1'],
    ['notification_proxy_changes', '0'],
    ['notification_cert_expiry', '1'],
    ['notification_cert_expiry_days', '7']
  ];

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of defaultSettings) {
    insertSetting.run(key, value);
  }
}

/**
 * Initialize default modules
 */
function initializeDefaultModules() {
  const modulesExist = db.prepare('SELECT COUNT(*) as count FROM modules').get();
  if (modulesExist.count > 0) return;

  console.log('Creating default modules...');

  const defaultModules = [
    {
      name: 'HSTS',
      description: 'HTTP Strict Transport Security headers',
      content: 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;',
      level: 'server'
    },
    {
      name: 'Security Headers',
      description: 'Common security headers',
      content: `add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "no-referrer-when-downgrade" always;`,
      level: 'server'
    },
    {
      name: 'WebSocket Support',
      description: 'Enable WebSocket proxying',
      content: `proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 1800s;
proxy_send_timeout 1800s;`,
      level: 'location'
    },
    {
      name: 'Real IP',
      description: 'Forward real client IP address',
      content: `proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;`,
      level: 'location'
    },
    {
      name: 'HTTP/2',
      description: 'Enable HTTP/2 protocol for faster performance (requires nginx 1.25.1+)',
      content: 'http2 on;',
      level: 'server'
    },
    {
      name: 'Force HTTPS',
      description: 'Automatically redirect all HTTP traffic to HTTPS (required for SSL-enabled proxies)',
      content: '{{FORCE_HTTPS_REDIRECT}}',
      level: 'redirect'
    },
    {
      name: 'Gzip Compression',
      description: 'Enable gzip compression (built-in)',
      content: `gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;`,
      level: 'location'
    },
    {
      name: 'Brotli Compression',
      description: 'Enable Brotli compression (requires nginx-mod-brotli package)',
      content: `# Install: dnf install nginx-mod-brotli
# Then add to /etc/nginx/nginx.conf: load_module modules/ngx_http_brotli_filter_module.so;
# After installation, uncomment these lines:
# brotli on;
# brotli_comp_level 6;
# brotli_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;`,
      level: 'location'
    },
    {
      name: 'HTTP/3 (QUIC)',
      description: 'Enable HTTP/3 with QUIC protocol (requires nginx 1.25.0+ with http_v3_module)',
      content: `# Requires nginx 1.25.0+ compiled with --with-http_v3_module
# Current version: nginx 1.20.1 (does not support HTTP/3)
# To upgrade, see: https://nginx.org/en/docs/http/ngx_http_v3_module.html
# After upgrade, uncomment these lines:
# listen 443 quic reuseport;
# listen 443 ssl;
# http3 on;
# http3_hq on;
# quic_retry on;
# add_header Alt-Svc 'h3=":443"; ma=86400' always;`,
      level: 'server'
    }
  ];

  const insertModule = db.prepare('INSERT INTO modules (name, description, content, level) VALUES (?, ?, ?, ?)');
  for (const module of defaultModules) {
    insertModule.run(module.name, module.description, module.content, module.level);
  }
}

/**
 * Initialize default WAF profiles
 */
function initializeDefaultWAFProfiles() {
  const profilesExist = db.prepare('SELECT COUNT(*) as count FROM waf_profiles').get();
  if (profilesExist.count > 0) return;

  console.log('Creating default WAF profiles...');

  const profiles = [
    {
      name: 'Default Protection',
      description: 'Balanced protection suitable for most web applications. Paranoia Level 1 with standard OWASP CRS rules.',
      ruleset: 'owasp-crs-4.0',
      paranoia_level: 1,
      config_json: JSON.stringify({
        blocking_mode: 'anomaly_scoring',
        anomaly_threshold_inbound: 5,
        anomaly_threshold_outbound: 4,
        rule_groups: {
          sql_injection: true,
          xss: true,
          rce: true,
          rfi: false,
          lfi: false,
          php_injection: true,
          java_injection: false,
          session_fixation: false,
          multipart_attack: false,
          generic_attack: false,
          protocol_attack: true,
          protocol_enforcement: true,
          request_limits: true,
          scanner_detection: true
        },
        rule_engine_mode: 'On',
        log_level: 'warn'
      })
    },
    {
      name: 'Strict Protection',
      description: 'High security for sensitive applications. Paranoia Level 3 with all protections enabled.',
      ruleset: 'owasp-crs-4.0',
      paranoia_level: 3,
      config_json: JSON.stringify({
        blocking_mode: 'anomaly_scoring',
        anomaly_threshold_inbound: 5,
        anomaly_threshold_outbound: 4,
        rule_groups: {
          sql_injection: true,
          xss: true,
          rce: true,
          rfi: true,
          lfi: true,
          php_injection: true,
          java_injection: true,
          session_fixation: true,
          multipart_attack: true,
          generic_attack: true,
          protocol_attack: true,
          protocol_enforcement: true,
          request_limits: true,
          scanner_detection: true
        },
        rule_engine_mode: 'On',
        log_level: 'warn'
      })
    },
    {
      name: 'API Protection',
      description: 'Optimized for REST/GraphQL APIs. Focus on injection attacks and protocol enforcement.',
      ruleset: 'owasp-crs-4.0',
      paranoia_level: 2,
      config_json: JSON.stringify({
        blocking_mode: 'anomaly_scoring',
        anomaly_threshold_inbound: 5,
        anomaly_threshold_outbound: 4,
        rule_groups: {
          sql_injection: true,
          xss: false,
          rce: true,
          rfi: false,
          lfi: false,
          php_injection: false,
          java_injection: false,
          session_fixation: false,
          multipart_attack: false,
          generic_attack: false,
          protocol_attack: true,
          protocol_enforcement: true,
          request_limits: true,
          scanner_detection: false
        },
        rule_engine_mode: 'On',
        log_level: 'warn'
      })
    }
  ];

  const insertProfile = db.prepare(`
    INSERT INTO waf_profiles (name, description, ruleset, paranoia_level, enabled, config_json)
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
}

/**
 * Update Brotli modules to uncommented version if nginx-mod-brotli is installed
 */
function updateBrotliModulesIfInstalled() {
  // Check if Brotli modules are loaded in nginx
  const brotliModuleConfigPath = '/usr/share/nginx/modules/mod-brotli.conf';
  const isBrotliInstalled = fs.existsSync(brotliModuleConfigPath);

  if (!isBrotliInstalled) {
    return; // Brotli not installed, keep modules commented
  }

  // Check if modules need updating
  const brotliModule = db.prepare('SELECT content FROM modules WHERE name = ?').get('Brotli Compression');
  if (!brotliModule || !brotliModule.content.includes('# Install:')) {
    return; // Already updated or doesn't exist
  }

  console.log('Detected nginx-mod-brotli installation, updating modules...');

  const brotliStandard = `brotli on;
brotli_comp_level 6;
brotli_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;`;

  try {
    db.prepare('UPDATE modules SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?')
      .run(brotliStandard, 'Brotli Compression');

    console.log('✓ Brotli modules updated and ready to use');
  } catch (error) {
    console.error('Warning: Could not update Brotli modules:', error.message);
  }
}

/**
 * Initialize database
 */
function initializeDatabase() {
  if (isNewDatabase()) {
    console.log('🆕 Detected new database installation');
    applyCompleteSchema();
    initializeDefaultData();
  } else {
    console.log('📦 Detected existing database');
    runLegacyMigrations();
    initializeDefaultData();
  }

  console.log('✓ Database initialization complete');
}

// Initialize on startup
initializeDatabase();

/**
 * Log audit event
 */
function logAudit(userId, action, resourceType, resourceId, details, ipAddress) {
  const stmt = db.prepare(
    'INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)'
  );
  stmt.run(userId, action, resourceType, resourceId, details || null, ipAddress || null);
}

/**
 * Get a setting value
 */
function getSetting(key) {
  const result = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return result ? result.value : null;
}

/**
 * Set a setting value
 */
function setSetting(key, value) {
  const exists = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (exists) {
    db.prepare('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(value, key);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
}

/**
 * Get all settings
 */
function getAllSettings() {
  return db.prepare('SELECT key, value FROM settings').all();
}

module.exports = {
  db,
  logAudit,
  getSetting,
  setSetting,
  getAllSettings
};
