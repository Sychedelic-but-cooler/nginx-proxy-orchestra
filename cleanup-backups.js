#!/usr/bin/env node

/**
 * One-time script to clean up existing backup files
 * Keeps only the last 3 backups per config file
 * Removes all .deleted files
 */

const fs = require('fs');
const path = require('path');

const configDir = path.join(__dirname, 'data/conf');

console.log('🧹 Cleaning up backup files in:', configDir);
console.log('');

// Get all files in the config directory
const allFiles = fs.readdirSync(configDir);

// Group backup files by their base config name
const backupGroups = {};
const deletedFiles = [];

allFiles.forEach(file => {
  if (file.includes('.backup.')) {
    // Extract base filename (e.g., "Passbolt.conf" from "Passbolt.conf.backup.12345")
    const baseFile = file.substring(0, file.indexOf('.backup.'));
    if (!backupGroups[baseFile]) {
      backupGroups[baseFile] = [];
    }

    const fullPath = path.join(configDir, file);
    const stats = fs.statSync(fullPath);
    backupGroups[baseFile].push({
      name: file,
      path: fullPath,
      mtime: stats.mtime.getTime()
    });
  } else if (file.includes('.deleted.')) {
    deletedFiles.push({
      name: file,
      path: path.join(configDir, file)
    });
  }
});

// Clean up backups (keep only last 3 per config)
let backupsDeleted = 0;
Object.keys(backupGroups).forEach(baseFile => {
  const backups = backupGroups[baseFile];

  // Sort by modification time, newest first
  backups.sort((a, b) => b.mtime - a.mtime);

  console.log(`📄 ${baseFile}: ${backups.length} backup(s) found`);

  if (backups.length > 3) {
    const toDelete = backups.slice(3);
    console.log(`   Keeping newest 3, deleting ${toDelete.length} old backup(s)`);

    toDelete.forEach(backup => {
      try {
        fs.unlinkSync(backup.path);
        console.log(`   ✓ Deleted: ${backup.name}`);
        backupsDeleted++;
      } catch (err) {
        console.error(`   ✗ Failed to delete ${backup.name}:`, err.message);
      }
    });
  } else {
    console.log(`   Keeping all ${backups.length} backup(s)`);
  }
});

// Clean up all .deleted files
console.log('');
console.log(`🗑️  Found ${deletedFiles.length} .deleted file(s)`);
deletedFiles.forEach(file => {
  try {
    fs.unlinkSync(file.path);
    console.log(`   ✓ Deleted: ${file.name}`);
    backupsDeleted++;
  } catch (err) {
    console.error(`   ✗ Failed to delete ${file.name}:`, err.message);
  }
});

console.log('');
console.log(`✨ Cleanup complete! Removed ${backupsDeleted} file(s)`);

// Show final stats
const remainingFiles = fs.readdirSync(configDir);
const remainingBackups = remainingFiles.filter(f => f.includes('.backup.')).length;
const remainingDeleted = remainingFiles.filter(f => f.includes('.deleted.')).length;

console.log('');
console.log('📊 Final stats:');
console.log(`   Backup files remaining: ${remainingBackups}`);
console.log(`   Deleted files remaining: ${remainingDeleted}`);
console.log(`   Total files in directory: ${remainingFiles.length}`);
