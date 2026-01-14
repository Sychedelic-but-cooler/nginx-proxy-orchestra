#!/usr/bin/env node
/**
 * Clean up failed migration records
 * This allows migrations to be re-run after fixing issues
 */

const Database = require('better-sqlite3');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'database.sqlite');

console.log('Opening database:', dbPath);
const db = new Database(dbPath);

// Delete failed migration record for 002_certbot_support
const result = db.prepare(`
  DELETE FROM migrations_history 
  WHERE migration_name = '002_certbot_support' AND success = 0
`).run();

console.log(`Deleted ${result.changes} failed migration record(s) for 002_certbot_support`);

// Also delete the duplicate entry if it exists
const duplicate = db.prepare(`
  DELETE FROM migrations_history 
  WHERE migration_name = '002_certbot_support' AND success = 1
  AND id NOT IN (
    SELECT MIN(id) FROM migrations_history 
    WHERE migration_name = '002_certbot_support' AND success = 1
  )
`).run();

if (duplicate.changes > 0) {
  console.log(`Deleted ${duplicate.changes} duplicate migration record(s)`);
}

// Show current migration status
const migrations = db.prepare(`
  SELECT migration_name, success, applied_at 
  FROM migrations_history 
  ORDER BY id
`).all();

console.log('\nCurrent migration status:');
migrations.forEach(m => {
  const status = m.success ? '✓' : '✗';
  console.log(`  ${status} ${m.migration_name} (${m.applied_at})`);
});

db.close();
console.log('\nDone! Restart the server to re-run migrations.');
