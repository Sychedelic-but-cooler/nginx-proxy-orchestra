/**
 * Migration 014: TOTP Two-Factor Authentication
 * 
 * Adds fields for TOTP-based 2FA:
 * - totp_secret: Encrypted TOTP secret key
 * - totp_enabled: Whether 2FA is active for the account
 * - totp_verified: Whether the secret has been verified (must be true before enabling)
 * - recovery_key: 128-character hex recovery key for account recovery
 * - failed_login_attempts: Counter for failed login attempts (resets on successful login)
 * - last_failed_login: Timestamp of last failed login attempt
 */

function up(db) {
  // Add TOTP fields to users table
  db.exec(`
    ALTER TABLE users ADD COLUMN totp_secret TEXT;
    ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN totp_verified INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN recovery_key TEXT;
    ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN last_failed_login DATETIME;
  `);
}

function down(db) {
  // SQLite doesn't support DROP COLUMN directly
  // Would need to recreate table without these columns
  // For now, we'll leave them (safer for production)
  console.log('Migration rollback not fully supported for column drops in SQLite');
  console.log('Columns totp_secret, totp_enabled, totp_verified, recovery_key will remain');
}

module.exports = { up, down };
