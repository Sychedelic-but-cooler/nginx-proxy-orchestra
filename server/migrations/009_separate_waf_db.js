function runSeparateWAFDBMigration(db) {
  console.log('Running migration: Separate WAF events database...');

  const { initializeWAFDatabase, getWAFDb } = require('../waf-db');
  initializeWAFDatabase();
  const wafDb = getWAFDb();

  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='waf_events'"
  ).get();

  if (!tableExists) {
    console.log('  No existing waf_events table to migrate');
    return;
  }

  const count = db.prepare('SELECT COUNT(*) as count FROM waf_events').get();
  console.log(`  Migrating ${count.count} existing WAF events...`);

  if (count.count > 0) {
    const batchSize = 1000;
    let offset = 0;

    const selectStmt = db.prepare(
      'SELECT * FROM waf_events ORDER BY id LIMIT ? OFFSET ?'
    );

    const insertStmt = wafDb.prepare(`
      INSERT INTO waf_events (
        id, proxy_id, timestamp, client_ip, request_uri, request_method,
        attack_type, rule_id, severity, message, raw_log, blocked,
        notified, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertBatch = wafDb.transaction((events) => {
      for (const event of events) {
        insertStmt.run(
          event.id, event.proxy_id, event.timestamp, event.client_ip,
          event.request_uri, event.request_method, event.attack_type,
          event.rule_id, event.severity, event.message, event.raw_log,
          event.blocked, event.notified, event.created_at
        );
      }
    });

    while (offset < count.count) {
      const events = selectStmt.all(batchSize, offset);
      insertBatch(events);
      offset += batchSize;
      console.log(`  Migrated ${Math.min(offset, count.count)}/${count.count}`);
    }
  }

  console.log('  Dropping waf_events from main database...');
  db.exec('DROP TABLE waf_events');

  console.log('✓ WAF events database separation completed');
}

module.exports = { runSeparateWAFDBMigration };
