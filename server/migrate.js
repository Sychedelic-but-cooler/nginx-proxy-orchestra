/**
 * Database Migration Runner
 * 
 * Manages and tracks database migrations to ensure they only run once.
 * Each migration is recorded in the migrations_history table after successful execution.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

/**
 * Initialize migrations tracking table
 */
function initializeMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_name TEXT UNIQUE NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      execution_time_ms INTEGER,
      success INTEGER DEFAULT 1
    )
  `);
}

/**
 * Check if a migration has already been run
 */
function isMigrationApplied(db, migrationName) {
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM migrations_history 
    WHERE migration_name = ? AND success = 1
  `).get(migrationName);
  
  return result.count > 0;
}

/**
 * Record a successful migration
 */
function recordMigration(db, migrationName, executionTimeMs) {
  db.prepare(`
    INSERT INTO migrations_history (migration_name, execution_time_ms)
    VALUES (?, ?)
  `).run(migrationName, executionTimeMs);
}

/**
 * Get all migration files in order
 */
function getMigrationFiles() {
  const migrationsDir = path.join(__dirname, 'migrations');
  
  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory found');
    return [];
  }
  
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.js'))
    .sort(); // Ensures they run in order (001, 002, 003, etc.)
  
  return files;
}

/**
 * Run all pending migrations
 */
function runMigrations(db) {
  console.log('=== Database Migration System ===');
  
  // Initialize migrations tracking
  initializeMigrationsTable(db);
  
  const migrationFiles = getMigrationFiles();
  
  if (migrationFiles.length === 0) {
    console.log('No migrations found');
    return;
  }
  
  console.log(`Found ${migrationFiles.length} migration files`);
  
  let appliedCount = 0;
  let skippedCount = 0;
  
  for (const file of migrationFiles) {
    const migrationName = file.replace('.js', '');
    
    // Check if already applied
    if (isMigrationApplied(db, migrationName)) {
      console.log(`⊘ Skipping ${migrationName} (already applied)`);
      skippedCount++;
      continue;
    }
    
    console.log(`→ Running ${migrationName}...`);
    const startTime = Date.now();
    
    try {
      // Load and run the migration
      const migrationPath = path.join(__dirname, 'migrations', file);
      const migration = require(migrationPath);
      
      // Support both named exports and default exports
      const migrationFn = typeof migration === 'function' 
        ? migration 
        : Object.values(migration)[0];
      
      if (typeof migrationFn !== 'function') {
        throw new Error(`Migration ${file} does not export a function`);
      }
      
      // Run the migration
      migrationFn(db);
      
      const executionTime = Date.now() - startTime;
      
      // Record successful migration
      recordMigration(db, migrationName, executionTime);
      
      console.log(`✓ Completed ${migrationName} (${executionTime}ms)`);
      appliedCount++;
      
    } catch (error) {
      console.error(`✗ Failed to run ${migrationName}:`, error.message);
      
      // Record failed migration attempt
      db.prepare(`
        INSERT INTO migrations_history (migration_name, execution_time_ms, success)
        VALUES (?, ?, 0)
      `).run(migrationName, Date.now() - startTime);
      
      // Stop on error to prevent cascading failures
      throw new Error(`Migration failed: ${migrationName} - ${error.message}`);
    }
  }
  
  console.log(`\n=== Migration Summary ===`);
  console.log(`Applied: ${appliedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Total: ${migrationFiles.length}`);
  console.log('=========================\n');
}

/**
 * Get migration status for all migrations
 */
function getMigrationStatus(db) {
  initializeMigrationsTable(db);
  
  const migrationFiles = getMigrationFiles();
  const status = [];
  
  for (const file of migrationFiles) {
    const migrationName = file.replace('.js', '');
    const record = db.prepare(`
      SELECT * FROM migrations_history 
      WHERE migration_name = ?
      ORDER BY applied_at DESC
      LIMIT 1
    `).get(migrationName);
    
    status.push({
      name: migrationName,
      applied: record ? true : false,
      appliedAt: record ? record.applied_at : null,
      executionTime: record ? record.execution_time_ms : null,
      success: record ? record.success === 1 : null
    });
  }
  
  return status;
}

module.exports = {
  runMigrations,
  getMigrationStatus,
  isMigrationApplied
};
