#!/usr/bin/env node

/**
 * Backfill missing proxy_ids for HTTP/3 WAF events
 *
 * HTTP/3 requests don't include the Host header in ModSecurity audit logs,
 * so proxy_id remains NULL. This script uses heuristic matching to resolve them.
 *
 * Strategy:
 * 1. Group events by client_ip and time window (30 seconds)
 * 2. If any events in the group have a resolved proxy_id, apply it to all
 * 3. This assumes the same client hitting the same proxy in a short time window
 */

const { db } = require('./server/db');

console.log('🔍 Finding HTTP/3 events with missing proxy_id...\n');

// Get all events with NULL proxy_id
const unresolved = db.prepare(`
  SELECT id, client_ip, timestamp, request_uri
  FROM waf_events
  WHERE proxy_id IS NULL
  ORDER BY timestamp DESC
`).all();

console.log(`Found ${unresolved.length} unresolved events\n`);

if (unresolved.length === 0) {
  console.log('✨ No events need backfilling!');
  process.exit(0);
}

let resolved = 0;
const timeWindow = 300000; // 5 minutes in milliseconds (expanded window)

// Process each unresolved event
for (const event of unresolved) {
  const eventTime = new Date(event.timestamp).getTime();
  const windowStart = new Date(eventTime - timeWindow).toISOString();
  const windowEnd = new Date(eventTime + timeWindow).toISOString();

  // Strategy 1: Find events from same client IP within time window that HAVE a proxy_id
  let nearby = db.prepare(`
    SELECT proxy_id, COUNT(*) as count
    FROM waf_events
    WHERE client_ip = ?
      AND proxy_id IS NOT NULL
      AND timestamp >= ?
      AND timestamp <= ?
    GROUP BY proxy_id
    ORDER BY count DESC
    LIMIT 1
  `).get(event.client_ip, windowStart, windowEnd);

  // Strategy 2: If no match, look for recent events from ANY client to same proxy (last 10 mins)
  if (!nearby) {
    const recentStart = new Date(eventTime - 600000).toISOString(); // 10 minutes back
    nearby = db.prepare(`
      SELECT proxy_id, COUNT(*) as count
      FROM waf_events
      WHERE proxy_id IS NOT NULL
        AND timestamp >= ?
        AND timestamp <= ?
      GROUP BY proxy_id
      ORDER BY count DESC
      LIMIT 1
    `).get(recentStart, event.timestamp);
  }

  if (nearby && nearby.proxy_id) {
    // Update the event with the resolved proxy_id
    db.prepare(`
      UPDATE waf_events
      SET proxy_id = ?
      WHERE id = ?
    `).run(nearby.proxy_id, event.id);

    resolved++;

    // Get proxy name for display
    const proxy = db.prepare('SELECT name FROM proxy_hosts WHERE id = ?').get(nearby.proxy_id);
    console.log(`✓ Event ${event.id}: ${event.client_ip} → ${proxy.name}`);
  }
}

console.log('');
console.log(`📊 Results:`);
console.log(`   Total unresolved events: ${unresolved.length}`);
console.log(`   Successfully resolved: ${resolved}`);
console.log(`   Still unresolved: ${unresolved.length - resolved}`);

if (resolved > 0) {
  console.log('');
  console.log('✨ Backfill complete! Refresh your WAF Dashboard to see the changes.');
}
