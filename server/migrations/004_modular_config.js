/**
 * Migration 004: Modular Config System
 *
 * Refactors the nginx configuration generator to use a more modular system:
 * - Adds `level` column to modules table for proper classification
 * - Creates "HTTP/2" module (opt-in for SSL proxies)
 * - Creates "Force HTTPS" module (auto-enabled for SSL proxies)
 * - Fixes WebSocket module Connection header bug
 * - Auto-enables modules for existing SSL proxies (backwards compatibility)
 */

function runModularConfigMigration(db) {
  console.log('Running migration: Modular config system...');

  try {
    // Check if migration already applied
    const tableInfo = db.prepare("PRAGMA table_info(modules)").all();
    const hasLevelColumn = tableInfo.some(col => col.name === 'level');

    if (hasLevelColumn) {
      console.log('Modular config migration already applied, skipping...');
      return;
    }

    db.prepare('BEGIN TRANSACTION').run();

    // Step 1: Add level column to modules table
    console.log('  - Adding level column to modules table');
    db.prepare(`
      ALTER TABLE modules ADD COLUMN level TEXT DEFAULT 'location'
    `).run();

    // Step 2: Update existing modules with correct level
    console.log('  - Updating existing modules with level classification');

    // Server-level modules
    db.prepare(`
      UPDATE modules SET level = 'server'
      WHERE name IN ('HSTS', 'Security Headers', 'HTTP/3 (QUIC)')
    `).run();

    // Location-level modules (already default 'location', but explicitly set for clarity)
    db.prepare(`
      UPDATE modules SET level = 'location'
      WHERE name IN (
        'WebSocket Support',
        'Real IP',
        'Gzip Compression',
        'Gzip Compression (Aggressive)',
        'Brotli Compression',
        'Brotli Compression (Aggressive)'
      )
    `).run();

    // Step 3: Fix WebSocket module - correct Connection header
    console.log('  - Fixing WebSocket module Connection header');
    db.prepare(`
      UPDATE modules
      SET content = 'proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 1800s;
proxy_send_timeout 1800s;'
      WHERE name = 'WebSocket Support'
    `).run();

    // Step 4: Create HTTP/2 module
    console.log('  - Creating HTTP/2 module');
    const http2ModuleExists = db.prepare(
      'SELECT id FROM modules WHERE name = ?'
    ).get('HTTP/2');

    if (!http2ModuleExists) {
      db.prepare(`
        INSERT INTO modules (name, description, content, level)
        VALUES (?, ?, ?, ?)
      `).run(
        'HTTP/2',
        'Enable HTTP/2 protocol for faster performance (requires nginx 1.25.1+)',
        'http2 on;',
        'server'
      );
    }

    // Step 5: Create Force HTTPS module
    console.log('  - Creating Force HTTPS module');
    const forceHTTPSModuleExists = db.prepare(
      'SELECT id FROM modules WHERE name = ?'
    ).get('Force HTTPS');

    if (!forceHTTPSModuleExists) {
      db.prepare(`
        INSERT INTO modules (name, description, content, level)
        VALUES (?, ?, ?, ?)
      `).run(
        'Force HTTPS',
        'Automatically redirect all HTTP traffic to HTTPS (required for SSL-enabled proxies)',
        '{{FORCE_HTTPS_REDIRECT}}',
        'redirect'
      );
    }

    // Step 6: Auto-enable HTTP/2 for all existing SSL proxies (backwards compatibility)
    console.log('  - Auto-enabling HTTP/2 for existing SSL proxies');
    const http2EnableResult = db.prepare(`
      INSERT OR IGNORE INTO proxy_modules (proxy_id, module_id)
      SELECT ph.id, m.id
      FROM proxy_hosts ph
      CROSS JOIN modules m
      WHERE ph.ssl_enabled = 1 AND m.name = 'HTTP/2'
    `).run();
    console.log(`    Enabled HTTP/2 for ${http2EnableResult.changes} proxies`);

    // Step 7: Auto-enable Force HTTPS for all existing SSL proxies
    console.log('  - Auto-enabling Force HTTPS for existing SSL proxies');
    const forceHTTPSEnableResult = db.prepare(`
      INSERT OR IGNORE INTO proxy_modules (proxy_id, module_id)
      SELECT ph.id, m.id
      FROM proxy_hosts ph
      CROSS JOIN modules m
      WHERE ph.ssl_enabled = 1 AND m.name = 'Force HTTPS'
    `).run();
    console.log(`    Enabled Force HTTPS for ${forceHTTPSEnableResult.changes} proxies`);

    db.prepare('COMMIT').run();
    console.log('✓ Modular config migration completed successfully');

  } catch (error) {
    db.prepare('ROLLBACK').run();
    console.error('Error during modular config migration:', error);
    throw error;
  }
}

module.exports = {
  runModularConfigMigration
};
