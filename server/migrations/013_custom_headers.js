/**
 * Migration 013: Custom Headers
 * 
 * Adds table for storing custom request/response headers for proxy hosts
 */

function up(db) {
  // Create custom_headers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_headers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proxy_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      type TEXT NOT NULL, -- 'request' or 'response'
      action TEXT NOT NULL DEFAULT 'set', -- 'set', 'add', 'remove'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (proxy_id) REFERENCES proxy_hosts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_custom_headers_proxy ON custom_headers(proxy_id);
  `);
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS custom_headers');
}

module.exports = { up, down };
