/**
 * Migration: Unified Credentials System
 *
 * Refactors dns_credentials into a generic credentials table
 * that can store API keys for any integration type
 */

function runUnifiedCredentialsMigration(db) {
  console.log('Running migration: Unified credentials system...');

  try {
    // Check if we already migrated
    const tableInfo = db.prepare("PRAGMA table_info(credentials)").all();
    if (tableInfo.length > 0) {
      console.log('  Credentials table already exists, skipping migration');
      return;
    }

    db.exec('BEGIN TRANSACTION');

    // 1. Create new unified credentials table
    db.exec(`
      CREATE TABLE credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        credential_type TEXT NOT NULL,  -- 'dns', 'firewall', 'cdn', 'monitoring', etc.
        provider TEXT NOT NULL,  -- 'cloudflare', 'unifi', 'route53', etc.
        credentials_encrypted TEXT NOT NULL,
        description TEXT,

        -- Metadata
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER,
        last_used DATETIME,

        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE(name)
      )
    `);

    // 2. Create indexes
    db.exec(`
      CREATE INDEX idx_credentials_type ON credentials(credential_type);
      CREATE INDEX idx_credentials_provider ON credentials(provider);
    `);

    // 3. Migrate existing DNS credentials if they exist
    const dnsCredentials = db.prepare(`
      SELECT * FROM dns_credentials
    `).all();

    console.log(`  Migrating ${dnsCredentials.length} DNS credentials...`);

    const insertStmt = db.prepare(`
      INSERT INTO credentials (
        id, name, credential_type, provider, credentials_encrypted,
        created_at, updated_at, created_by
      ) VALUES (?, ?, 'dns', ?, ?, ?, ?, ?)
    `);

    for (const cred of dnsCredentials) {
      insertStmt.run(
        cred.id,
        cred.name,
        cred.provider,
        cred.credentials_encrypted,
        cred.created_at,
        cred.updated_at,
        cred.created_by
      );
    }

    // 4. Update references in ssl_certificates table
    db.exec(`
      UPDATE ssl_certificates
      SET dns_credential_id = (
        SELECT id FROM credentials
        WHERE credentials.id = ssl_certificates.dns_credential_id
      )
      WHERE dns_credential_id IS NOT NULL
    `);

    // 5. Drop old dns_credentials table
    db.exec('DROP TABLE IF EXISTS dns_credentials');
    db.exec('DROP INDEX IF EXISTS idx_dns_credentials_provider');

    // 6. Update ban_integrations to reference credentials
    const banIntegrationsExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ban_integrations'"
    ).get();

    if (banIntegrationsExists) {
      // Add credential_id column to ban_integrations
      const columnExists = db.prepare(
        "PRAGMA table_info(ban_integrations)"
      ).all().some(col => col.name === 'credential_id');

      if (!columnExists) {
        db.exec(`
          ALTER TABLE ban_integrations
          ADD COLUMN credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL
        `);

        console.log('  Added credential_id to ban_integrations');
      }
    }

    db.exec('COMMIT');

    console.log('✓ Unified credentials migration completed');
    console.log(`  - Created credentials table`);
    console.log(`  - Migrated ${dnsCredentials.length} DNS credentials`);
    console.log(`  - Dropped dns_credentials table`);

  } catch (error) {
    db.exec('ROLLBACK');
    console.error('❌ Unified credentials migration failed:', error);
    throw error;
  }
}

module.exports = { runUnifiedCredentialsMigration };
