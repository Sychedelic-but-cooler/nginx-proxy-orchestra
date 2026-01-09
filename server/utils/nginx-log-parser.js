const fs = require('fs');
const readline = require('readline');
const path = require('path');

/**
 * Check if an IP address is in private address space
 * RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * Also includes: 127.0.0.0/8 (loopback), 169.254.0.0/16 (link-local)
 */
function isPrivateIP(ip) {
  if (!ip) return false;

  // Parse IPv4
  const parts = ip.split('.');
  if (parts.length !== 4) {
    // Could be IPv6 or invalid, for now consider non-private
    // TODO: Add IPv6 private range support
    return false;
  }

  const octets = parts.map(p => parseInt(p, 10));
  if (octets.some(o => isNaN(o) || o < 0 || o > 255)) {
    return false;
  }

  // 10.0.0.0/8
  if (octets[0] === 10) {
    return true;
  }

  // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }

  // 192.168.0.0/16
  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }

  // 127.0.0.0/8 (loopback)
  if (octets[0] === 127) {
    return true;
  }

  // 169.254.0.0/16 (link-local)
  if (octets[0] === 169 && octets[1] === 254) {
    return true;
  }

  return false;
}

/**
 * Parse nginx access log line
 * Expected format: custom format with vhost prefix
 * $host $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$upstream_addr"
 */
function parseLogLine(line) {
  // Regex for custom nginx log format with vhost
  // Format: vhost ip - user [timestamp] "request" status bytes "referer" "user-agent" "upstream"
  const regex = /^(\S+) (\S+) - (\S+) \[(.*?)\] "(.*?)" (\d{3}) (\d+) "(.*?)" "(.*?)"(?: "(.*?)")?$/;
  const match = line.match(regex);

  if (!match) {
    // Try standard combined format as fallback
    const standardRegex = /^(\S+) - (\S+) \[(.*?)\] "(.*?)" (\d{3}) (\d+) "(.*?)" "(.*?)"$/;
    const standardMatch = line.match(standardRegex);

    if (!standardMatch) return null;

    const [, ip, user, timestamp, request, status, bytes, referer, userAgent] = standardMatch;

    return {
      vhost: null,
      ip,
      user,
      timestamp,
      request,
      status: parseInt(status),
      bytes: parseInt(bytes),
      referer,
      userAgent
    };
  }

  const [, vhost, ip, user, timestamp, request, status, bytes, referer, userAgent, upstream] = match;

  return {
    vhost,
    ip,
    user,
    timestamp,
    request,
    status: parseInt(status),
    bytes: parseInt(bytes),
    referer,
    userAgent,
    upstream
  };
}

/**
 * Get top N items from a frequency map
 */
function getTopN(frequencyMap, n = 10) {
  return Object.entries(frequencyMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([item, count]) => ({ item, count }));
}

/**
 * Get top N IPs from frequency map, optionally excluding private IPs
 */
function getTopNIPs(ipCounts, n = 10, excludePrivate = true) {
  let entries = Object.entries(ipCounts);

  if (excludePrivate) {
    entries = entries.filter(([ip]) => !isPrivateIP(ip));
  }

  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([item, count]) => ({ item, count }));
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
 * Get list of log files to parse (current + rotated logs if needed)
 */
function getLogFiles(basePath, hoursBack) {
  const files = [basePath];

  // For longer time ranges, also check rotated logs
  if (hoursBack > 24) {
    const logDir = path.dirname(basePath);
    const baseName = path.basename(basePath);

    try {
      // Check for common rotated log patterns
      // Pattern 1: access.log.1, access.log.2, etc.
      for (let i = 1; i <= 7; i++) {
        const rotatedPath = `${basePath}.${i}`;
        if (fs.existsSync(rotatedPath)) {
          files.push(rotatedPath);
        }
      }

      // Pattern 2: access.log-YYYYMMDD
      const readdirSync = fs.readdirSync(logDir);
      const datePattern = new RegExp(`^${baseName}-\\d{8}$`);
      readdirSync.forEach(file => {
        if (datePattern.test(file)) {
          files.push(path.join(logDir, file));
        }
      });
    } catch (error) {
      // If we can't read directory, just use current log
      console.warn('Could not scan for rotated logs:', error.message);
    }
  }

  return files;
}

