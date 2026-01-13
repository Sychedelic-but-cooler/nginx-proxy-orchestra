const Database = require('better-sqlite3');

/**
 * Migration: Add Certbot and DNS Challenge Support
 *
 * Adds columns to certificates table for tracking certificate source,
 * auto-renewal status, and DNS credentials.
 *
 * Also creates dns_credentials table for secure storage of DNS API keys.
 */

function runCertbotMigration(db) {
  console.log('Running certbot support migration...');

  try {
    // Begin transaction
    db.exec('BEGIN TRANSACTION');

    // Add columns to ssl_certificates table
    console.log('Adding columns to ssl_certificates table...');

    db.exec(`
      -- Source: 'uploaded' or 'certbot'
      ALTER TABLE ssl_certificates ADD COLUMN source TEXT DEFAULT 'uploaded';
    `);

    db.exec(`
      -- Auto-renewal enabled flag (0 or 1)
      ALTER TABLE ssl_certificates ADD COLUMN auto_renew INTEGER DEFAULT 0;
    `);

    db.exec(`
      -- Challenge type: 'http-01' or 'dns-01'
      ALTER TABLE ssl_certificates ADD COLUMN challenge_type TEXT;
    `);

    db.exec(`
      -- Foreign key to dns_credentials table (for DNS-01 challenges)
      ALTER TABLE ssl_certificates ADD COLUMN dns_credential_id INTEGER;
    `);

    db.exec(`
      -- JSON string storing certbot-specific configuration
      -- Example: {"email": "admin@example.com", "domains": ["example.com"], "propagation_seconds": 10}
      ALTER TABLE ssl_certificates ADD COLUMN certbot_config TEXT;
    `);

    db.exec(`
      -- Timestamp of last renewal attempt
      ALTER TABLE ssl_certificates ADD COLUMN last_renewal_attempt DATETIME;
    `);

    db.exec(`
      -- Status of last renewal: 'success', 'failed', 'pending'
      ALTER TABLE ssl_certificates ADD COLUMN last_renewal_status TEXT;
    `);

    db.exec(`
      -- Error message if renewal failed
      ALTER TABLE ssl_certificates ADD COLUMN renewal_error TEXT;
    `);

    // Create dns_credentials table
    console.log('Creating dns_credentials table...');

    db.exec(`
      CREATE TABLE IF NOT EXISTS dns_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        credentials_encrypted TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Create index on dns_credentials provider
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_dns_credentials_provider
      ON dns_credentials(provider)
    `);

    // Create index on ssl_certificates source and auto_renew
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ssl_certificates_source_autorenew
      ON ssl_certificates(source, auto_renew)
    `);

    // Create index on ssl_certificates expiry for renewal checks
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ssl_certificates_expires
      ON ssl_certificates(expires_at)
    `);

    // Commit transaction
    db.exec('COMMIT');

    console.log('Certbot support migration completed successfully');
  } catch (error) {
    // Rollback on error
    db.exec('ROLLBACK');
    console.error('Certbot migration failed:', error.message);
    throw error;
  }
}

module.exports = { runCertbotMigration };
