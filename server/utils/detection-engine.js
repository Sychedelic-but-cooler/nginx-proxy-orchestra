/**
 * Detection Engine
 *
 * Monitors WAF events and automatically bans IPs based on detection rules
 * - Tracks events in memory with sliding time windows
 * - Checks thresholds against configured rules
 * - Triggers automatic bans when rules match
 */

const { db } = require('../db');
const { banIP } = require('./ban-service');
const { isWhitelisted } = require('./ip-utils');

// In-memory event tracker: Map<ip_address, Array<event>>
const ipEvents = new Map();

// Last processed event ID (for polling)
let lastProcessedEventId = 0;

// Polling interval handle
let pollingInterval = null;

/**
 * Track a WAF event for an IP
 */
function trackEvent(ip, event) {
  // Skip if whitelisted
  if (isWhitelisted(ip)) {
    return;
  }

  if (!ipEvents.has(ip)) {
    ipEvents.set(ip, []);
  }

  const events = ipEvents.get(ip);
  events.push({
    timestamp: Date.now(),
    attack_type: event.attack_type,
    severity: event.severity,
    proxy_id: event.proxy_id,
    event_id: event.id
  });

  // Keep only last hour of events (memory management)
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  ipEvents.set(ip, events.filter(e => e.timestamp > oneHourAgo));

  // Check if any rules are triggered
  checkRules(ip);
}

/**
 * Check if IP should be banned based on detection rules
 */
function checkRules(ip) {
  // Get all enabled rules
  const rules = db.prepare(`
    SELECT * FROM ips_detection_rules
    WHERE enabled = 1
    ORDER BY priority ASC
  `).all();

  const events = ipEvents.get(ip) || [];

  if (events.length === 0) return;

  for (const rule of rules) {
    const windowStart = Date.now() - (rule.time_window * 1000);

    // Filter events in time window
    let relevantEvents = events.filter(e => e.timestamp >= windowStart);

    // Filter by attack types if specified
    if (rule.attack_types) {
      try {
        const types = JSON.parse(rule.attack_types);
        if (Array.isArray(types) && types.length > 0) {
          relevantEvents = relevantEvents.filter(e => types.includes(e.attack_type));
        }
      } catch (error) {
        console.error(`Invalid attack_types JSON in rule ${rule.id}:`, error);
        continue;
      }
    }

    // Filter by severity if specified
    if (rule.severity_filter && rule.severity_filter !== 'ALL') {
      const severityOrder = ['WARNING', 'ERROR', 'CRITICAL'];
      const minSeverityIndex = severityOrder.indexOf(rule.severity_filter);

      if (minSeverityIndex !== -1) {
        relevantEvents = relevantEvents.filter(e => {
          const eventSeverityIndex = severityOrder.indexOf(e.severity);
          return eventSeverityIndex >= minSeverityIndex;
        });
      }
    }

    // Filter by proxy if specified
    if (rule.proxy_id) {
      relevantEvents = relevantEvents.filter(e => e.proxy_id === rule.proxy_id);
    }

    // Check threshold
    if (relevantEvents.length >= rule.threshold) {
      console.log(`\n🚨 Detection rule triggered: "${rule.name}" for IP ${ip}`);
      console.log(`   Events: ${relevantEvents.length}/${rule.threshold} in ${rule.time_window}s window`);

      // Extract attack types from events
      const attackTypes = [...new Set(relevantEvents.map(e => e.attack_type))].filter(Boolean);

      // Ban the IP
      banIP(ip, {
        reason: `Auto-ban: ${rule.name} (${relevantEvents.length} events in ${rule.time_window}s)`,
        attack_type: attackTypes.length > 0 ? attackTypes.join(', ') : 'Multiple',
        event_count: relevantEvents.length,
        severity: rule.ban_severity || 'MEDIUM',
        ban_duration: rule.ban_duration,
        auto_banned: true,
        detection_rule_id: rule.id,
        proxy_id: relevantEvents[0]?.proxy_id,
        sample_events: relevantEvents.slice(0, 5).map(e => e.event_id)
      }).then(result => {
        if (result.success) {
          console.log(`   ✓ Ban issued for ${ip}`);
        } else {
          console.log(`   ⚠️  Failed to ban ${ip}: ${result.message}`);
        }
      }).catch(error => {
        console.error(`   ❌ Error banning ${ip}:`, error.message);
      });

      // Clear events for this IP to prevent duplicate bans
      ipEvents.delete(ip);

      break;  // Stop checking other rules for this IP
    }
  }
}