/**
 * Parse nginx access logs and return statistics
 */
async function parseAccessLogs(logPath, hoursBack = 24) {
  const stats = {
    totalRequests: 0,
    ipCounts: {},
    userAgentCounts: {},
    vhostCounts: {},                    // NEW: Track requests by virtual host
    statusCounts: {},
    requestsByStatus: {
      '403': 0,  // Blocked
      '429': 0,  // Rate limited
      '200': 0,  // Success
      '404': 0,  // Not found
      '500': 0   // Server error
    },
    requestsByHour: Array(24).fill(0),  // NEW: Hourly distribution
    totalBytes: 0,                      // NEW: Total bytes transferred
    errorIPCounts: {},                  // NEW: IPs generating errors (4xx/5xx)
    statusCategories: {                 // NEW: Status code categories
      '2xx': 0,
      '3xx': 0,
      '4xx': 0,
      '5xx': 0
    }
  };

  // Calculate time threshold
  const now = Date.now();
  const threshold = now - (hoursBack * 60 * 60 * 1000);

  // Get all log files to parse (current + rotated if needed)
  const logFiles = getLogFiles(logPath, hoursBack);
  console.log(`[Log Parser] Parsing ${logFiles.length} log file(s) for ${hoursBack}h range`);

  try {
    // Parse each log file
    for (const filePath of logFiles) {
      if (!fs.existsSync(filePath)) {
        continue;
      }

      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        const parsed = parseLogLine(line);
        if (!parsed) continue;

        // Parse timestamp (nginx format: 06/Jan/2026:10:30:45 +0000)
        let logDate = new Date(); // Default to now if parsing fails
        const timestampMatch = parsed.timestamp.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
        if (timestampMatch) {
          const [, day, month, year, hour, min, sec] = timestampMatch;
          const monthMap = {
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
          };
          logDate = new Date(year, monthMap[month], day, hour, min, sec);

          // Skip logs older than threshold
          if (logDate.getTime() < threshold) {
            continue;
          }
        }

        stats.totalRequests++;

        // Count IPs
        stats.ipCounts[parsed.ip] = (stats.ipCounts[parsed.ip] || 0) + 1;

        // Count virtual hosts
        if (parsed.vhost && parsed.vhost !== '-') {
          stats.vhostCounts[parsed.vhost] = (stats.vhostCounts[parsed.vhost] || 0) + 1;
        }

        // Count user agents
        if (parsed.userAgent && parsed.userAgent !== '-') {
          stats.userAgentCounts[parsed.userAgent] = (stats.userAgentCounts[parsed.userAgent] || 0) + 1;
        }

        // Count status codes
        stats.statusCounts[parsed.status] = (stats.statusCounts[parsed.status] || 0) + 1;

        // Count specific status codes
        const statusStr = parsed.status.toString();
        if (stats.requestsByStatus[statusStr] !== undefined) {
          stats.requestsByStatus[statusStr]++;
        }

        // NEW: Track requests by hour
        const hour = logDate.getHours();
        stats.requestsByHour[hour]++;

        // NEW: Track total bytes
        stats.totalBytes += parsed.bytes;

        // NEW: Track error-generating IPs (4xx and 5xx)
        if (parsed.status >= 400) {
          stats.errorIPCounts[parsed.ip] = (stats.errorIPCounts[parsed.ip] || 0) + 1;
        }

        // NEW: Track status categories
        const statusCategory = Math.floor(parsed.status / 100);
        const categoryKey = `${statusCategory}xx`;
        if (stats.statusCategories[categoryKey] !== undefined) {
          stats.statusCategories[categoryKey]++;
        }
      }
    } // End of file loop
  } catch (error) {
    console.error('Error parsing access logs:', error);
  }

  return stats;
}

/**
 * Parse access logs incrementally (only new lines since last read)
 * @param {string} logPath - Path to access.log file
 * @param {number} hoursBack - Hours of history to include (default: 24)
 * @returns {object} Parsed statistics
 */
