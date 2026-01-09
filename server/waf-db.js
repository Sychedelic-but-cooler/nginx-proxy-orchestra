const Database = require('better-sqlite3');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const wafDbPath = path.join(dataDir, 'waf-events.sqlite');

let wafDb = null;

function initializeWAFDatabase() {
  wafDb = new Database(wafDbPath);

  wafDb.pragma('journal_mode = WAL');
  wafDb.pragma('synchronous = NORMAL');
  wafDb.pragma('cache_size = -64000');

  // Attach main database for proxy_hosts JOIN operations
  // Note: We use 'maindb' as the alias because 'main' is reserved for the primary database (waf-events.sqlite)
  const mainDbPath = path.join(dataDir, 'database.sqlite');

  // Check if main database is already attached
  let isAttached = false;
  try {
    const attachedDbs = wafDb.prepare("PRAGMA database_list").all();
    isAttached = attachedDbs.some(db => db.name === 'maindb');
  } catch (error) {
    // Ignore pragma errors
  }

  if (!isAttached) {
    try {
      wafDb.exec(`ATTACH DATABASE '${mainDbPath}' AS maindb`);
      console.log('✓ Main database attached to WAF database as maindb');
    } catch (error) {
      console.error('⚠ Failed to attach main database:', error.message);
      throw error;
    }
  }

  // Verify attachment by checking if we can see proxy_hosts table
  try {
    const tables = wafDb.prepare("SELECT name FROM maindb.sqlite_master WHERE type='table' AND name='proxy_hosts'").all();
    if (tables.length === 0) {
      console.error('⚠ Warning: proxy_hosts table not found in attached main database');
    } else {
      console.log('✓ Verified proxy_hosts table accessible in maindb');
    }
  } catch (verifyError) {
    console.error('⚠ Warning: Could not verify main database attachment:', verifyError.message);
  }

  wafDb.exec(`
    CREATE TABLE IF NOT EXISTS waf_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proxy_id INTEGER,
      timestamp DATETIME NOT NULL,
      client_ip TEXT NOT NULL,
      request_uri TEXT,
      request_method TEXT,
      attack_type TEXT,
      rule_id TEXT,
      severity TEXT,
      message TEXT,
      raw_log TEXT,
      blocked INTEGER DEFAULT 0,
      notified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_waf_events_timestamp ON waf_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_waf_events_proxy ON waf_events(proxy_id);
    CREATE INDEX IF NOT EXISTS idx_waf_events_ip ON waf_events(client_ip);
    CREATE INDEX IF NOT EXISTS idx_waf_events_attack_type ON waf_events(attack_type);
    CREATE INDEX IF NOT EXISTS idx_waf_events_severity ON waf_events(severity);
    CREATE INDEX IF NOT EXISTS idx_waf_events_blocked ON waf_events(blocked);
  `);

  console.log('✓ WAF events database initialized');
}

class WAFEventBatcher {
  constructor() {
    this.buffer = [];
    this.maxBufferSize = 100;
    this.flushInterval = 2000; // 2 seconds
    this.flushTimer = null;
    this.insertStmt = null;
  }

  start() {
    this.insertStmt = wafDb.prepare(`
      INSERT INTO waf_events (
        proxy_id, timestamp, client_ip, request_uri, request_method,
        attack_type, rule_id, severity, message, raw_log, blocked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
    console.log('✓ WAF event batcher started (flush every 2s)');
  }

  addEvent(event) {
    this.buffer.push(event);
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  flush() {
    if (this.buffer.length === 0) return;

    const eventsToInsert = [...this.buffer];
    this.buffer = [];

    try {
      const insertMany = wafDb.transaction((events) => {
        for (const event of events) {
          this.insertStmt.run(
            event.proxy_id, event.timestamp, event.client_ip,
            event.request_uri, event.request_method, event.attack_type,
            event.rule_id, event.severity, event.message,
            event.raw_log, event.blocked
          );
        }
      });

      insertMany(eventsToInsert);

    } catch (error) {
      console.error('Error flushing WAF events:', error);
      this.buffer.unshift(...eventsToInsert);
    }
  }

  stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}

const batcher = new WAFEventBatcher();

function getWAFDb() {
  return wafDb;
}

function startCleanupJob() {
  const scheduleNextCleanup = () => {
    const now = new Date();
    const next2AM = new Date(now);
    next2AM.setHours(2, 0, 0, 0);

    if (next2AM <= now) {
      next2AM.setDate(next2AM.getDate() + 1);
    }

    const msUntil2AM = next2AM - now;

    setTimeout(() => {
      cleanupOldEvents();
      scheduleNextCleanup();
    }, msUntil2AM);
  };

  scheduleNextCleanup();
  console.log('✓ WAF cleanup job scheduled (daily at 2 AM, 90-day retention)');
}

function cleanupOldEvents() {
  const retentionDays = 90;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = wafDb.prepare(`
    DELETE FROM waf_events
    WHERE timestamp < ?
  `).run(cutoffDate.toISOString());

  console.log(`✓ Cleaned ${result.changes} WAF events older than ${retentionDays} days`);

  // Reclaim space
  wafDb.exec('VACUUM');
}

module.exports = {
  initializeWAFDatabase,
  batcher,
  getWAFDb,
  startCleanupJob,
  cleanupOldEvents
};
