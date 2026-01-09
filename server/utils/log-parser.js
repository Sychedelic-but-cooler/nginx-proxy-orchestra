const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Cache for parsed statistics
let statsCache = {
  data: null,
  timestamp: null,
  cacheLifetime: 30 * 60 * 1000 // 30 minutes in milliseconds
};

/**
 * Get nginx access log path
 */
function getAccessLogPath() {
  return process.env.NGINX_ACCESS_LOG || '/var/log/nginx/access.log';
}

/**
 * Parse a single nginx log line (enhanced format with server_name)
 * New format: $server_name $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
 * Old format: $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
 */
function parseLogLine(line) {
  // Try new format first (with server_name at the beginning)
  const newFormatRegex = /^(\S+) (\S+) - (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"/;
  let match = line.match(newFormatRegex);
  let serverName = null;

  if (match) {
    // New format with server_name
    const [, server, ip, user, timestamp, request, status, bytes, referer, userAgent] = match;
    serverName = server;

    // Parse request into method, path, protocol
    const requestParts = request.split(' ');
    const method = requestParts[0] || '-';
    const path = requestParts[1] || '-';
    const protocol = requestParts[2] || '-';

    // Parse timestamp
    const date = parseNginxTimestamp(timestamp);

    return {
      serverName,
      ip,
      user: user === '-' ? null : user,
      timestamp: date,
      method,
      path,
      protocol,
      status: parseInt(status),
      bytes: bytes === '-' ? 0 : parseInt(bytes),
      referer: referer === '-' ? null : referer,
      userAgent: userAgent === '-' ? null : userAgent
    };
  }

  // Try old format (without server_name) for backwards compatibility
  const oldFormatRegex = /^(\S+) - (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"/;
  match = line.match(oldFormatRegex);

  if (!match) {
    return null;
  }

  const [, ip, user, timestamp, request, status, bytes, referer, userAgent] = match;

  // Parse request into method, path, protocol
  const requestParts = request.split(' ');
  const method = requestParts[0] || '-';
  const path = requestParts[1] || '-';
  const protocol = requestParts[2] || '-';

  // Parse timestamp
  const date = parseNginxTimestamp(timestamp);

  return {
    serverName: null, // Old format doesn't have server_name
    ip,
    user: user === '-' ? null : user,
    timestamp: date,
    method,
    path,
    protocol,
    status: parseInt(status),
    bytes: bytes === '-' ? 0 : parseInt(bytes),
    referer: referer === '-' ? null : referer,
    userAgent: userAgent === '-' ? null : userAgent
  };
}

/**
 * Parse nginx timestamp format: 05/Jan/2026:10:30:45 +0000
 */
function parseNginxTimestamp(timestamp) {
  const months = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  };

  const match = timestamp.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return new Date();

  const [, day, month, year, hour, minute, second] = match;
  return new Date(year, months[month], day, hour, minute, second);
}

/**
 * Read log file (entire file if numLines is null, otherwise last N lines)
 */
function readLastLines(filePath, numLines = null) {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.warn(`Access log not found: ${filePath}`);
      return [];
    }

    // If numLines is null, read entire file (since nginx rotates daily)
    // Otherwise, use tail for last N lines
    let command;
    if (numLines === null) {
      command = `cat "${filePath}"`;
    } else {
      command = `sudo tail -n ${numLines} "${filePath}" 2>/dev/null`;
    }

    const output = execSync(command, {
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024, // 100MB buffer (for full log file)
      timeout: 30000 // 30 second timeout (longer for full file)
    });

    return output.trim().split('\n').filter(line => line.trim());
  } catch (error) {
    console.error('Error reading access log:', error.message);
    return [];
  }
}

/**
 * Extract host from server_name, request path, or referer
 * Tries to match against known proxy hosts
 */
function extractHost(logEntry, proxyHosts) {
  // First priority: Use server_name from log entry if available
  if (logEntry.serverName && logEntry.serverName !== '-') {
    const host = proxyHosts.find(h =>
      h.domain_names && h.domain_names.split(',').some(d => d.trim() === logEntry.serverName)
    );
    if (host) return host.name;

    // If server_name doesn't match any proxy, return it as-is
    // This handles default server or direct IP access
    return logEntry.serverName;
  }

  // Second priority: Try to extract from referer if it's a full URL
  if (logEntry.referer && logEntry.referer.startsWith('http')) {
    try {
      const url = new URL(logEntry.referer);
      const host = proxyHosts.find(h =>
        h.domain_names && h.domain_names.split(',').some(d => d.trim() === url.hostname)
      );
      if (host) return host.name;
    } catch (e) {
      // Invalid URL, ignore
    }
  }

  // Fallback: Unknown (for old log format without server_name)
  return 'Unknown';
}

/**
 * Aggregate statistics from parsed log entries
 */