async function parseAccessLogsIncremental(logPath, hoursBack = 24) {
  const { logOffsetTracker } = require('./log-offset-tracker');

  const stats = {
    totalRequests: 0,
    ipCounts: {},
    userAgentCounts: {},
    vhostCounts: {},                    // NEW: Track requests by virtual host
    statusCounts: {},
    requestsByStatus: {
      '403': 0,
      '429': 0,
      '200': 0,
      '404': 0,
      '500': 0
    },
    requestsByHour: Array(24).fill(0),  // NEW: Hourly distribution
    totalBytes: 0,                      // NEW: Total bytes transferred
    errorIPCounts: {},                  // NEW: IPs generating errors (4xx/5xx)
    statusCategories: {                 // NEW: Status code categories
      '2xx': 0,
      '3xx': 0,
      '4xx': 0,
      '5xx': 0
    }
  };

  try {
    if (!fs.existsSync(logPath)) {
      console.warn(`Access log not found: ${logPath}`);
      return stats;
    }

    const fileStats = fs.statSync(logPath);
    const stored = logOffsetTracker.getOffset(logPath);

    // Check for log rotation
    if (logOffsetTracker.detectRotation(logPath)) {
      console.log('Log rotation detected, resetting offset');
      logOffsetTracker.setOffset(logPath, 0, fileStats.ino, 0);
      // Fall back to full parse for rotated logs
      return parseAccessLogs(logPath, hoursBack);
    }

    // If no new data, return empty stats
    if (fileStats.size === stored.offset) {
      return stats;
    }

    // Read only new data
    const fd = fs.openSync(logPath, 'r');
    const bufferSize = fileStats.size - stored.offset;
    const buffer = Buffer.alloc(bufferSize);

    fs.readSync(fd, buffer, 0, bufferSize, stored.offset);
    fs.closeSync(fd);

    const newLines = buffer.toString('utf8').split('\n');

    // Calculate time threshold
    const now = Date.now();
    const threshold = now - (hoursBack * 60 * 60 * 1000);

    for (const line of newLines) {
      if (!line.trim()) continue;

      const parsed = parseLogLine(line);
      if (!parsed) continue;

      // Parse timestamp
      let logDate = new Date();  // Default to now if parsing fails
      const timestampMatch = parsed.timestamp.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
      if (timestampMatch) {
        const [, day, month, year, hour, min, sec] = timestampMatch;
        const monthMap = {
          'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
          'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
        };
        logDate = new Date(year, monthMap[month], day, hour, min, sec);

        // Skip logs older than threshold
        if (logDate.getTime() < threshold) {
          continue;
        }
      }

      stats.totalRequests++;

      // Count IPs
      stats.ipCounts[parsed.ip] = (stats.ipCounts[parsed.ip] || 0) + 1;

      // Count virtual hosts
      if (parsed.vhost && parsed.vhost !== '-') {
        stats.vhostCounts[parsed.vhost] = (stats.vhostCounts[parsed.vhost] || 0) + 1;
      }

      // Count user agents
      if (parsed.userAgent && parsed.userAgent !== '-') {
        stats.userAgentCounts[parsed.userAgent] = (stats.userAgentCounts[parsed.userAgent] || 0) + 1;
      }

      // Count status codes
      stats.statusCounts[parsed.status] = (stats.statusCounts[parsed.status] || 0) + 1;

      // Count specific status codes
      const statusStr = parsed.status.toString();
      if (stats.requestsByStatus[statusStr] !== undefined) {
        stats.requestsByStatus[statusStr]++;
      }

      // NEW: Track requests by hour
      const hour = logDate.getHours();
      stats.requestsByHour[hour]++;

      // NEW: Track total bytes
      stats.totalBytes += parsed.bytes;

      // NEW: Track error-generating IPs (4xx and 5xx)
      if (parsed.status >= 400) {
        stats.errorIPCounts[parsed.ip] = (stats.errorIPCounts[parsed.ip] || 0) + 1;
      }

      // NEW: Track status categories
      const statusCategory = Math.floor(parsed.status / 100);
      const categoryKey = `${statusCategory}xx`;
      if (stats.statusCategories[categoryKey] !== undefined) {
        stats.statusCategories[categoryKey]++;
      }
    }

    // Update offset
    logOffsetTracker.setOffset(logPath, fileStats.size, fileStats.ino, fileStats.size);

  } catch (error) {
    console.error('Error parsing access logs incrementally:', error);
  }

  return stats;
}

/**
 * Parse nginx error logs for blocked requests
 */
