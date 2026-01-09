const { getNginxStatistics, getTopCountries } = require('./nginx-log-parser');
const { db } = require('../db');

/**
 * Statistics Cache Service
 * Caches nginx log statistics to avoid expensive log parsing on every request
 */

// Cache storage
let statsCache = {
  nginx: {
    '24h': null,
    '7d': null,
    lastUpdate: null
  },
  security: {
    '24h': null,
    '7d': null,
    lastUpdate: null
  }
};

// Cache refresh interval (5 minutes)
const CACHE_REFRESH_INTERVAL = 5 * 60 * 1000;
let refreshInterval = null;

/**
 * Get security rule counts from database
 */
function getSecurityRuleCounts() {
  const ipBlacklistCount = db.prepare(
    "SELECT COUNT(*) as count FROM security_rules WHERE rule_type = 'ip_blacklist' AND enabled = 1"
  ).get().count;

  const geoBlockCount = db.prepare(
    "SELECT COUNT(*) as count FROM security_rules WHERE rule_type = 'geo_block' AND enabled = 1"
  ).get().count;

  const uaFilterCount = db.prepare(
    "SELECT COUNT(*) as count FROM security_rules WHERE rule_type = 'user_agent_filter' AND enabled = 1"
  ).get().count;

  const rateLimitCount = db.prepare(
    "SELECT COUNT(*) as count FROM rate_limits WHERE enabled = 1"
  ).get().count;

  return {
    ipBlacklist: ipBlacklistCount,
    geoBlock: geoBlockCount,
    userAgentFilter: uaFilterCount,
    rateLimit: rateLimitCount
  };
}

/**
 * Refresh nginx statistics cache
 */
async function refreshNginxStatsCache() {
  try {
    console.log('[Stats Cache] Refreshing nginx statistics...');

    // Parse logs for both 24h and 7d (168h)
    const [stats24h, stats7d] = await Promise.all([
      getNginxStatistics(24, false), // Get all IPs for internal use
      getNginxStatistics(168, false) // 7 days
    ]);

    // Get country data
    const [countries24h, countries7d] = await Promise.all([
      getTopCountries(24),
      getTopCountries(168)
    ]);

    // Get current security rules for cross-referencing (24h only, same for both)
    const existingIPBlocks = db.prepare(
      "SELECT rule_value FROM security_rules WHERE rule_type = 'ip_blacklist' AND enabled = 1"
    ).all().map(r => r.rule_value);

    const existingGeoBlocks = db.prepare(
      "SELECT rule_value FROM security_rules WHERE rule_type = 'geo_block' AND enabled = 1"
    ).all().map(r => r.rule_value);

    const existingUABlocks = db.prepare(
      "SELECT rule_value FROM security_rules WHERE rule_type = 'user_agent_filter' AND enabled = 1"
    ).all().map(r => r.rule_value);

    // Augment 24h stats with block status
    const topIPsWithStatus24h = stats24h.topIPs.map(ip => ({
      ...ip,
      isBlocked: existingIPBlocks.includes(ip.item)
    }));

    const topUserAgentsWithStatus24h = stats24h.topUserAgents.map(ua => ({
      ...ua,
      isBlocked: existingUABlocks.some(pattern => {
        try {
          const regex = new RegExp(pattern, 'i');
          return regex.test(ua.item);
        } catch {
          return pattern === ua.item;
        }
      })
    }));

    // Augment 7d stats with block status
    const topIPsWithStatus7d = stats7d.topIPs.map(ip => ({
      ...ip,
      isBlocked: existingIPBlocks.includes(ip.item)
    }));

    const topUserAgentsWithStatus7d = stats7d.topUserAgents.map(ua => ({
      ...ua,
      isBlocked: existingUABlocks.some(pattern => {
        try {
          const regex = new RegExp(pattern, 'i');
          return regex.test(ua.item);
        } catch {
          return pattern === ua.item;
        }
      })
    }));

    // Cache nginx stats
    statsCache.nginx['24h'] = {
      ...stats24h,
      topIPs: topIPsWithStatus24h,
      topUserAgents: topUserAgentsWithStatus24h,
      topCountries: countries24h.topCountries || []
    };

    statsCache.nginx['7d'] = {
      ...stats7d,
      topIPs: topIPsWithStatus7d,
      topUserAgents: topUserAgentsWithStatus7d,
      topCountries: countries7d.topCountries || []
    };

    statsCache.nginx.lastUpdate = Date.now();

    console.log(`[Stats Cache] Nginx statistics refreshed (24h: ${stats24h.totalRequests} requests, 7d: ${stats7d.totalRequests} requests)`);
  } catch (error) {
    console.error('[Stats Cache] Error refreshing nginx statistics:', error);
  }
}

