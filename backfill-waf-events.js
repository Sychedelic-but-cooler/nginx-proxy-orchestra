#!/usr/bin/env node

/**
 * WAF Events Backfill Script
 *
 * Reads the audit.log file and imports any missing events into the database.
 * This is useful after fixing parser issues to catch up on missed events.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const AUDIT_LOG_PATH = '/nginx-proxy-orchestra/logs/waf/audit.log';
const DB_PATH = '/nginx-proxy-orchestra/data/database.sqlite';

// Initialize database
const db = new Database(DB_PATH);

// Attack type mapping (from ModSecurity tags)
function determineAttackType(tags) {
  if (!tags || !Array.isArray(tags)) return 'unknown';

  const tagStr = tags.join(' ').toLowerCase();

  if (tagStr.includes('attack-sqli') || tagStr.includes('sql')) return 'sqli';
  if (tagStr.includes('attack-xss') || tagStr.includes('xss')) return 'xss';
  if (tagStr.includes('attack-rce') || tagStr.includes('command-injection')) return 'rce';
  if (tagStr.includes('attack-lfi') || tagStr.includes('attack-rfi')) return 'lfi';
  if (tagStr.includes('protocol-attack') || tagStr.includes('attack-protocol')) return 'protocol';
  if (tagStr.includes('protocol-enforcement')) return 'protocol-violation';
  if (tagStr.includes('scanner-detection')) return 'scanner';
  if (tagStr.includes('session-fixation')) return 'session';

  return 'unknown';
}

// Extract rule ID from message
function extractRuleId(message) {
  if (!message || !message.details) return null;
  return message.details.ruleId || null;
}

// Extract severity
function extractSeverity(message) {
  if (!message || !message.details) return 0;
  return message.details.severity || 0;
}

// Find proxy ID by matching hostname
function findProxyId(hostname) {
  if (!hostname) return null;

  const proxy = db.prepare(`
    SELECT id FROM proxy_hosts
    WHERE domain_names LIKE ?
    LIMIT 1
  `).get(`%${hostname}%`);

  return proxy ? proxy.id : null;
}

// Check if event already exists (duplicate detection)
function eventExists(clientIp, timestamp, ruleId) {
  const existing = db.prepare(`
    SELECT id FROM waf_events
    WHERE client_ip = ? AND timestamp = ? AND rule_id = ?
    LIMIT 1
  `).get(clientIp, timestamp, ruleId);

  return !!existing;
}

// Insert event into database
function insertEvent(event) {
  try {
    const stmt = db.prepare(`
      INSERT INTO waf_events (
        proxy_id, client_ip, timestamp, request_method, request_uri,
        attack_type, severity, rule_id, message, blocked, raw_log
      ) VALUES (?, ?, ?,?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.proxy_id,
      event.client_ip,
      event.timestamp,
      event.request_method,
      event.request_uri,
      event.attack_type,
      event.severity,
      event.rule_id,
      event.message,
      event.blocked ? 1 : 0,
      event.raw_log
    );

    return true;
  } catch (error) {
    console.error('Failed to insert event:', error.message);
    return false;
  }
}

// Parse a single audit log line
function parseAuditLogLine(line) {
  try {
    const entry = JSON.parse(line);

    if (!entry.transaction) {
      console.warn('Skipping entry - no transaction object');
      return null;
    }

    const tx = entry.transaction;

    // Extract messages
    const messages = tx.messages || [];
    if (messages.length === 0) {
      console.warn('Skipping entry - no messages');
      return null;
    }

    // Get first message (primary detection)
    const firstMessage = messages[0];

    // Extract data
    const clientIp = tx.client_ip;
    const timestamp = tx.time_stamp;
    const requestMethod = tx.request?.method || 'GET';
    const requestUri = tx.request?.uri || '/';
    const hostname = tx.request?.headers?.Host;

    // Attack classification
    const tags = firstMessage.details?.tags || [];
    const attackType = determineAttackType(tags);
    const ruleId = extractRuleId(firstMessage);
    const severity = extractSeverity(firstMessage);
    const message = firstMessage.message || 'Unknown violation';

    // Determine if blocked (look for 403 response or disruptive action)
    const httpCode = tx.response?.http_code || 200;
    const blocked = httpCode === 403;

    // Find proxy
    const proxyId = findProxyId(hostname);

    return {
      proxy_id: proxyId,
      client_ip: clientIp,
      timestamp: timestamp,
      request_method: requestMethod,
      request_uri: requestUri,
      attack_type: attackType,
      severity: severity,
      rule_id: ruleId,
      message: message,
      blocked: blocked,
      raw_log: JSON.stringify(entry)
    };

  } catch (error) {
    console.error('Failed to parse line:', error.message);
    return null;
  }
}

// Main backfill function
function backfillEvents() {
  console.log('═══════════════════════════════════════════════════');
  console.log('         WAF Events Backfill Tool');
  console.log('═══════════════════════════════════════════════════\n');

  // Check if audit log exists
  if (!fs.existsSync(AUDIT_LOG_PATH)) {
    console.error('❌ Audit log not found:', AUDIT_LOG_PATH);
    process.exit(1);
  }

  // Check if database exists
  if (!fs.existsSync(DB_PATH)) {
    console.error('❌ Database not found:', DB_PATH);
    process.exit(1);
  }

  // Get current event count
  const currentCount = db.prepare('SELECT COUNT(*) as count FROM waf_events').get().count;
  console.log(`📊 Current events in database: ${currentCount}`);

  // Read audit log
  const auditContent = fs.readFileSync(AUDIT_LOG_PATH, 'utf8');
  const lines = auditContent.trim().split('\n').filter(line => line.trim());

  console.log(`📄 Audit log lines to process: ${lines.length}\n`);

  let processed = 0;
  let skipped = 0;
  let inserted = 0;
  let errors = 0;

  console.log('Processing events...\n');

  for (const line of lines) {
    processed++;

    // Parse the line
    const event = parseAuditLogLine(line);

    if (!event) {
      errors++;
      continue;
    }

    // Check if already exists
    if (eventExists(event.client_ip, event.timestamp, event.rule_id)) {
      skipped++;
      continue;
    }

    // Insert new event
    if (insertEvent(event)) {
      inserted++;
      console.log(`✓ Imported: ${event.client_ip} → ${event.attack_type} (Rule ${event.rule_id})`);
    } else {
      errors++;
    }
  }

  // Final summary
  const newCount = db.prepare('SELECT COUNT(*) as count FROM waf_events').get().count;

  console.log('\n═══════════════════════════════════════════════════');
  console.log('                    Summary');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Total lines processed:     ${processed}`);
  console.log(`Events already in DB:      ${skipped} (duplicates)`);
  console.log(`New events inserted:       ${inserted}`);
  console.log(`Errors/skipped:            ${errors}`);
  console.log(`───────────────────────────────────────────────────`);
  console.log(`Database events before:    ${currentCount}`);
  console.log(`Database events after:     ${newCount}`);
  console.log(`Net change:                +${newCount - currentCount}`);
  console.log('═══════════════════════════════════════════════════\n');

  if (inserted > 0) {
    console.log('✅ Backfill completed successfully!');
    console.log('   Refresh your WAF Dashboard to see the new events.\n');
  } else {
    console.log('ℹ️  No new events to import - database is up to date.\n');
  }

  db.close();
}

// Run the backfill
try {
  backfillEvents();
} catch (error) {
  console.error('\n❌ Backfill failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