async function parseErrorLogs(logPath, hoursBack = 24) {
  const stats = {
    totalErrors: 0,
    rateLimitBlocks: 0,
    accessDenied: 0,
    geoBlocks: 0,
    userAgentBlocks: 0
  };

  try {
    if (!fs.existsSync(logPath)) {
      console.warn(`Error log not found: ${logPath}`);
      return stats;
    }

    const fileStream = fs.createReadStream(logPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      stats.totalErrors++;

      // Detect rate limit blocks
      if (line.includes('limiting requests') || line.includes('rate limit')) {
        stats.rateLimitBlocks++;
      }

      // Detect access denied
      if (line.includes('access forbidden') || line.includes('denied')) {
        stats.accessDenied++;
      }

      // These are heuristics - actual detection depends on log format
      if (line.includes('geo') || line.includes('country')) {
        stats.geoBlocks++;
      }

      if (line.includes('user-agent') || line.includes('User-Agent')) {
        stats.userAgentBlocks++;
      }
    }
  } catch (error) {
    console.error('Error parsing error logs:', error);
  }

  return stats;
}

/**
 * Get comprehensive nginx statistics
 * Uses incremental parsing for 24h (efficient), full parsing for 7d (more data)
 */
async function getNginxStatistics(hoursBack = 24, excludePrivate = true) {
  const accessLogPath = '/var/log/nginx/access.log';
  const errorLogPath = '/var/log/nginx/error.log';

  // For longer time ranges (7d), use full parse to ensure we get all data
  // For 24h, use incremental parse for efficiency
  const parseMethod = hoursBack > 24 ? parseAccessLogs : parseAccessLogsIncremental;

  const [accessStats, errorStats] = await Promise.all([
    parseMethod(accessLogPath, hoursBack),
    parseErrorLogs(errorLogPath, hoursBack)
  ]);

  // Calculate unique IP count (respecting excludePrivate filter)
  let uniqueIPCount = Object.keys(accessStats.ipCounts).length;
  if (excludePrivate) {
    uniqueIPCount = Object.keys(accessStats.ipCounts).filter(ip => !isPrivateIP(ip)).length;
  }

  return {
    timeRange: `${hoursBack}h`,
    totalRequests: accessStats.totalRequests,
    uniqueIPCount,

    // Top 10s
    topIPs: getTopNIPs(accessStats.ipCounts, 10, excludePrivate),
    topUserAgents: getTopN(accessStats.userAgentCounts, 10),
    topErrorIPs: getTopNIPs(accessStats.errorIPCounts, 10, excludePrivate), // NEW
    topHosts: getTopN(accessStats.vhostCounts, 10), // NEW: Top virtual hosts by traffic

    // Status breakdown
    statusCounts: accessStats.statusCounts,
    requestsByStatus: accessStats.requestsByStatus,
    statusCategories: accessStats.statusCategories, // NEW

    // Traffic metrics (NEW)
    requestsByHour: accessStats.requestsByHour,
    totalBytes: accessStats.totalBytes,
    totalBytesFormatted: formatBytes(accessStats.totalBytes),

    // Error stats
    errorStats,

    // Calculated metrics
    blockedRequests: accessStats.requestsByStatus['403'],
    rateLimitedRequests: accessStats.requestsByStatus['429'],
    successfulRequests: accessStats.requestsByStatus['200'],
    blockRate: accessStats.totalRequests > 0
      ? ((accessStats.requestsByStatus['403'] / accessStats.totalRequests) * 100).toFixed(2)
      : '0.00',
    rateLimitRate: accessStats.totalRequests > 0
      ? ((accessStats.requestsByStatus['429'] / accessStats.totalRequests) * 100).toFixed(2)
      : '0.00'
  };
}

/**
 * Get top countries from access logs (requires GeoIP)
 * This is a placeholder - would need actual GeoIP integration
 */
async function getTopCountries(hoursBack = 24) {
  // TODO: Implement GeoIP lookup
  // For now, return mock data structure
  return {
    topCountries: [
      // { country: 'US', countryName: 'United States', count: 0 }
    ],
    note: 'GeoIP integration required'
  };
}

module.exports = {
  parseAccessLogs,
  parseAccessLogsIncremental,
  parseErrorLogs,
  getNginxStatistics,
  getTopCountries,
  getTopN,
  getTopNIPs,
  formatBytes,
  isPrivateIP
};