/**
 * Refresh security statistics cache
 */
async function refreshSecurityStatsCache() {
  try {
    console.log('[Stats Cache] Refreshing security statistics...');

    const ruleCounts = getSecurityRuleCounts();

    // Get basic stats from nginx stats (if available)
    const nginx24h = statsCache.nginx['24h'];
    const nginx7d = statsCache.nginx['7d'];

    // Build security stats for 24h
    statsCache.security['24h'] = {
      timeRange: '24h',
      blocked: {
        total: nginx24h ? nginx24h.blockedRequests : 0,
        byRule: {
          ip_blacklist: 0, // Would need to parse from logs in future
          geo_block: 0,
          user_agent_filter: 0,
          rate_limit: nginx24h ? nginx24h.rateLimitedRequests : 0
        }
      },
      topBlockedIPs: [],
      topBlockedCountries: [],
      rateLimitHits: nginx24h ? nginx24h.rateLimitedRequests : 0,
      activeRules: ruleCounts
    };

    // Build security stats for 7d
    statsCache.security['7d'] = {
      timeRange: '7d',
      blocked: {
        total: nginx7d ? nginx7d.blockedRequests : 0,
        byRule: {
          ip_blacklist: 0,
          geo_block: 0,
          user_agent_filter: 0,
          rate_limit: nginx7d ? nginx7d.rateLimitedRequests : 0
        }
      },
      topBlockedIPs: [],
      topBlockedCountries: [],
      rateLimitHits: nginx7d ? nginx7d.rateLimitedRequests : 0,
      activeRules: ruleCounts
    };

    statsCache.security.lastUpdate = Date.now();

    console.log('[Stats Cache] Security statistics refreshed');
  } catch (error) {
    console.error('[Stats Cache] Error refreshing security statistics:', error);
  }
}

/**
 * Refresh all cached statistics
 */
async function refreshAllStats() {
  await refreshNginxStatsCache();
  await refreshSecurityStatsCache();
}

/**
 * Get cached nginx statistics
 * @param {string} timeRange - '24h' or '7d'
 * @param {boolean} excludePrivate - Exclude private IPs from results
 */
function getCachedNginxStats(timeRange = '24h', excludePrivate = true) {
  const stats = statsCache.nginx[timeRange];

  if (!stats) {
    return null;
  }

  // If excluding private IPs, filter them from topIPs
  if (excludePrivate) {
    const { isPrivateIP } = require('./nginx-log-parser');
    return {
      ...stats,
      topIPs: stats.topIPs.filter(ip => !isPrivateIP(ip.item)),
      uniqueIPCount: Object.keys(stats.ipCounts || {}).filter(ip => !isPrivateIP(ip)).length
    };
  }

  return stats;
}

/**
 * Get cached security statistics
 * @param {string} timeRange - '24h' or '7d'
 */
function getCachedSecurityStats(timeRange = '24h') {
  // Always refresh rule counts (fast database query)
  const ruleCounts = getSecurityRuleCounts();

  const stats = statsCache.security[timeRange];

  if (!stats) {
    return null;
  }

  // Return with updated rule counts
  return {
    ...stats,
    activeRules: ruleCounts
  };
}

/**
 * Get cache age in seconds
 */
function getCacheAge() {
  if (!statsCache.nginx.lastUpdate) {
    return Infinity;
  }
  return Math.floor((Date.now() - statsCache.nginx.lastUpdate) / 1000);
}

/**
 * Check if cache is stale (older than refresh interval)
 */
function isCacheStale() {
  return getCacheAge() > (CACHE_REFRESH_INTERVAL / 1000);
}

/**
 * Start automatic cache refresh
 */
function startCacheRefresh() {
  console.log('[Stats Cache] Starting automatic refresh (every 5 minutes)...');

  // Initial load
  refreshAllStats();

  // Schedule periodic refresh
  refreshInterval = setInterval(() => {
    refreshAllStats();
  }, CACHE_REFRESH_INTERVAL);
}

/**
 * Stop automatic cache refresh
 */
function stopCacheRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    console.log('[Stats Cache] Stopped automatic refresh');
  }
}

/**
 * Manually trigger cache refresh
 */
async function manualRefresh() {
  console.log('[Stats Cache] Manual refresh triggered');
  await refreshAllStats();
}

module.exports = {
  getCachedNginxStats,
  getCachedSecurityStats,
  getCacheAge,
  isCacheStale,
  startCacheRefresh,
  stopCacheRefresh,
  manualRefresh,
  refreshAllStats
};
