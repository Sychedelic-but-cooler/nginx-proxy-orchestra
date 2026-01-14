/**
 * Migration 015: Module Files
 *
 * Generates .conf files for all existing modules in data/modules directory.
 * This migration enables the new module include system where modules are
 * stored as separate files and included via nginx's include directive,
 * rather than being embedded line-by-line in proxy configs.
 *
 * Benefits:
 * - Cleaner, more readable proxy configs
 * - Easier module management and reuse
 * - Better separation of concerns
 * - Simpler debugging and testing
 */

function runModuleFilesMigration(db) {
  console.log('Running migration: Module files...');

  try {
    const { regenerateAllModuleFiles } = require('../utils/module-file-manager');

    console.log('  - Generating module files in data/modules/');
    
    // Regenerate all module files from the database
    const count = regenerateAllModuleFiles(db);
    
    console.log(`✓ Module files migration completed successfully (${count} files generated)`);

  } catch (error) {
    console.error('Error during module files migration:', error);
    throw error;
  }
}

module.exports = {
  runModuleFilesMigration
};
