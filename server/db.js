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

  // SSL certificates table
  db.exec(`
    CREATE TABLE IF NOT EXISTS ssl_certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      domain_names TEXT NOT NULL,
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
proxy_set_header Connection "upgrade";`
      },
      {
        name: 'Real IP',
        description: 'Forward real client IP address',
        content: `proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;`
      }
    ];

    const insertModule = db.prepare('INSERT INTO modules (name, description, content) VALUES (?, ?, ?)');
    for (const module of defaultModules) {
      insertModule.run(module.name, module.description, module.content);
    }
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

module.exports = {
  db,
  logAudit
};
