/**
 * Main API router
 * Routes requests to appropriate module handlers
 */

const { requireAuth, requireAuthFlexible } = require('./middleware/auth.middleware');
const { sendJSON } = require('./shared/utils');

// Import route handlers
const handleSSERoutes = require('./sse.routes');
const handleDashboardRoutes = require('./dashboard.routes');
const handleStatisticsRoutes = require('./statistics.routes');
const handleNotificationRoutes = require('./notifications.routes');
const handleCredentialsRoutes = require('./credentials.routes');
const handleModulesRoutes = require('./modules.routes');
const handleConfigRoutes = require('./config.routes');
const handleAuthRoutes = require('./auth.routes');
const handleSessionRoutes = require('./sessions.routes');
const handleDNSRoutes = require('./dns.routes');
const handleNginxRoutes = require('./nginx.routes');
const handleSettingsRoutes = require('./settings.routes');
const handleCertificateRoutes = require('./certificates.routes');
const handleProxyRoutes = require('./proxies.routes');
const handleTOTPRoutes = require('./totp.routes');

// Security module
const handleSecurityRulesRoutes = require('./security/rules.routes');
const handleRateLimitRoutes = require('./security/rate-limits.routes');
const handleSecurityStatsRoutes = require('./security/stats.routes');

// WAF module
const handleWAFProfileRoutes = require('./waf/profiles.routes');
const handleWAFEventsRoutes = require('./waf/events.routes');
const handleWAFExclusionsRoutes = require('./waf/exclusions.routes');
const handleWAFAssignmentRoutes = require('./waf/assignments.routes');

// Ban module
const handleBanIntegrationRoutes = require('./ban/integrations.routes');
const handleBansRoutes = require('./ban/bans.routes');
const handleWhitelistRoutes = require('./ban/whitelist.routes');
const handleDetectionRulesRoutes = require('./ban/detection.routes');
const handleQueueRoutes = require('./ban/queue.routes');

/**
 * Main API request handler
 * Routes incoming requests to appropriate module handlers
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleAPI(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  try {
    // Login route (no auth required)
    if (pathname === '/api/login' && method === 'POST') {
      return await handleAuthRoutes(req, res, parsedUrl);
    }

    // TOTP login and recovery routes (no auth required)
    if ((pathname === '/api/login/totp' || pathname === '/api/login/recovery') && method === 'POST') {
      return await handleAuthRoutes(req, res, parsedUrl);
    }

    // SSE routes handle their own authentication (token via query param)
    if (pathname.endsWith('/stream') && method === 'GET') {
      return handleSSERoutes(req, res, parsedUrl);
    }

    // Apply authentication middleware for all other routes
    const authResult = requireAuthFlexible(req, res, parsedUrl);
    if (!authResult.authenticated) {
      // requireAuthFlexible has already sent the response
      return;
    }

    // Attach user to request for route handlers
    req.user = authResult.user;

    // Logout and password change routes (require auth)
    if (pathname === '/api/logout' || pathname === '/api/user/password' || pathname === '/api/user/sse-token') {
      return await handleAuthRoutes(req, res, parsedUrl);
    }

    // TOTP 2FA management routes (require auth)
    if (pathname.startsWith('/api/user/totp')) {
      return await handleTOTPRoutes(req, res, parsedUrl);
    }

    // Session management routes
    if (pathname.startsWith('/api/sessions')) {
      return await handleSessionRoutes(req, res, parsedUrl);
    }

    // Dashboard routes
    if (pathname.startsWith('/api/dashboard')) {
      return await handleDashboardRoutes(req, res, parsedUrl);
    }

    // Statistics routes
    if (pathname.startsWith('/api/statistics')) {
      return await handleStatisticsRoutes(req, res, parsedUrl);
    }

    // Notification routes (includes /api/settings/notifications and /api/notifications)
    if (pathname.startsWith('/api/notifications') || pathname.startsWith('/api/settings/notifications')) {
      return await handleNotificationRoutes(req, res, parsedUrl);
    }

    // Credentials routes
    if (pathname.startsWith('/api/credentials')) {
      return await handleCredentialsRoutes(req, res, parsedUrl);
    }

    // Modules routes
    if (pathname.startsWith('/api/modules')) {
      return await handleModulesRoutes(req, res, parsedUrl);
    }

    // Config routes
    if (pathname.startsWith('/api/config')) {
      return await handleConfigRoutes(req, res, parsedUrl);
    }

    // DNS routes
    if (pathname.startsWith('/api/dns')) {
      return await handleDNSRoutes(req, res, parsedUrl);
    }

    // Nginx routes
    if (pathname.startsWith('/api/nginx')) {
      return await handleNginxRoutes(req, res, parsedUrl);
    }

    // Settings routes
    if (pathname.startsWith('/api/settings') || pathname.startsWith('/api/audit-log')) {
      return await handleSettingsRoutes(req, res, parsedUrl);
    }

    // Certificate routes
    if (pathname.startsWith('/api/certificates') || pathname.startsWith('/api/certbot')) {
      return await handleCertificateRoutes(req, res, parsedUrl);
    }

    // Proxy routes
    if (pathname.startsWith('/api/proxies')) {
      // Check for WAF assignment routes (special case within /api/proxies)
      if (pathname.match(/^\/api\/proxies\/\d+\/waf/)) {
        return await handleWAFAssignmentRoutes(req, res, parsedUrl);
      }
      return await handleProxyRoutes(req, res, parsedUrl);
    }

    // Security rules routes
    if (pathname.startsWith('/api/security/rules')) {
      return await handleSecurityRulesRoutes(req, res, parsedUrl);
    }

    // Rate limits routes
    if (pathname.startsWith('/api/security/rate-limits')) {
      return await handleRateLimitRoutes(req, res, parsedUrl);
    }

    // Security stats and settings routes
    if (pathname.startsWith('/api/security')) {
      return await handleSecurityStatsRoutes(req, res, parsedUrl);
    }

    // WAF profile routes
    if (pathname.startsWith('/api/waf/profiles')) {
      return await handleWAFProfileRoutes(req, res, parsedUrl);
    }

    // WAF events routes
    if (pathname.startsWith('/api/waf/events') || pathname.startsWith('/api/waf/stats')) {
      return await handleWAFEventsRoutes(req, res, parsedUrl);
    }

    // WAF exclusions routes
    if (pathname.startsWith('/api/waf/exclusions')) {
      return await handleWAFExclusionsRoutes(req, res, parsedUrl);
    }

    // Ban integrations routes
    if (pathname.startsWith('/api/ban/integrations')) {
      return await handleBanIntegrationRoutes(req, res, parsedUrl);
    }

    // Ban routes (bans and sync)
    if (pathname.startsWith('/api/ban/bans')) {
      return await handleBansRoutes(req, res, parsedUrl);
    }

    // Whitelist routes
    if (pathname.startsWith('/api/ban/whitelist')) {
      return await handleWhitelistRoutes(req, res, parsedUrl);
    }

    // Detection rules routes
    if (pathname.startsWith('/api/ban/detection-rules')) {
      return await handleDetectionRulesRoutes(req, res, parsedUrl);
    }

    // Queue routes
    if (pathname.startsWith('/api/ban/queue')) {
      return await handleQueueRoutes(req, res, parsedUrl);
    }

    // No matching route
    sendJSON(res, { error: 'Not Found' }, 404);
  } catch (error) {
    console.error('API error:', error);
    sendJSON(res, { error: 'Internal Server Error' }, 500);
  }
}

module.exports = {
  handleAPI
};
