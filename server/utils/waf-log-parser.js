/**
 * WAF Log Parser Daemon
 *
 * Monitors ModSecurity audit logs in real-time using tail -F,
 * parses JSON entries, inserts events into database, evaluates
 * notification triggers, and broadcasts to SSE clients.
 */

const { spawn } = require('child_process');
const { db, getSetting, setSetting } = require('../db');
const {
  notifyWAFBlock,
  notifyHighSeverityEvent
} = require('./notification-service');
const fs = require('fs');
const path = require('path');

class WAFLogParser {
  constructor() {
    this.tailProcess = null;
    this.isRunning = false;
    const projectRoot = path.join(__dirname, '../..');
    this.logPath = getSetting('waf_audit_log_path') || path.join(projectRoot, 'logs/waf/audit.log');
    this.buffer = '';
    this.broadcastFunction = null; // Will be set by server to broadcast SSE events

    // Throttle cache for notifications (prevent spam)
    this.notificationCache = new Map();
    this.notificationThreshold = parseInt(getSetting('notification_waf_threshold') || '10');
    this.notificationThresholdMinutes = parseInt(getSetting('notification_waf_threshold_minutes') || '5');
  }

  /**
   * Start the log parser daemon
   */
  async start() {
    if (this.isRunning) {
      console.log('📊 WAF log parser is already running');
      return;
    }

    // Check if WAF is enabled
    const wafEnabled = getSetting('waf_enabled');
    if (wafEnabled !== '1') {
      console.log('ℹ️  WAF monitoring disabled in settings');
      return;
    }

    // Check if log file exists
    if (!fs.existsSync(this.logPath)) {
      console.warn(`⚠️  ModSecurity audit log not found: ${this.logPath}`);
      console.warn('   WAF event monitoring will not start.');
      console.warn('   Create the log file or update waf_audit_log_path setting.');
      return;
    }

    try {
      console.log(`📊 Starting WAF log parser daemon...`);
      console.log(`   Monitoring: ${this.logPath}`);

      // Spawn tail -F process (follows log rotation)
      this.tailProcess = spawn('tail', ['-F', '-n', '0', this.logPath], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.tailProcess.stdout.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.tailProcess.stderr.on('data', (data) => {
        const stderr = data.toString();
        // Ignore "file truncated" messages from log rotation
        if (!stderr.includes('file truncated')) {
          console.error('WAF log parser stderr:', stderr);
        }
      });

      this.tailProcess.on('error', (error) => {
        console.error('❌ WAF log parser error:', error.message);
        this.isRunning = false;

        // Attempt restart after 5 seconds
        setTimeout(() => {
          if (!this.isRunning) {
            console.log('🔄 Attempting to restart WAF log parser...');
            this.start().catch(err => {
              console.error('Failed to restart WAF log parser:', err);
            });
          }
        }, 5000);
      });

      this.tailProcess.on('exit', (code, signal) => {
        console.log(`WAF log parser exited (code: ${code}, signal: ${signal})`);
        this.isRunning = false;
      });

      this.isRunning = true;
      console.log('✅ WAF log parser daemon started successfully');

      // Start periodic backfill for HTTP/3 events (every 2 minutes)
      this.startPeriodicBackfill();

    } catch (error) {
      console.error('❌ Failed to start WAF log parser:', error.message);
      throw error;
    }
  }

  /**
   * Start periodic backfill of missing proxy_ids for HTTP/3 events
   */
  startPeriodicBackfill() {
    // Run immediately on startup
    this.backfillHTTP3Events();

    // Then run every 2 minutes
    this.backfillInterval = setInterval(() => {
      this.backfillHTTP3Events();
    }, 120000); // 2 minutes
  }

  /**
   * Backfill missing proxy_ids for HTTP/3 events
   * HTTP/3 requests don't include Host header in ModSecurity logs,
   * so we use heuristic matching based on client IP and timing
   */
  backfillHTTP3Events() {
    try {
      const { getWAFDb } = require('../waf-db');
      const wafDb = getWAFDb();

      if (!wafDb) return;

      // Get unresolved events (last 10 minutes only to avoid processing old data)
      const tenMinsAgo = new Date(Date.now() - 600000).toISOString();
      const unresolved = wafDb.prepare(`
        SELECT id, client_ip, timestamp
        FROM waf_events
        WHERE proxy_id IS NULL
          AND timestamp >= ?
        ORDER BY timestamp DESC
      `).all(tenMinsAgo);

      if (unresolved.length === 0) return;

      let resolved = 0;
      const timeWindow = 300000; // 5 minutes

      for (const event of unresolved) {
        const eventTime = new Date(event.timestamp).getTime();
        const windowStart = new Date(eventTime - timeWindow).toISOString();
        const windowEnd = new Date(eventTime + timeWindow).toISOString();

        // Find events from same client IP within time window that HAVE a proxy_id
        const nearby = wafDb.prepare(`
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

        if (nearby && nearby.proxy_id) {
          wafDb.prepare(`
            UPDATE waf_events
            SET proxy_id = ?
            WHERE id = ?
          `).run(nearby.proxy_id, event.id);
          resolved++;
        }
      }

      if (resolved > 0) {
        console.log(`🔄 Backfilled ${resolved} HTTP/3 event(s) with proxy_id`);
      }
    } catch (error) {
      console.error('Error in backfill:', error.message);
    }
  }

  /**
   * Process buffered log data line by line
   */
  processBuffer() {
    const lines = this.buffer.split('\n');

    // Keep last incomplete line in buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        this.parseLine(line);
      }
    }
  }

  /**
   * Parse a single log line
   * @param {string} line - JSON log entry from ModSecurity
   */
  parseLine(line) {
    try {
      const logEntry = JSON.parse(line);

      // Extract relevant data from ModSecurity JSON format
      const event = this.extractEventData(logEntry);

      if (event) {
        // Insert into database
        const eventId = this.insertEvent(event);

        // Evaluate notification triggers
        if (eventId) {
          this.evaluateTriggers(event);
        }
      }

    } catch (error) {
      // Not JSON or malformed - skip silently
      // ModSecurity logs can contain non-JSON lines during startup
      if (line.includes('{') && line.includes('}')) {
        console.error('Failed to parse WAF log entry:', error.message);
      }
    }
  }

  /**
   * Extract event data from ModSecurity JSON log entry
   * @param {Object} logEntry - Parsed JSON log entry
   * @returns {Object|null} - Extracted event data
   */
  extractEventData(logEntry) {
    try {
      const transaction = logEntry.transaction || {};
      const request = transaction.request || {};
      const messages = transaction.messages || [];

      // Skip if no security messages (not an attack)
      if (messages.length === 0) {
        return null;
      }

      // Get first (most severe) message
      const primaryMessage = messages[0];
      const details = primaryMessage.details || {};

      // Extract attack type from rule tags
      const tags = details.tags || [];
      let attackType = 'unknown';

      // Check for specific attack types by finding attack- prefixed tags
      for (const tag of tags) {
        if (tag.startsWith('attack-')) {
          attackType = tag.replace('attack-', '');
          break;
        }
      }

      // Fallback to protocol-violation if no attack type found but messages exist
      if (attackType === 'unknown' && tags.length > 0) {
        attackType = 'protocol-violation';
      }

      // Determine if request was blocked
      // Check HTTP response code (403 = blocked) or producer.intercepted field
      const response = transaction.response || {};
      const producer = transaction.producer || {};
      const httpCode = response.http_code || 0;

      // A request is blocked if:
      // 1. HTTP response is 403 (Forbidden), OR
      // 2. producer.intercepted is true
      const blocked = (httpCode === 403 || producer.intercepted === true) ? 1 : 0;

      const event = {
        timestamp: new Date(transaction.time_stamp).toISOString(),
        client_ip: transaction.client_ip || 'unknown',
        request_uri: request.uri || '',
        request_method: request.method || 'GET',
        attack_type: attackType,
        rule_id: details.ruleId || '',
        severity: String(details.severity || '0'),
        message: primaryMessage.message || 'WAF rule triggered',
        raw_log: JSON.stringify(logEntry),
        blocked: blocked,
        proxy_id: null // Will be resolved below
      };

      // Try to extract hostname for proxy_id resolution
      // Priority: 1) X-Proxy-Target header (set by nginx), 2) Host header, 3) host_ip fallback
      let hostname = null;

      if (request.headers) {
        // Check for X-Proxy-Target header (contains nginx $server_name for HTTP/2 and HTTP/3)
        hostname = request.headers['X-Proxy-Target'] ||
                   request.headers['x-proxy-target'] ||
                   request.headers.Host ||
                   request.headers.host ||
                   null;
      }

      event.proxy_id = this.resolveProxyId(hostname, transaction.host_ip);

      return event;

    } catch (error) {
      console.error('Error extracting event data:', error);
      return null;
    }
  }

  /**
   * Resolve proxy_id from hostname or host IP
   * @param {string} hostname - Request Host header (e.g., cloud.tidnag.com)
   * @param {string} hostIp - Target host IP (fallback)
   * @returns {number|null} - proxy_id or null
   */
  resolveProxyId(hostname, hostIp) {
    try {
      if (!db) return null;

      // First, try to match by domain_names (the frontend domain)
      if (hostname) {
        const stmt = db.prepare(`
          SELECT id FROM proxy_hosts
          WHERE domain_names LIKE ?
          LIMIT 1
        `);

        const result = stmt.get(`%${hostname}%`);
        if (result) return result.id;
      }

      // Fallback: try to match by forward_host (backend IP)
      if (hostIp) {
        const stmt = db.prepare(`
          SELECT id FROM proxy_hosts
          WHERE forward_host = ?
          OR forward_host LIKE ?
          LIMIT 1
        `);

        const result = stmt.get(hostIp, `%${hostIp}%`);
        if (result) return result.id;
      }

      return null;

    } catch (error) {
      console.error('Error resolving proxy_id:', error);
      return null;
    }
  }

  /**
   * Insert event into waf_events table
   * @param {Object} event - Event data
   * @returns {number|null} - Inserted event ID or null
   */
  insertEvent(event) {
    try {
      const { batcher } = require('../waf-db');

      // Add event to batch buffer
      batcher.addEvent(event);

      // Broadcast to SSE clients (without ID since batching is async)
      if (this.broadcastFunction) {
        this.broadcastFunction({
          id: null, // ID will be assigned during batch flush
          ...event
        });
      }

      return true;

    } catch (error) {
      console.error('Error buffering WAF event:', error);
      return false;
    }
  }

  /**
   * Evaluate notification triggers for an event
   * @param {Object} event - WAF event
   */
  async evaluateTriggers(event) {
    try {
      // High severity event notification
      if (event.severity === 'CRITICAL' || event.severity === 'ERROR') {
        const notifyHighSeverity = getSetting('notification_waf_high_severity') === '1';

        if (notifyHighSeverity) {
          // Throttle per client IP to prevent spam
          const cacheKey = `high_severity_${event.client_ip}`;
          const lastNotification = this.notificationCache.get(cacheKey);
          const now = Date.now();

          // Only notify once per IP per 5 minutes
          if (!lastNotification || (now - lastNotification) > 5 * 60 * 1000) {
            this.notificationCache.set(cacheKey, now);

            await notifyHighSeverityEvent(event).catch(err => {
              console.error('Failed to send high severity notification:', err);
            });
          }
        }
      }

      // Blocked attack notification (with threshold)
      if (event.blocked) {
        const notifyBlocks = getSetting('notification_waf_blocks') === '1';

        if (notifyBlocks) {
          // Check threshold: only notify after X events in Y minutes
          const recentEvents = this.getRecentBlockedEvents(this.notificationThresholdMinutes);

          if (recentEvents >= this.notificationThreshold) {
            const cacheKey = 'waf_blocks_threshold';
            const lastNotification = this.notificationCache.get(cacheKey);
            const now = Date.now();

            // Only notify once per threshold period
            if (!lastNotification || (now - lastNotification) > this.notificationThresholdMinutes * 60 * 1000) {
              this.notificationCache.set(cacheKey, now);

              await notifyWAFBlock(event).catch(err => {
                console.error('Failed to send WAF block notification:', err);
              });
            }
          }
        }
      }

    } catch (error) {
      console.error('Error evaluating notification triggers:', error);
    }
  }

  /**
   * Get count of recent blocked events
   * @param {number} minutes - Time window in minutes
   * @returns {number} - Count of blocked events
   */
  getRecentBlockedEvents(minutes) {
    try {
      const { getWAFDb } = require('../waf-db');
      const wafDb = getWAFDb();

      if (!wafDb) return 0;

      const cutoffTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();

      const result = wafDb.prepare(`
        SELECT COUNT(*) as count FROM waf_events
        WHERE timestamp >= ? AND blocked = 1
      `).get(cutoffTime);

      return result?.count || 0;

    } catch (error) {
      console.error('Error getting recent blocked events:', error);
      return 0;
    }
  }

  /**
   * Set the SSE broadcast function
   * @param {Function} broadcastFn - Function to broadcast events to SSE clients
   */
  setBroadcastFunction(broadcastFn) {
    this.broadcastFunction = broadcastFn;
  }

  /**
   * Stop the log parser daemon
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping WAF log parser daemon...');

    // Stop backfill interval
    if (this.backfillInterval) {
      clearInterval(this.backfillInterval);
      this.backfillInterval = null;
    }

    if (this.tailProcess) {
      this.tailProcess.kill('SIGTERM');

      // Wait for graceful shutdown
      await new Promise((resolve) => {
        setTimeout(() => {
          if (this.tailProcess && !this.tailProcess.killed) {
            this.tailProcess.kill('SIGKILL');
          }
          resolve();
        }, 2000);
      });

      this.tailProcess = null;
    }

    this.isRunning = false;
    console.log('✅ WAF log parser daemon stopped');
  }

  /**
   * Check if parser is running
   * @returns {boolean}
   */
  isParserRunning() {
    return this.isRunning;
  }
}

// Singleton instance
let parserInstance = null;

function getWAFLogParser() {
  if (!parserInstance) {
    parserInstance = new WAFLogParser();
  }
  return parserInstance;
}

module.exports = {
  WAFLogParser,
  getWAFLogParser
};
