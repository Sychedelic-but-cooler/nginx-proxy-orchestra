/**
 * Migration: Single WAF Profile per Proxy
 * Changes from many-to-many relationship to one-to-one
 * - Adds waf_profile_id column to proxy_hosts table
 * - Migrates data from proxy_waf junction table
 * - Drops proxy_waf table
 */

function runSingleWAFProfileMigration(db) {
  console.log('Running migration: Single WAF profile per proxy...');

  try {
    // Check if proxy_waf table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='proxy_waf'
    `).get();

    if (!tableExists) {
      console.log('  proxy_waf table does not exist, skipping migration');
      return;
    }

    // Check if waf_profile_id column already exists on proxy_hosts
    const columnExists = db.prepare(`
      SELECT COUNT(*) as count
      FROM pragma_table_info('proxy_hosts')
      WHERE name='waf_profile_id'
    `).get();

    if (columnExists.count > 0) {
      console.log('  waf_profile_id column already exists, skipping migration');
      return;
    }

    // Start transaction
    db.exec('BEGIN TRANSACTION');

    // Step 1: Add waf_profile_id column to proxy_hosts
    console.log('  Adding waf_profile_id column to proxy_hosts...');
    db.exec(`
      ALTER TABLE proxy_hosts
      ADD COLUMN waf_profile_id INTEGER
      REFERENCES waf_profiles(id) ON DELETE SET NULL
    `);

    // Step 2: Migrate data from proxy_waf to proxy_hosts
    // If multiple profiles exist for a proxy, take the first one
    console.log('  Migrating WAF profile assignments...');

    const proxiesWithWAF = db.prepare(`
      SELECT DISTINCT proxy_id,
        (SELECT waf_profile_id FROM proxy_waf WHERE proxy_id = pw.proxy_id LIMIT 1) as profile_id
      FROM proxy_waf pw
    `).all();

    let migratedCount = 0;
    let multipleProfilesCount = 0;

    for (const row of proxiesWithWAF) {
      // Check if this proxy had multiple profiles assigned
      const profileCount = db.prepare(`
        SELECT COUNT(*) as count FROM proxy_waf WHERE proxy_id = ?
      `).get(row.proxy_id).count;

      if (profileCount > 1) {
        multipleProfilesCount++;
        console.log(`    Warning: Proxy ${row.proxy_id} had ${profileCount} profiles, using first one`);
      }

      // Update proxy_hosts with the profile
      db.prepare(`
        UPDATE proxy_hosts
        SET waf_profile_id = ?
        WHERE id = ?
      `).run(row.profile_id, row.proxy_id);

      migratedCount++;
    }

    console.log(`  Migrated ${migratedCount} WAF profile assignments`);
    if (multipleProfilesCount > 0) {
      console.log(`  Note: ${multipleProfilesCount} proxies had multiple profiles, kept only the first one`);
    }

    // Step 3: Drop proxy_waf junction table
    console.log('  Dropping proxy_waf junction table...');
    db.exec('DROP TABLE proxy_waf');

    // Commit transaction
    db.exec('COMMIT');

    console.log('✓ Single WAF profile migration completed successfully');
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

module.exports = { runSingleWAFProfileMigration };
