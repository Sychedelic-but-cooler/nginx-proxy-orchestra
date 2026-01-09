/**
 * Migration: Profile-Level WAF Exclusions
 * Changes exclusions from proxy-specific to profile-specific
 * - Adds profile_id column to waf_exclusions table
 * - Updates indexes from proxy_id to profile_id
 * - Allows exclusions to apply to all proxies using a WAF profile
 */

function runProfileExclusionsMigration(db) {
  console.log('Running migration: Profile-level WAF exclusions...');

  try {
    // Check if waf_exclusions table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='waf_exclusions'
    `).get();

    if (!tableExists) {
      console.log('  waf_exclusions table does not exist, skipping migration');
      return;
    }

    // Check if profile_id column already exists
    const columnExists = db.prepare(`
      SELECT COUNT(*) as count
      FROM pragma_table_info('waf_exclusions')
      WHERE name='profile_id'
    `).get();

    if (columnExists.count > 0) {
      console.log('  profile_id column already exists, skipping migration');
      return;
    }

    // Start transaction
    db.exec('BEGIN TRANSACTION');

    // Step 1: Add profile_id column
    console.log('  Adding profile_id column to waf_exclusions...');
    db.exec(`
      ALTER TABLE waf_exclusions
      ADD COLUMN profile_id INTEGER
      REFERENCES waf_profiles(id) ON DELETE CASCADE
    `);

    // Step 2: Clear any existing exclusions (fresh start as per user request)
    console.log('  Clearing existing proxy-level exclusions (fresh start)...');
    const existingCount = db.prepare('SELECT COUNT(*) as count FROM waf_exclusions').get().count;
    if (existingCount > 0) {
      db.prepare('DELETE FROM waf_exclusions').run();
      console.log(`  Removed ${existingCount} existing proxy-level exclusion(s)`);
    }

    // Step 3: Drop old proxy-based index
    console.log('  Dropping old proxy-based index...');
    db.exec('DROP INDEX IF EXISTS idx_waf_exclusions_proxy');

    // Step 4: Create new profile-based index
    console.log('  Creating new profile-based index...');
    db.exec('CREATE INDEX IF NOT EXISTS idx_waf_exclusions_profile ON waf_exclusions(profile_id)');

    // Commit transaction
    db.exec('COMMIT');

    console.log('✓ Profile-level WAF exclusions migration completed successfully');
    console.log('  Note: Exclusions are now profile-specific. Add new exclusions from WAF Events.');
  } catch (error) {
    // Rollback on error
    try {
      db.exec('ROLLBACK');
    } catch (rollbackError) {
      console.error('  Rollback failed:', rollbackError.message);
    }
    throw error;
  }
}

module.exports = { runProfileExclusionsMigration };
