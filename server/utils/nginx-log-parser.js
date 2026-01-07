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
 * Expected format: combined log format
 * $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
 */
function parseLogLine(line) {
  // Regex for nginx combined log format
  const regex = /^(\S+) - (\S+) \[(.*?)\] "(.*?)" (\d{3}) (\d+) "(.*?)" "(.*?)"$/;
  const match = line.match(regex);

  if (!match) return null;

  const [, ip, user, timestamp, request, status, bytes, referer, userAgent] = match;

  return {
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
 * Parse nginx access logs and return statistics
 */
async function parseAccessLogs(logPath, hoursBack = 24) {
  const stats = {
    totalRequests: 0,
    ipCounts: {},
    userAgentCounts: {},
    statusCounts: {},
    requestsByStatus: {
      '403': 0,  // Blocked
      '429': 0,  // Rate limited
      '200': 0,  // Success
      '404': 0,  // Not found
      '500': 0   // Server error
    }
  };

  // Calculate time threshold
  const now = Date.now();
  const threshold = now - (hoursBack * 60 * 60 * 1000);

  try {
    if (!fs.existsSync(logPath)) {
      console.warn(`Access log not found: ${logPath}`);
      return stats;
    }

    const fileStream = fs.createReadStream(logPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      const parsed = parseLogLine(line);
      if (!parsed) continue;

      // Parse timestamp (nginx format: 06/Jan/2026:10:30:45 +0000)
      const timestampMatch = parsed.timestamp.match(/(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
      if (timestampMatch) {
        const [, day, month, year, hour, min, sec] = timestampMatch;
        const monthMap = {
          'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
          'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
        };
        const logDate = new Date(year, monthMap[month], day, hour, min, sec);

        // Skip logs older than threshold
        if (logDate.getTime() < threshold) {
          continue;
        }
      }

      stats.totalRequests++;

      // Count IPs
      stats.ipCounts[parsed.ip] = (stats.ipCounts[parsed.ip] || 0) + 1;

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
    }
  } catch (error) {
    console.error('Error parsing access logs:', error);
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
 */
async function getNginxStatistics(hoursBack = 24, excludePrivate = true) {
  const accessLogPath = '/var/log/nginx/access.log';
  const errorLogPath = '/var/log/nginx/error.log';

  const [accessStats, errorStats] = await Promise.all([
    parseAccessLogs(accessLogPath, hoursBack),
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

    // Status breakdown
    statusCounts: accessStats.statusCounts,
    requestsByStatus: accessStats.requestsByStatus,

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
  parseErrorLogs,
  getNginxStatistics,
  getTopCountries,
  getTopN,
  isPrivateIP
};
