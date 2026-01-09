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
 * Run database migrations
 */
function runMigrations() {
  // Check if proxy_hosts table exists
  const tableInfo = db.pragma('table_info(proxy_hosts)');
  const columnNames = tableInfo.map(col => col.name);

  // Migration 1: Add config status tracking columns
  if (!columnNames.includes('config_status')) {
    console.log('Running migration: Adding config_status column...');
    db.exec(`ALTER TABLE proxy_hosts ADD COLUMN config_status TEXT DEFAULT 'active'`);
  }

  if (!columnNames.includes('config_error')) {
    console.log('Running migration: Adding config_error column...');
    db.exec(`ALTER TABLE proxy_hosts ADD COLUMN config_error TEXT`);
  }

  if (!columnNames.includes('config_filename')) {
    console.log('Running migration: Adding config_filename column...');
    db.exec(`ALTER TABLE proxy_hosts ADD COLUMN config_filename TEXT`);
  }
}

/**
 * Initialize database schema
 */
function initializeDatabase() {
  // Users table
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

  // Proxy hosts table
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

  // Run migrations
  runMigrations();

  // SSL certificates table
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

  // Modules (config snippets) table
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

  // Initialize default settings if they don't exist
  const defaultBehavior = db.prepare('SELECT value FROM settings WHERE key = ?').get('default_server_behavior');
  if (!defaultBehavior) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('default_server_behavior', 'drop');
  }

  const customPage = db.prepare('SELECT value FROM settings WHERE key = ?').get('default_server_custom_page');
  if (!customPage) {
    const defaultCustomPage = `<!DOCTYPE html>
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
</html>`;
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('default_server_custom_page', defaultCustomPage);
  }

  const customUrl = db.prepare('SELECT value FROM settings WHERE key = ?').get('default_server_custom_url');
  if (!customUrl) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('default_server_custom_url', '');
  }

  // Admin interface certificate setting (null/empty = use self-signed)
  const adminCertId = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_cert_id');
  if (!adminCertId) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('admin_cert_id', '');
  }

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

  // Run security features migration
  const { runSecurityMigration } = require('./migrations/001_security_features');
  try {
    runSecurityMigration(db);
  } catch (error) {
    console.error('Security migration error:', error.message);
  }

  // Run certbot support migration
  const { runCertbotMigration } = require('./migrations/002_certbot_support');
  try {
    runCertbotMigration(db);
  } catch (error) {
    console.error('Certbot migration error:', error.message);
  }

  // Run WAF enhancements migration
  const { runWAFEnhancementsMigration } = require('./migrations/003_waf_enhancements');
  try {
    runWAFEnhancementsMigration(db);
  } catch (error) {
    console.error('WAF enhancements migration error:', error.message);
  }

  // Run modular config migration
  const { runModularConfigMigration } = require('./migrations/004_modular_config');
  try {
    runModularConfigMigration(db);
  } catch (error) {
    console.error('Modular config migration error:', error.message);
  }

  // Run single WAF profile migration
  const { runSingleWAFProfileMigration } = require('./migrations/005_single_waf_profile');
  try {
    runSingleWAFProfileMigration(db);
  } catch (error) {
    console.error('Single WAF profile migration error:', error.message);
  }

  // Run profile-level WAF exclusions migration
  const { runProfileExclusionsMigration } = require('./migrations/006_profile_exclusions');
  try {
    runProfileExclusionsMigration(db);
  } catch (error) {
    console.error('Profile exclusions migration error:', error.message);
  }

  // Run unified credentials migration
  const { runUnifiedCredentialsMigration } = require('./migrations/007_unified_credentials');
  try {
    runUnifiedCredentialsMigration(db);
  } catch (error) {
    console.error('Unified credentials migration error:', error.message);
  }

  // Run ban system migration
  const { runBanSystemMigration } = require('./migrations/008_ban_system');
  try {
    runBanSystemMigration(db);
  } catch (error) {
    console.error('Ban system migration error:', error.message);
  }

  // Create some default modules if none exist
  const modulesExist = db.prepare('SELECT COUNT(*) as count FROM modules').get();
  if (modulesExist.count === 0) {
    const defaultModules = [
      {
        name: 'HSTS',
        description: 'HTTP Strict Transport Security headers',
        content: 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;'
      },
      {
        name: 'Security Headers',
        description: 'Common security headers',
        content: `add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "no-referrer-when-downgrade" always;`
      },
      {
        name: 'WebSocket Support',
        description: 'Enable WebSocket proxying',
        content: `proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $http_upgrade;`
      },
      {
        name: 'Real IP',
        description: 'Forward real client IP address',
        content: `proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;`
      },
      {
        name: 'Gzip Compression',
        description: 'Enable gzip compression (built-in)',
        content: `gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;`
      },
      {
        name: 'Gzip Compression (Aggressive)',
        description: 'Aggressive gzip compression with more types',
        content: `gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 9;
gzip_min_length 256;
gzip_types
  application/atom+xml
  application/geo+json
  application/javascript
  application/x-javascript
  application/json
  application/ld+json
  application/manifest+json
  application/rdf+xml
  application/rss+xml
  application/vnd.ms-fontobject
  application/wasm
  application/x-web-app-manifest+json
  application/xhtml+xml
  application/xml
  font/eot
  font/otf
  font/ttf
  image/bmp
  image/svg+xml
  text/cache-manifest
  text/calendar
  text/css
  text/javascript
  text/markdown
  text/plain
  text/xml
  text/vcard
  text/vnd.rim.location.xloc
  text/vtt
  text/x-component
  text/x-cross-domain-policy;`
      },
      {
        name: 'Brotli Compression',
        description: 'Enable Brotli compression (requires nginx-mod-brotli package)',
        content: `# Install: dnf install nginx-mod-brotli
# Then add to /etc/nginx/nginx.conf: load_module modules/ngx_http_brotli_filter_module.so;
# After installation, uncomment these lines:
# brotli on;
# brotli_comp_level 6;
# brotli_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;`
      },
      {
        name: 'Brotli Compression (Aggressive)',
        description: 'Aggressive Brotli compression (requires nginx-mod-brotli package)',
        content: `# Install: dnf install nginx-mod-brotli
# Then add to /etc/nginx/nginx.conf: load_module modules/ngx_http_brotli_filter_module.so;
# After installation, uncomment these lines:
# brotli on;
# brotli_comp_level 11;
# brotli_min_length 256;
# brotli_types
#   application/atom+xml
#   application/geo+json
#   application/javascript
#   application/x-javascript
#   application/json
#   application/ld+json
#   application/manifest+json
#   application/rdf+xml
#   application/rss+xml
#   application/vnd.ms-fontobject
#   application/wasm
#   application/x-web-app-manifest+json
#   application/xhtml+xml
#   application/xml
#   font/eot
#   font/otf
#   font/ttf
#   image/bmp
#   image/svg+xml
#   text/cache-manifest
#   text/calendar
#   text/css
#   text/javascript
#   text/markdown
#   text/plain
#   text/xml;`
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
# add_header Alt-Svc 'h3=":443"; ma=86400' always;`
      }
    ];

    const insertModule = db.prepare('INSERT INTO modules (name, description, content) VALUES (?, ?, ?)');
    for (const module of defaultModules) {
      insertModule.run(module.name, module.description, module.content);
    }
  }

  // Update Brotli modules if installed
  updateBrotliModulesIfInstalled();
}

