/**
 * Migration 012: Enhanced Audit Log System
 *
 * Adds support for:
 * - Performance indexes for filtering and searching
 * - User agent tracking
 * - Before/after state tracking for updates
 * - Session tracking
 * - Better performance for large audit log tables
 */

function runEnhancedAuditLogMigration(db) {
  console.log('Running migration: Enhanced audit log system...');

  try {
    db.prepare('BEGIN TRANSACTION').run();

    // Step 1: Add new columns to audit_log table
    console.log('  - Adding new columns to audit_log table');
    
    // Check if columns already exist before adding
    const tableInfo = db.prepare('PRAGMA table_info(audit_log)').all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('user_agent')) {
      db.prepare('ALTER TABLE audit_log ADD COLUMN user_agent TEXT').run();
    }

    if (!columnNames.includes('session_id')) {
      db.prepare('ALTER TABLE audit_log ADD COLUMN session_id TEXT').run();
    }

    if (!columnNames.includes('before_state')) {
      db.prepare('ALTER TABLE audit_log ADD COLUMN before_state TEXT').run();
    }

    if (!columnNames.includes('after_state')) {
      db.prepare('ALTER TABLE audit_log ADD COLUMN after_state TEXT').run();
    }

    if (!columnNames.includes('success')) {
      db.prepare('ALTER TABLE audit_log ADD COLUMN success INTEGER DEFAULT 1').run();
    }

    if (!columnNames.includes('error_message')) {
      db.prepare('ALTER TABLE audit_log ADD COLUMN error_message TEXT').run();
    }

    // Step 2: Create indexes for better query performance
    console.log('  - Creating indexes for audit_log table');
    
    // Index on timestamp for date range queries
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at 
      ON audit_log(created_at DESC)
    `).run();

    // Index on user_id for filtering by user
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_user_id 
      ON audit_log(user_id)
    `).run();

    // Index on action for filtering by action type
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_action 
      ON audit_log(action)
    `).run();

    // Index on resource_type for filtering by resource
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_resource_type 
      ON audit_log(resource_type)
    `).run();

    // Composite index for common query patterns
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_composite 
      ON audit_log(resource_type, action, created_at DESC)
    `).run();

    // Index on IP address for security analysis
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_ip_address 
      ON audit_log(ip_address)
    `).run();

    // Index on resource_id and type together
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_resource 
      ON audit_log(resource_type, resource_id)
    `).run();

    // Step 3: Update migration status
    db.prepare(`
      INSERT OR REPLACE INTO migrations (version, name, applied_at)
      VALUES (12, 'enhanced_audit_log', CURRENT_TIMESTAMP)
    `).run();

    db.prepare('COMMIT').run();
    console.log('✓ Enhanced audit log migration completed successfully');
  } catch (error) {
    db.prepare('ROLLBACK').run();
    console.error('✗ Enhanced audit log migration failed:', error);
    throw error;
  }
}

module.exports = {
  version: 12,
  name: 'enhanced_audit_log',
  run: runEnhancedAuditLogMigration
};
