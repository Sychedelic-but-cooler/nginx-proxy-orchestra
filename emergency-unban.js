#!/usr/bin/env node

/**
 * EMERGENCY UNBAN SCRIPT
 *
 * Run this via SSH if you get locked out
 *
 * Usage:
 *   node emergency-unban.js <ip-address>          # Unban specific IP
 *   node emergency-unban.js --all                 # Unban all IPs
 *   node emergency-unban.js --whitelist <ip>      # Add IP to whitelist
 *   node emergency-unban.js --show-bans           # Show active bans
 *   node emergency-unban.js --show-whitelist      # Show whitelist
 *   node emergency-unban.js --help                # Show help
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data/database.sqlite');

// Check if database exists
const fs = require('fs');
if (!fs.existsSync(DB_PATH)) {
  console.error('❌ Database not found at:', DB_PATH);
  console.error('   Make sure you are running this from the nginx-proxy-orchestra directory');
  process.exit(1);
}

const db = new Database(DB_PATH);

const args = process.argv.slice(2);

// Show help
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('Emergency Unban Script - WAF Traffic Bouncer\n');
  console.log('Usage:');
  console.log('  node emergency-unban.js <ip-address>          Unban specific IP');
  console.log('  node emergency-unban.js --all                 Unban all IPs (DANGER!)');
  console.log('  node emergency-unban.js --whitelist <ip>      Add IP to whitelist (SAFE)');
  console.log('  node emergency-unban.js --show-bans           Show active bans');
  console.log('  node emergency-unban.js --show-whitelist      Show whitelist entries');
  console.log('  node emergency-unban.js --stats               Show ban statistics');
  console.log('\nExamples:');
  console.log('  node emergency-unban.js 192.168.1.100');
  console.log('  node emergency-unban.js --whitelist 192.168.1.100');
  console.log('\n⚠️  Note: This only clears local database. Upstream firewalls must be cleared manually.');
  process.exit(0);
}

// Show active bans
if (args[0] === '--show-bans') {
  const bans = db.prepare(`
    SELECT ip_address, reason, attack_type, banned_at, expires_at, auto_banned
    FROM ip_bans
    WHERE unbanned_at IS NULL
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    ORDER BY banned_at DESC
  `).all();

  if (bans.length === 0) {
    console.log('✓ No active bans');
  } else {
    console.log(`Active bans (${bans.length}):\n`);
    bans.forEach((ban, i) => {
      console.log(`${i + 1}. IP: ${ban.ip_address}`);
      console.log(`   Reason: ${ban.reason}`);
      console.log(`   Attack Type: ${ban.attack_type || 'N/A'}`);
      console.log(`   Banned: ${ban.banned_at} ${ban.auto_banned ? '(auto)' : '(manual)'}`);
      console.log(`   Expires: ${ban.expires_at || 'PERMANENT'}`);
      console.log('');
    });
  }
  db.close();
  process.exit(0);
}

// Show whitelist
if (args[0] === '--show-whitelist') {
  const whitelist = db.prepare(`
    SELECT ip_address, ip_range, type, reason, priority, created_at
    FROM ip_whitelist
    ORDER BY priority ASC, created_at DESC
  `).all();

  if (whitelist.length === 0) {
    console.log('⚠️  No whitelist entries found');
  } else {
    console.log(`Whitelist entries (${whitelist.length}):\n`);
    whitelist.forEach((entry, i) => {
      console.log(`${i + 1}. ${entry.ip_address || entry.ip_range || 'N/A'}`);
      console.log(`   Type: ${entry.type} (Priority: ${entry.priority})`);
      console.log(`   Reason: ${entry.reason}`);
      console.log(`   Added: ${entry.created_at}`);
      console.log('');
    });
  }
  db.close();
  process.exit(0);
}

// Show statistics
if (args[0] === '--stats') {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_bans,
      COUNT(CASE WHEN auto_banned = 1 THEN 1 END) as auto_bans,
      COUNT(CASE WHEN auto_banned = 0 THEN 1 END) as manual_bans,
      COUNT(CASE WHEN expires_at IS NULL THEN 1 END) as permanent_bans,
      COUNT(CASE WHEN expires_at IS NOT NULL THEN 1 END) as temporary_bans
    FROM ip_bans
    WHERE unbanned_at IS NULL
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
  `).get();

  const integrations = db.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN enabled = 1 THEN 1 END) as enabled
    FROM ban_integrations
  `).get();

  const whitelist = db.prepare('SELECT COUNT(*) as count FROM ip_whitelist').get();

  console.log('Ban System Statistics:\n');
  console.log(`Active Bans: ${stats.total_bans}`);
  console.log(`  - Auto-bans: ${stats.auto_bans}`);
  console.log(`  - Manual bans: ${stats.manual_bans}`);
  console.log(`  - Permanent: ${stats.permanent_bans}`);
  console.log(`  - Temporary: ${stats.temporary_bans}`);
  console.log('');
  console.log(`Ban Integrations: ${integrations.total} (${integrations.enabled} enabled)`);
  console.log(`Whitelist Entries: ${whitelist.count}`);

  db.close();
  process.exit(0);
}

// Unban all IPs
if (args[0] === '--all') {
  console.log('⚠️  WARNING: This will unban ALL IPs!');
  console.log('⚠️  Upstream firewalls will still have blocks until manually cleared.');
  console.log('');

  const bans = db.prepare(`
    SELECT COUNT(*) as count FROM ip_bans
    WHERE unbanned_at IS NULL
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
  `).get();

  if (bans.count === 0) {
    console.log('✓ No active bans to clear');
    db.close();
    process.exit(0);
  }

  // Require confirmation
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  readline.question(`Unban ${bans.count} IP address(es)? (yes/no): `, answer => {
    readline.close();

    if (answer.toLowerCase() !== 'yes') {
      console.log('Cancelled');
      db.close();
      process.exit(0);
    }

    const result = db.prepare(`
      UPDATE ip_bans
      SET unbanned_at = CURRENT_TIMESTAMP,
          unbanned_by = NULL
      WHERE unbanned_at IS NULL
    `).run();

    console.log(`✓ Unbanned ${result.changes} IP address(es)`);
    console.log('⚠️  Note: Upstream firewalls still have blocks. Clear those manually.');
    db.close();
  });

  return;
}

// Add to whitelist
if (args[0] === '--whitelist' || args[0] === '-w') {
  const ip = args[1];
  if (!ip) {
    console.error('❌ Error: IP address required');
    console.error('   Usage: node emergency-unban.js --whitelist <ip-address>');
    db.close();
    process.exit(1);
  }

  try {
    // Check if already whitelisted
    const existing = db.prepare(
      'SELECT * FROM ip_whitelist WHERE ip_address = ?'
    ).get(ip);

    if (existing) {
      console.log(`✓ IP ${ip} is already whitelisted`);
      console.log(`  Type: ${existing.type}`);
      console.log(`  Reason: ${existing.reason}`);
      console.log(`  Priority: ${existing.priority}`);
    } else {
      db.prepare(`
        INSERT INTO ip_whitelist (ip_address, type, reason, priority)
        VALUES (?, 'manual', 'Emergency whitelist via script', 1)
      `).run(ip);

      console.log(`✓ Added ${ip} to whitelist with highest priority (1)`);
    }

    // Also unban if currently banned
    const ban = db.prepare(`
      SELECT id FROM ip_bans
      WHERE ip_address = ?
        AND unbanned_at IS NULL
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `).get(ip);

    if (ban) {
      const unbanResult = db.prepare(`
        UPDATE ip_bans
        SET unbanned_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(ban.id);

      if (unbanResult.changes > 0) {
        console.log(`✓ Unbanned ${ip} (was banned)`);
      }
    }

    console.log('');
    console.log('✓ Complete! This IP will never be banned automatically.');
    console.log('  To remove from whitelist, use the web UI or database directly.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    db.close();
    process.exit(1);
  }

  db.close();
  process.exit(0);
}

// Unban specific IP
const ip = args[0];

// Validate IP format (basic check)
if (!/^[\d.:a-f]+$/.test(ip)) {
  console.error('❌ Error: Invalid IP address format');
  console.error(`   Got: ${ip}`);
  db.close();
  process.exit(1);
}

try {
  // Check if IP is banned
  const ban = db.prepare(`
    SELECT * FROM ip_bans
    WHERE ip_address = ?
      AND unbanned_at IS NULL
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    ORDER BY banned_at DESC
    LIMIT 1
  `).get(ip);

  if (!ban) {
    console.log(`ℹ️  IP ${ip} is not currently banned`);

    // Check if it's in whitelist
    const whitelisted = db.prepare(
      'SELECT * FROM ip_whitelist WHERE ip_address = ?'
    ).get(ip);

    if (whitelisted) {
      console.log(`✓ IP is whitelisted: ${whitelisted.reason}`);
    }

    db.close();
    process.exit(0);
  }

  // Show ban details
  console.log(`Ban details for ${ip}:`);
  console.log(`  Reason: ${ban.reason}`);
  console.log(`  Attack Type: ${ban.attack_type || 'N/A'}`);
  console.log(`  Banned: ${ban.banned_at} ${ban.auto_banned ? '(auto)' : '(manual)'}`);
  console.log(`  Expires: ${ban.expires_at || 'PERMANENT'}`);
  console.log('');

  // Unban
  const result = db.prepare(`
    UPDATE ip_bans
    SET unbanned_at = CURRENT_TIMESTAMP,
        unbanned_by = NULL
    WHERE id = ?
  `).run(ban.id);

  if (result.changes > 0) {
    console.log(`✓ Unbanned ${ip} in local database`);
    console.log('');
    console.log('⚠️  IMPORTANT:');
    console.log('   - This only clears the local ban record');
    console.log('   - Upstream firewalls (UniFi, Cloudflare, etc.) still have blocks');
    console.log('   - Clear those manually or restart the application');
    console.log('');
    console.log('💡 TIP: To prevent re-banning, add to whitelist:');
    console.log(`   node emergency-unban.js --whitelist ${ip}`);
  } else {
    console.log(`❌ Failed to unban ${ip}`);
  }

} catch (error) {
  console.error('❌ Error:', error.message);
  db.close();
  process.exit(1);
}

db.close();