/**
 * Start the detection engine (poll WAF events)
 */
function startDetectionEngine() {
  if (pollingInterval) {
    console.log('Detection engine already running');
    return;
  }

  // Get WAF database
  const { getWAFDb } = require('../waf-db');
  const wafDb = getWAFDb();

  // Get the last event ID from database on startup
  const lastEvent = wafDb.prepare('SELECT id FROM waf_events ORDER BY id DESC LIMIT 1').get();
  lastProcessedEventId = lastEvent?.id || 0;

  console.log(`Starting detection engine from event ID: ${lastProcessedEventId}`);

  // Poll for new events every 5 seconds
  pollingInterval = setInterval(() => {
    try {
      // Get new events since last check
      const events = wafDb.prepare(`
        SELECT * FROM waf_events
        WHERE id > ?
        ORDER BY id ASC
        LIMIT 1000
      `).all(lastProcessedEventId);

      if (events.length > 0) {
        console.log(`Processing ${events.length} new WAF events...`);

        for (const event of events) {
          trackEvent(event.client_ip, event);
          lastProcessedEventId = event.id;
        }
      }
    } catch (error) {
      console.error('Detection engine polling error:', error);
    }
  }, 5000);

  console.log('✓ Detection engine started (polling every 5 seconds)');
}

/**
 * Stop the detection engine
 */
function stopDetectionEngine() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('Detection engine stopped');
  }
}

/**
 * Cleanup old events from memory periodically
 */
function startCleanupJob() {
  setInterval(() => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    let cleaned = 0;

    for (const [ip, events] of ipEvents.entries()) {
      const filtered = events.filter(e => e.timestamp > oneHourAgo);

      if (filtered.length === 0) {
        ipEvents.delete(ip);
        cleaned++;
      } else if (filtered.length !== events.length) {
        ipEvents.set(ip, filtered);
      }
    }

    if (cleaned > 0) {
      console.log(`✓ Cleaned up event tracking for ${cleaned} IPs`);
    }
  }, 5 * 60 * 1000);  // Every 5 minutes

  console.log('✓ Detection engine cleanup job started');
}

/**
 * Get detection engine statistics
 */
function getDetectionStats() {
  const totalIPs = ipEvents.size;
  let totalEvents = 0;

  for (const events of ipEvents.values()) {
    totalEvents += events.length;
  }

  const rules = db.prepare(`
    SELECT
      COUNT(*) as total_rules,
      COUNT(CASE WHEN enabled = 1 THEN 1 END) as enabled_rules
    FROM ips_detection_rules
  `).get();

  return {
    tracked_ips: totalIPs,
    tracked_events: totalEvents,
    ...rules,
    last_processed_event_id: lastProcessedEventId
  };
}

/**
 * Get tracked IPs with their event counts
 */
function getTrackedIPs(limit = 100) {
  const tracked = [];

  for (const [ip, events] of ipEvents.entries()) {
    const attackTypes = [...new Set(events.map(e => e.attack_type))].filter(Boolean);

    tracked.push({
      ip,
      event_count: events.length,
      attack_types: attackTypes,
      first_seen: new Date(Math.min(...events.map(e => e.timestamp))).toISOString(),
      last_seen: new Date(Math.max(...events.map(e => e.timestamp))).toISOString()
    });
  }

  // Sort by event count (highest first)
  tracked.sort((a, b) => b.event_count - a.event_count);

  return tracked.slice(0, limit);
}

/**
 * Manually trigger rule check for an IP (for testing)
 */
function triggerRuleCheck(ip) {
  checkRules(ip);
}

module.exports = {
  trackEvent,
  startDetectionEngine,
  stopDetectionEngine,
  startCleanupJob,
  getDetectionStats,
  getTrackedIPs,
  triggerRuleCheck
};
