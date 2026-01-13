/**
 * Migration 010: Module Tags
 *
 * Adds tag column to modules table for better organization
 * - Adds `tag` TEXT column with default 'General'
 * - Updates existing modules with appropriate tags based on name/level
 * - Tags are free-form text for flexibility
 */

function runModuleTagsMigration(db) {
  console.log('Running migration: Module tags...');

  try {
    db.prepare('BEGIN TRANSACTION').run();

    // Step 1: Add tag column
    console.log('  - Adding tag column to modules table');
    db.prepare(`
      ALTER TABLE modules ADD COLUMN tag TEXT DEFAULT 'General'
    `).run();

    // Step 2: Categorize existing modules by logical groupings
    console.log('  - Categorizing existing modules');

    // Security-related modules
    db.prepare(`
      UPDATE modules SET tag = 'Security'
      WHERE name IN ('HSTS', 'Security Headers')
    `).run();

    // Compression modules
    db.prepare(`
      UPDATE modules SET tag = 'Compression'
      WHERE name LIKE '%Compression%' OR name LIKE '%Brotli%'
    `).run();

    // Protocol modules
    db.prepare(`
      UPDATE modules SET tag = 'Protocol'
      WHERE name IN ('HTTP/2', 'HTTP/3 (QUIC)', 'Force HTTPS')
    `).run();

    // Proxy features
    db.prepare(`
      UPDATE modules SET tag = 'Proxy'
      WHERE name IN ('WebSocket Support', 'Real IP')
    `).run();

    // Any remaining modules keep 'General' tag

    db.prepare('COMMIT').run();
    console.log('✓ Module tags migration completed successfully');

  } catch (error) {
    db.prepare('ROLLBACK').run();
    console.error('Error during module tags migration:', error);
    throw error;
  }
}

module.exports = {
  runModuleTagsMigration
};