/**
 * Update Brotli modules to uncommented version if nginx-mod-brotli is installed
 */
function updateBrotliModulesIfInstalled() {
  const fs = require('fs');

  // Check if Brotli modules are loaded in nginx
  const brotliModuleConfigPath = '/usr/share/nginx/modules/mod-brotli.conf';
  const isBrotliInstalled = fs.existsSync(brotliModuleConfigPath);

  if (!isBrotliInstalled) {
    return; // Brotli not installed, keep modules commented
  }

  // Check if modules need updating (check if they're still commented)
  const brotliModule = db.prepare('SELECT content FROM modules WHERE name = ?').get('Brotli Compression');
  if (!brotliModule || !brotliModule.content.includes('# Install:')) {
    return; // Already updated or doesn't exist
  }

  console.log('Detected nginx-mod-brotli installation, updating modules...');

  // Brotli Compression (standard)
  const brotliStandard = `brotli on;
brotli_comp_level 6;
brotli_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;`;

  // Brotli Compression (aggressive)
  const brotliAggressive = `brotli on;
brotli_comp_level 11;
brotli_min_length 256;
brotli_types
  application/atom+xml
  application/geo+json
  application/javascript
  application/x-javascript
  application/json
  application/ld+json
  application/manifest+json
  application/rdf+xml
  application/rss+xml
  application/vnd.ms-fontobject
  application/wasm
  application/x-web-app-manifest+json
  application/xhtml+xml
  application/xml
  font/eot
  font/otf
  font/ttf
  image/bmp
  image/svg+xml
  text/cache-manifest
  text/calendar
  text/css
  text/javascript
  text/markdown
  text/plain
  text/xml;`;

  try {
    db.prepare('UPDATE modules SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?')
      .run(brotliStandard, 'Brotli Compression');

    db.prepare('UPDATE modules SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?')
      .run(brotliAggressive, 'Brotli Compression (Aggressive)');

    console.log('✓ Brotli modules updated and ready to use');
  } catch (error) {
    console.error('Warning: Could not update Brotli modules:', error.message);
  }
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