function aggregateStatistics(entries, proxyHosts = [], timeRange = 'all') {
  const now = Date.now();
  const timeRanges = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };

  // Filter by time range
  const cutoff = timeRanges[timeRange] ? now - timeRanges[timeRange] : 0;
  const filteredEntries = entries.filter(e => e.timestamp.getTime() >= cutoff);

  if (filteredEntries.length === 0) {
    return getEmptyStats();
  }

  // Initialize counters
  const stats = {
    totalRequests: filteredEntries.length,
    uniqueIPs: new Set(),
    statusCodes: {
      '2xx': 0,
      '3xx': 0,
      '4xx': 0,
      '5xx': 0
    },
    topIPs: {},
    topErrorIPs: {},
    requestsByHour: Array(24).fill(0),
    totalBytes: 0,
    errors4xx: 0,
    errors5xx: 0,
    hostRequests: {}
  };

  // Process each entry
  filteredEntries.forEach(entry => {
    // Track unique IPs
    stats.uniqueIPs.add(entry.ip);

    // Count status codes
    const statusCategory = Math.floor(entry.status / 100) * 100;
    if (statusCategory === 200) stats.statusCodes['2xx']++;
    else if (statusCategory === 300) stats.statusCodes['3xx']++;
    else if (statusCategory === 400) {
      stats.statusCodes['4xx']++;
      stats.errors4xx++;
    }
    else if (statusCategory === 500) {
      stats.statusCodes['5xx']++;
      stats.errors5xx++;
    }

    // Track top IPs
    stats.topIPs[entry.ip] = (stats.topIPs[entry.ip] || 0) + 1;

    // Track IPs generating errors
    if (entry.status >= 400) {
      stats.topErrorIPs[entry.ip] = (stats.topErrorIPs[entry.ip] || 0) + 1;
    }

    // Track requests by hour
    const hour = entry.timestamp.getHours();
    stats.requestsByHour[hour]++;

    // Track bytes transferred
    stats.totalBytes += entry.bytes;

    // Track host requests (best effort)
    const host = extractHost(entry, proxyHosts);
    stats.hostRequests[host] = (stats.hostRequests[host] || 0) + 1;
  });

  // Convert unique IPs set to count
  stats.uniqueVisitors = stats.uniqueIPs.size;
  delete stats.uniqueIPs;

  // Calculate error rates
  stats.errorRate4xx = stats.totalRequests > 0
    ? ((stats.errors4xx / stats.totalRequests) * 100).toFixed(2)
    : '0.00';
  stats.errorRate5xx = stats.totalRequests > 0
    ? ((stats.errors5xx / stats.totalRequests) * 100).toFixed(2)
    : '0.00';

  // Get top 10 IPs by request count
  stats.topIPs = Object.entries(stats.topIPs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ip, count]) => ({ ip, count }));

  // Get top 10 IPs generating errors
  stats.topErrorIPs = Object.entries(stats.topErrorIPs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ip, count]) => ({ ip, count }));

  // Get top hosts by request count
  stats.topHosts = Object.entries(stats.hostRequests)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([host, count]) => ({ host, count }));

  // Format bytes to human readable
  stats.totalBytesFormatted = formatBytes(stats.totalBytes);

  // Calculate time range
  const oldestEntry = filteredEntries[0];
  const newestEntry = filteredEntries[filteredEntries.length - 1];
  stats.timeRangeStart = oldestEntry.timestamp;
  stats.timeRangeEnd = newestEntry.timestamp;

  return stats;
}

/**
 * Get empty statistics object
 */
function getEmptyStats() {
  return {
    totalRequests: 0,
    uniqueVisitors: 0,
    statusCodes: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
    errors4xx: 0,
    errors5xx: 0,
    errorRate4xx: '0.00',
    errorRate5xx: '0.00',
    topIPs: [],
    topErrorIPs: [],
    topHosts: [],
    requestsByHour: Array(24).fill(0),
    totalBytes: 0,
    totalBytesFormatted: '0 B',
    timeRangeStart: null,
    timeRangeEnd: null
  };
}

/**
 * Format bytes to human readable size
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Check if cached statistics are still valid
 */
function isCacheValid() {
  if (!statsCache.data || !statsCache.timestamp) {
    return false;
  }

  const now = Date.now();
  const age = now - statsCache.timestamp;

  return age < statsCache.cacheLifetime;
}

/**
 * Clear the statistics cache (useful for testing or forcing refresh)
 */
function clearCache() {
  statsCache.data = null;
  statsCache.timestamp = null;
  console.log('📊 Statistics cache cleared');
}

/**
 * Parse nginx access logs and return statistics
 * @param {Array} proxyHosts - Array of proxy host objects
 * @param {string} timeRange - Time range filter (e.g., '24h', '7d', 'all')
 * @param {number|null} maxLines - Max lines to read (null = entire file since last rotation)
 * @param {boolean} forceRefresh - Force cache refresh (default: false)
 */
function parseAccessLogs(proxyHosts = [], timeRange = '24h', maxLines = null, forceRefresh = false) {
  // Check cache first (unless force refresh or reading specific line count)
  if (!forceRefresh && maxLines === null && isCacheValid()) {
    console.log('📊 Returning cached statistics (age: ' + Math.floor((Date.now() - statsCache.timestamp) / 1000) + 's)');
    return statsCache.data;
  }

  console.log('📊 Parsing nginx access logs...');
  const startTime = Date.now();

  const logPath = getAccessLogPath();
  const lines = readLastLines(logPath, maxLines);

  if (lines.length === 0) {
    console.warn('No log lines to parse');
    return getEmptyStats();
  }

  // Parse log lines
  const entries = lines
    .map(line => parseLogLine(line))
    .filter(entry => entry !== null);

  // Aggregate statistics
  const stats = aggregateStatistics(entries, proxyHosts, timeRange);

  const parseTime = Date.now() - startTime;
  console.log(`📊 Parsed ${entries.length} log entries in ${parseTime}ms`);

  // Cache the results (only if reading full file)
  if (maxLines === null) {
    statsCache.data = stats;
    statsCache.timestamp = Date.now();
    console.log('📊 Statistics cached for 30 minutes');
  }

  return stats;
}

module.exports = {
  parseAccessLogs,
  getAccessLogPath,
  clearCache
};
