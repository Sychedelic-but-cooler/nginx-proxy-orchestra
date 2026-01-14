const { db, logAudit, getSetting, setSetting, getAllSettings } = require('../db');
const { 
  generateToken,
  verifyToken,
  extractToken,
  checkRateLimit,
  verifyPassword,
  hashPassword
} = require('../auth');
const {
  generateServerBlock,
  generateStreamBlock,
  generate404Block,
  writeNginxConfig,
  readNginxConfig,
  deleteNginxConfig,
  forceDeleteNginxConfig,
  enableNginxConfig,
  disableNginxConfig,
  sanitizeFilename
} = require('../utils/nginx-parser');
const {
  getNginxStatus,
  safeReload,
  testNginxConfig,
  refreshModuleCache
} = require('../utils/nginx-ops');
const {
  reloadManager
} = require('../utils/nginx-reload-manager');
const { validateNginxConfig } = require('../utils/input-validator');
const {
  getWAFDb
} = require('../waf-db');
const {
  parseCertificate,
  validateCertificateKeyPair,
  saveCertificateFiles,
  deleteCertificateFiles
} = require('../utils/ssl-parser');
const {
  getCachedNginxStats,
  getCachedTrafficStats,
  manualRefresh: refreshStatsCache
} = require('../utils/stats-cache-service');
const {
  getNginxStatistics,
  getTopCountries
} = require('../utils/nginx-log-parser');
const {
  getProviders,
  getProvider,
  validateCredentials,
  isProviderInstalled
} = require('../utils/dns-providers');
const {
  encryptCredentials,
  decryptCredentials,
  isEncryptionConfigured
} = require('../utils/credential-encryption');
const {
  checkCertbotInstallation,
  orderCertificateHTTP,
  orderCertificateDNS,
  getInstallationInstructions
} = require('../utils/certbot');

/**
 * Parse JSON request body
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    const maxSize = 1024 * 1024; // 1MB limit

    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        // Handle empty body
        if (!body || body.trim() === '') {
          resolve({});
          return;
        }
        
        // Try to parse JSON
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (error) {
        console.error('JSON Parse Error:', error.message);
        console.error('Body received:', body.substring(0, 200));
        reject(new Error('Invalid JSON: ' + error.message));
      }
    });

    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });
  });
}

/**
 * Send JSON response
 */
function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Get client IP address
 */
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.socket.remoteAddress;
}

/**
 * Handle API routes
 */
async function handleAPI(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  try {
    // Public routes (no auth required)
    if (pathname === '/api/login' && method === 'POST') {
      return await handleLogin(req, res);
    }

    if (pathname === '/api/logout' && method === 'POST') {
      return handleLogout(req, res);
    }

    // SSE routes handle their own authentication (token via query param)
    if (pathname === '/api/waf/events/stream' && method === 'GET') {
      return handleWAFEventsStream(req, res, parsedUrl);
    }

    // All other routes require authentication
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);
    const user = verifyToken(token);

    if (!user) {
      return sendJSON(res, { error: 'Unauthorized' }, 401);
    }

    req.user = user;

    // Dashboard routes
    if (pathname === '/api/dashboard/stats') {
      return handleDashboardStats(req, res);
    }

    // Proxy routes
    if (pathname === '/api/proxies' && method === 'GET') {
      return handleGetProxies(req, res);
    }

    if (pathname === '/api/proxies' && method === 'POST') {
      return await handleCreateProxy(req, res);
    }

    if (pathname.match(/^\/api\/proxies\/\d+$/) && method === 'GET') {
      return handleGetProxy(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/proxies\/\d+$/) && method === 'PUT') {
      return await handleUpdateProxy(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/proxies\/\d+$/) && method === 'DELETE') {
      return handleDeleteProxy(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/proxies\/\d+\/toggle$/) && method === 'POST') {
      return handleToggleProxy(req, res, parsedUrl);
    }

    // Module routes
    if (pathname === '/api/modules' && method === 'GET') {
      return handleGetModules(req, res);
    }

    if (pathname === '/api/modules' && method === 'POST') {
      return await handleCreateModule(req, res);
    }

    if (pathname.match(/^\/api\/modules\/\d+$/) && method === 'PUT') {
      return await handleUpdateModule(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/modules\/\d+$/) && method === 'DELETE') {
      return handleDeleteModule(req, res, parsedUrl);
    }

    if (pathname === '/api/modules/snippets' && method === 'GET') {
      return handleGetModuleSnippets(req, res);
    }

    // SSL certificate routes
    if (pathname === '/api/certificates' && method === 'GET') {
      return handleGetCertificates(req, res);
    }

    if (pathname === '/api/certificates' && method === 'POST') {
      return await handleCreateCertificate(req, res);
    }

    if (pathname.match(/^\/api\/certificates\/\d+$/) && method === 'DELETE') {
      return handleDeleteCertificate(req, res, parsedUrl);
    }

    // Nginx operations
    if (pathname === '/api/nginx/test' && method === 'POST') {
      return handleNginxTest(req, res);
    }

    if (pathname === '/api/nginx/reload' && method === 'POST') {
      return handleNginxReload(req, res);
    }

    if (pathname.match(/^\/api\/nginx\/reload-status\/\d+$/) && method === 'GET') {
      return handleNginxReloadStatus(req, res, parsedUrl);
    }

    if (pathname === '/api/nginx/status') {
      return handleNginxStatus(req, res);
    }

    // User/settings routes
    if (pathname === '/api/user/password' && method === 'POST') {
      return await handleChangePassword(req, res);
    }

    if (pathname === '/api/audit-log') {
      return handleGetAuditLog(req, res);
    }

    // Settings routes
    if (pathname === '/api/settings' && method === 'GET') {
      return handleGetSettings(req, res);
    }

    if (pathname === '/api/settings' && method === 'PUT') {
      return await handleUpdateSettings(req, res);
    }

    // Module migration routes
    if (pathname === '/api/modules/migrate-compression' && method === 'POST') {
      return handleMigrateCompressionModules(req, res);
    }

    // Custom config routes
    if (pathname === '/api/config/test' && method === 'POST') {
      return await handleTestCustomConfig(req, res);
    }

    if (pathname === '/api/config/save' && method === 'POST') {
      return await handleSaveCustomConfig(req, res);
    }

    if (pathname === '/api/config/template' && method === 'POST') {
      return await handleGetConfigTemplate(req, res);
    }

    if (pathname.startsWith('/api/config/raw/') && method === 'GET') {
      return handleGetRawConfig(req, res, parsedUrl);
    }

    // Statistics routes
    if (pathname === '/api/statistics' && method === 'GET') {
      return handleGetStatistics(req, res, parsedUrl);
    }

    // Security routes
    if (pathname === '/api/security/rules' && method === 'GET') {
      return handleGetSecurityRules(req, res, parsedUrl);
    }

    if (pathname === '/api/security/rules' && method === 'POST') {
      return await handleCreateSecurityRule(req, res);
    }

    if (pathname.match(/^\/api\/security\/rules\/\d+$/) && method === 'PUT') {
      return await handleUpdateSecurityRule(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/security\/rules\/\d+$/) && method === 'DELETE') {
      return handleDeleteSecurityRule(req, res, parsedUrl);
    }

    if (pathname === '/api/security/rules/bulk' && method === 'POST') {
      return await handleBulkImportSecurityRules(req, res);
    }

    if (pathname === '/api/security/rate-limits' && method === 'GET') {
      return handleGetRateLimits(req, res, parsedUrl);
    }

    if (pathname === '/api/security/rate-limits' && method === 'POST') {
      return await handleCreateRateLimit(req, res);
    }

    if (pathname.match(/^\/api\/security\/rate-limits\/\d+$/) && method === 'PUT') {
      return await handleUpdateRateLimit(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/security\/rate-limits\/\d+$/) && method === 'DELETE') {
      return handleDeleteRateLimit(req, res, parsedUrl);
    }

    if (pathname === '/api/security/settings' && method === 'GET') {
      return handleGetSecuritySettings(req, res);
    }

    if (pathname === '/api/security/settings' && method === 'PUT') {
      return await handleUpdateSecuritySettings(req, res);
    }

    if (pathname === '/api/security/stats' && method === 'GET') {
      return handleGetSecurityStats(req, res, parsedUrl);
    }

    if (pathname === '/api/security/recent-blocks' && method === 'GET') {
      return handleGetRecentBlocks(req, res, parsedUrl);
    }

    // WAF routes
    // WAF Profiles
    if (pathname === '/api/waf/profiles' && method === 'GET') {
      return handleGetWAFProfiles(req, res);
    }

    if (pathname === '/api/waf/profiles' && method === 'POST') {
      return await handleCreateWAFProfile(req, res);
    }

    if (pathname.match(/^\/api\/waf\/profiles\/\d+$/) && method === 'PUT') {
      return await handleUpdateWAFProfile(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/waf\/profiles\/\d+$/) && method === 'DELETE') {
      return handleDeleteWAFProfile(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/waf\/profiles\/\d+\/config$/) && method === 'GET') {
      return handleGetWAFProfileConfig(req, res, parsedUrl);
    }

    // WAF Events
    if (pathname === '/api/waf/events' && method === 'GET') {
      return handleGetWAFEvents(req, res, parsedUrl);
    }

    if (pathname === '/api/waf/stats' && method === 'GET') {
      return handleGetWAFStats(req, res, parsedUrl);
    }

    // WAF Exclusions
    if (pathname === '/api/waf/exclusions' && method === 'GET') {
      return handleGetWAFExclusions(req, res, parsedUrl);
    }

    if (pathname === '/api/waf/exclusions' && method === 'POST') {
      return await handleCreateWAFExclusion(req, res);
    }

    if (pathname.match(/^\/api\/waf\/exclusions\/\d+$/) && method === 'DELETE') {
      return handleDeleteWAFExclusion(req, res, parsedUrl);
    }

    // Proxy WAF Assignment
    if (pathname.match(/^\/api\/proxies\/\d+\/waf$/) && method === 'GET') {
      return handleGetProxyWAFProfiles(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/proxies\/\d+\/waf$/) && method === 'POST') {
      return await handleAssignWAFProfile(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/proxies\/\d+\/waf$/) && method === 'DELETE') {
      return handleRemoveWAFProfile(req, res, parsedUrl);
    }

    // Credentials Management Routes
    if (pathname === '/api/credentials' && method === 'GET') {
      return handleGetCredentials(req, res, parsedUrl);
    }

    if (pathname === '/api/credentials' && method === 'POST') {
      return await handleCreateCredential(req, res);
    }

    if (pathname.match(/^\/api\/credentials\/\d+$/) && method === 'PUT') {
      return await handleUpdateCredential(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/credentials\/\d+$/) && method === 'DELETE') {
      return handleDeleteCredential(req, res, parsedUrl);
    }

    // Ban System Routes
    // Ban Integrations
    if (pathname === '/api/ban/integrations' && method === 'GET') {
      return handleGetBanIntegrations(req, res);
    }

    if (pathname === '/api/ban/integrations' && method === 'POST') {
      return await handleCreateBanIntegration(req, res);
    }

    if (pathname.match(/^\/api\/ban\/integrations\/\d+$/) && method === 'PUT') {
      return await handleUpdateBanIntegration(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/ban\/integrations\/\d+$/) && method === 'DELETE') {
      return handleDeleteBanIntegration(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/ban\/integrations\/\d+\/test$/) && method === 'POST') {
      return await handleTestBanIntegration(req, res, parsedUrl);
    }

    // IP Bans
    if (pathname === '/api/ban/bans' && method === 'GET') {
      return handleGetBans(req, res, parsedUrl);
    }

    if (pathname === '/api/ban/bans' && method === 'POST') {
      return await handleCreateBan(req, res);
    }

    if (pathname.match(/^\/api\/ban\/bans\/\d+$/) && method === 'DELETE') {
      return await handleUnban(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/ban\/bans\/\d+\/permanent$/) && method === 'PUT') {
      return await handleMakeBanPermanent(req, res, parsedUrl);
    }

    if (pathname === '/api/ban/bans/stats' && method === 'GET') {
      return handleGetBanStats(req, res);
    }

    if (pathname === '/api/ban/bans/sync' && method === 'POST') {
      return await handleSyncAllBans(req, res);
    }

    if (pathname.match(/^\/api\/ban\/bans\/sync\/[\d\.:]+$/) && method === 'POST') {
      return await handleSyncSingleIP(req, res, parsedUrl);
    }

    if (pathname === '/api/ban/sync/status' && method === 'GET') {
      return handleGetSyncStatus(req, res);
    }

    // IP Whitelist
    if (pathname === '/api/ban/whitelist' && method === 'GET') {
      return handleGetWhitelist(req, res);
    }

    if (pathname === '/api/ban/whitelist' && method === 'POST') {
      return await handleAddToWhitelist(req, res);
    }

    if (pathname.match(/^\/api\/ban\/whitelist\/\d+$/) && method === 'DELETE') {
      return handleRemoveFromWhitelist(req, res, parsedUrl);
    }

    // Detection Rules
    if (pathname === '/api/ban/detection-rules' && method === 'GET') {
      return handleGetDetectionRules(req, res);
    }

    if (pathname === '/api/ban/detection-rules' && method === 'POST') {
      return await handleCreateDetectionRule(req, res);
    }

    if (pathname.match(/^\/api\/ban\/detection-rules\/\d+$/) && method === 'PUT') {
      return await handleUpdateDetectionRule(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/ban\/detection-rules\/\d+$/) && method === 'DELETE') {
      return handleDeleteDetectionRule(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/ban\/detection-rules\/\d+\/toggle$/) && method === 'POST') {
      return handleToggleDetectionRule(req, res, parsedUrl);
    }

    // Queue Status
    if (pathname === '/api/ban/queue/status' && method === 'GET') {
      return handleGetQueueStatus(req, res);
    }

    // Notification Settings
    if (pathname === '/api/settings/notifications' && method === 'GET') {
      return handleGetNotificationSettings(req, res);
    }

    if (pathname === '/api/settings/notifications' && method === 'PUT') {
      return await handleUpdateNotificationSettings(req, res);
    }

    if (pathname === '/api/notifications/test' && method === 'POST') {
      return await handleTestNotification(req, res);
    }

    // Nginx tuning and statistics routes
    if (pathname === '/api/nginx/tuning-stats' && method === 'GET') {
      return await handleGetNginxTuningStats(req, res, parsedUrl);
    }

    if (pathname === '/api/nginx/statistics' && method === 'GET') {
      return await handleGetNginxStatistics(req, res, parsedUrl);
    }

    // DNS Providers routes
    if (pathname === '/api/dns-providers' && method === 'GET') {
      return handleGetDNSProviders(req, res);
    }

    // DNS Credentials routes
    if (pathname === '/api/dns-credentials' && method === 'GET') {
      return handleGetDNSCredentials(req, res);
    }

    if (pathname === '/api/dns-credentials' && method === 'POST') {
      return await handleCreateDNSCredential(req, res);
    }

    if (pathname.match(/^\/api\/dns-credentials\/\d+$/) && method === 'PUT') {
      return await handleUpdateDNSCredential(req, res, parsedUrl);
    }

    if (pathname.match(/^\/api\/dns-credentials\/\d+$/) && method === 'DELETE') {
      return handleDeleteDNSCredential(req, res, parsedUrl);
    }

    // Certificate ordering routes
    if (pathname === '/api/certificates/order' && method === 'POST') {
      return await handleOrderCertificate(req, res);
    }

    if (pathname === '/api/certbot/status' && method === 'GET') {
      return await handleGetCertbotStatus(req, res);
    }

    // Route not found
    sendJSON(res, { error: 'Not found' }, 404);

  } catch (error) {
    console.error('API Error:', error);
    sendJSON(res, { error: error.message || 'Internal server error' }, 500);
  }
}

// ============================================================================
// Authentication Handlers
// ============================================================================

async function handleLogin(req, res) {
  const ip = getClientIP(req);
  const rateLimit = checkRateLimit(ip);
  
  if (!rateLimit.allowed) {
    return sendJSON(res, { 
      error: `Too many login attempts. Try again in ${rateLimit.retryAfter} seconds.` 
    }, 429);
  }

  const body = await parseBody(req);
  const { username, password } = body;

  if (!username || !password) {
    return sendJSON(res, { error: 'Username and password required' }, 400);
  }

  // Get user from database
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  
  if (!user || !(await verifyPassword(password, user.password))) {
    return sendJSON(res, { error: 'Invalid credentials' }, 401);
  }

  // Generate JWT token
  const token = generateToken(user.id, user.username);

  logAudit(user.id, 'login', 'user', user.id, null, ip);

  // Auto-whitelist admin IPs for safety
  try {
    const { autoWhitelistAdmin } = require('../utils/ip-utils');
    autoWhitelistAdmin(ip, user.id);
  } catch (error) {
    console.error('Failed to auto-whitelist admin IP:', error.message);
    // Don't block login if whitelist fails
  }

  sendJSON(res, {
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  });
}

function handleLogout(req, res) {
  // With JWT, logout is handled client-side by removing the token
  // But we still log it for audit purposes
  if (req.user) {
    logAudit(req.user.userId, 'logout', 'user', req.user.userId, null, getClientIP(req));
  }
  
  sendJSON(res, { success: true });
}

async function handleChangePassword(req, res) {
  const body = await parseBody(req);
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return sendJSON(res, { error: 'Current and new password required' }, 400);
  }

  if (newPassword.length < 8) {
    return sendJSON(res, { error: 'New password must be at least 8 characters' }, 400);
  }

  try {
    // Get current user from database
    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.userId);
    
    if (!user) {
      return sendJSON(res, { error: 'User not found' }, 404);
    }
    
    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.password);
    if (!isValid) {
      return sendJSON(res, { error: 'Current password is incorrect' }, 400);
    }
    
    // Hash new password and update
    const newHash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, req.user.userId);
    
    logAudit(req.user.userId, 'change_password', 'user', req.user.userId, null, getClientIP(req));
    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Change password error:', error);
    sendJSON(res, { error: error.message || 'Failed to change password' }, 500);
  }
}

// ============================================================================
// Dashboard Handlers
// ============================================================================

function handleDashboardStats(req, res) {
  const proxyCount = db.prepare('SELECT COUNT(*) as count FROM proxy_hosts WHERE enabled = 1').get();
  const totalProxies = db.prepare('SELECT COUNT(*) as count FROM proxy_hosts').get();
  const certificateCount = db.prepare('SELECT COUNT(*) as count FROM ssl_certificates').get();
  
  // Get certificates expiring in next 30 days
  const expiringCerts = db.prepare(`
    SELECT name, domain_names, expires_at 
    FROM ssl_certificates 
    WHERE expires_at IS NOT NULL 
      AND date(expires_at) <= date('now', '+30 days')
      AND date(expires_at) >= date('now')
    ORDER BY expires_at ASC
    LIMIT 10
  `).all();

  // Add urgency level to each certificate
  const now = Date.now();
  const certsWithUrgency = expiringCerts.map(cert => {
    const expiresAt = new Date(cert.expires_at).getTime();
    const daysUntilExpiry = Math.floor((expiresAt - now) / (1000 * 60 * 60 * 24));
    
    let urgency = 'normal';
    if (daysUntilExpiry <= 7) {
      urgency = 'critical';
    } else if (daysUntilExpiry <= 14) {
      urgency = 'warning';
    }
    
    return {
      ...cert,
      daysUntilExpiry,
      urgency
    };
  });

  // Recent audit log
  const recentActivity = db.prepare(`
    SELECT 
      al.action, 
      al.resource_type, 
      al.created_at, 
      u.username
    FROM audit_log al
    LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.created_at DESC
    LIMIT 10
  `).all();

  const nginxStatus = getNginxStatus();

  sendJSON(res, {
    proxies: {
      active: proxyCount.count,
      total: totalProxies.count
    },
    certificates: {
      total: certificateCount.count,
      expiring: certsWithUrgency
    },
    nginx: nginxStatus,
    recentActivity
  });
}

// ============================================================================
// Proxy Handlers
// ============================================================================

function handleGetProxies(req, res) {
  const proxies = db.prepare(`
    SELECT
      ph.*,
      sc.name as ssl_cert_name,
      wp.id as waf_profile_id,
      wp.name as waf_profile_name,
      wp.paranoia_level as waf_profile_paranoia
    FROM proxy_hosts ph
    LEFT JOIN ssl_certificates sc ON ph.ssl_cert_id = sc.id
    LEFT JOIN waf_profiles wp ON ph.waf_profile_id = wp.id
    ORDER BY ph.name COLLATE NOCASE ASC
  `).all();

  sendJSON(res, proxies);
}

function handleGetProxy(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/').pop());
  const proxy = db.prepare(`
    SELECT
      ph.*,
      sc.name as ssl_cert_name,
      wp.id as waf_profile_id,
      wp.name as waf_profile_name,
      wp.paranoia_level as waf_profile_paranoia,
      wp.enabled as waf_profile_enabled
    FROM proxy_hosts ph
    LEFT JOIN ssl_certificates sc ON ph.ssl_cert_id = sc.id
    LEFT JOIN waf_profiles wp ON ph.waf_profile_id = wp.id
    WHERE ph.id = ?
  `).get(id);

  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  // Get associated modules
  const modules = db.prepare(`
    SELECT m.id, m.name, m.description
    FROM modules m
    JOIN proxy_modules pm ON m.id = pm.module_id
    WHERE pm.proxy_id = ?
  `).all(id);

  proxy.modules = modules;

  sendJSON(res, proxy);
}

async function handleCreateProxy(req, res) {
  const body = await parseBody(req);
  const { name, type, domain_names, forward_scheme, forward_host, forward_port, ssl_enabled, ssl_cert_id, advanced_config, module_ids, stream_protocol, incoming_port, enabled } = body;

  // Validation based on type
  if (!name) {
    return sendJSON(res, { error: 'Name is required' }, 400);
  }

  // SECURITY: Validate advanced_config if provided
  if (advanced_config) {
    try {
      validateNginxConfig(advanced_config);
    } catch (error) {
      return sendJSON(res, { error: `Invalid advanced config: ${error.message}` }, 400);
    }
  }

  if (type === 'stream') {
    if (!forward_host || !forward_port || !incoming_port) {
      return sendJSON(res, { error: 'Stream hosts require forward_host, forward_port, and incoming_port' }, 400);
    }
  } else if (type === '404') {
    if (!domain_names) {
      return sendJSON(res, { error: '404 hosts require domain_names' }, 400);
    }
  } else {
    // Reverse proxy
    if (!domain_names || !forward_host || !forward_port) {
      return sendJSON(res, { error: 'Reverse proxy requires domain_names, forward_host, and forward_port' }, 400);
    }
  }

  let proxyId = null;
  let configFilename = null;

  try {
    // Generate safe filename from name
    const safeFilename = sanitizeFilename(name);
    configFilename = `${safeFilename}.conf`;

    // Insert proxy with initial status (default to enabled if not specified)
    const isEnabled = enabled !== undefined ? (enabled ? 1 : 0) : 1;

    // Wrap database operations in a transaction for atomicity
    const createProxyTransaction = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO proxy_hosts (name, type, domain_names, forward_scheme, forward_host, forward_port,
                                  ssl_enabled, ssl_cert_id, advanced_config, config_filename, config_status,
                                  stream_protocol, incoming_port, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(name, type || 'reverse', domain_names, forward_scheme || 'http', forward_host, forward_port,
             ssl_enabled ? 1 : 0, ssl_cert_id || null, advanced_config || null, configFilename,
             stream_protocol || null, incoming_port || null, isEnabled);

      proxyId = result.lastInsertRowid;

      // Associate modules
      if (module_ids && Array.isArray(module_ids)) {
        const insertModule = db.prepare('INSERT INTO proxy_modules (proxy_id, module_id) VALUES (?, ?)');
        for (const moduleId of module_ids) {
          insertModule.run(proxyId, moduleId);
        }
      }

      // Auto-enable Force HTTPS module for SSL-enabled proxies
      if (ssl_enabled) {
        const forceHTTPSModule = db.prepare('SELECT id FROM modules WHERE name = ?').get('Force HTTPS');
        if (forceHTTPSModule) {
          db.prepare(`
            INSERT OR IGNORE INTO proxy_modules (proxy_id, module_id)
            VALUES (?, ?)
          `).run(proxyId, forceHTTPSModule.id);
        }
      }

      return proxyId;
    });

    // Execute transaction
    proxyId = createProxyTransaction();

    // Get proxy with modules for config generation
    const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(proxyId);
    const modules = module_ids && module_ids.length > 0
      ? db.prepare(`SELECT * FROM modules WHERE id IN (${module_ids.map(() => '?').join(',')})`).all(...module_ids)
      : [];

    // Generate nginx config
    let config;
    if (type === 'stream') {
      config = generateStreamBlock(proxy);
    } else if (type === '404') {
      config = generate404Block(proxy);
    } else {
      config = generateServerBlock(proxy, modules, db);

      // Replace SSL cert placeholders if needed
      if (ssl_enabled && ssl_cert_id) {
        const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?').get(ssl_cert_id);
        if (cert) {
          config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
          config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
        }
      }
    }

    // Write nginx config and enable/disable based on enabled flag
    writeNginxConfig(configFilename, config);
    if (isEnabled) {
      enableNginxConfig(configFilename);
    } else {
      disableNginxConfig(configFilename);
    }

    // Test nginx configuration
    const testResult = testNginxConfig();
    if (!testResult.success) {
      throw new Error(`Nginx config test failed: ${testResult.error}`);
    }

    // Queue nginx reload to apply changes
    const { reloadId } = await reloadManager.queueReload();

    // Update status to active (keep the enabled state we already set)
    db.prepare(`
      UPDATE proxy_hosts
      SET config_status = 'active', config_error = NULL
      WHERE id = ?
    `).run(proxyId);

    logAudit(req.user.userId, 'create', 'proxy', proxyId, JSON.stringify({ name, type }), getClientIP(req));

    // Get updated proxy for response
    const updatedProxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(proxyId);

    sendJSON(res, { success: true, id: proxyId, proxy: updatedProxy, reloadId }, 201);
  } catch (error) {
    console.error('Create proxy error:', error);

    // Rollback: mark as error and disabled if proxy was created
    if (proxyId) {
      try {
        db.prepare(`
          UPDATE proxy_hosts
          SET config_status = 'error', config_error = ?, enabled = 0
          WHERE id = ?
        `).run(error.message || 'Configuration failed', proxyId);

        // Try to clean up config file
        if (configFilename) {
          try {
            deleteNginxConfig(configFilename);
          } catch (cleanupError) {
            console.error('Config cleanup error:', cleanupError);
          }
        }
      } catch (rollbackError) {
        console.error('Rollback error:', rollbackError);
      }
    }

    sendJSON(res, { error: error.message || 'Failed to create proxy' }, 500);
  }
}

async function handleUpdateProxy(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);
  const body = await parseBody(req);

  const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(id);
  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  const { name, domain_names, forward_scheme, forward_host, forward_port, ssl_enabled, ssl_cert_id, advanced_config, module_ids, stream_protocol, incoming_port } = body;

  // SECURITY: Validate advanced_config if provided
  if (advanced_config !== undefined && advanced_config !== null) {
    try {
      validateNginxConfig(advanced_config);
    } catch (error) {
      return sendJSON(res, { error: `Invalid advanced config: ${error.message}` }, 400);
    }
  }

  try {
    // Wrap database operations in a transaction for atomicity
    const updateProxyTransaction = db.transaction(() => {
      db.prepare(`
        UPDATE proxy_hosts
        SET name = ?, domain_names = ?, forward_scheme = ?, forward_host = ?, forward_port = ?,
            ssl_enabled = ?, ssl_cert_id = ?, advanced_config = ?, stream_protocol = ?, incoming_port = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name || proxy.name, domain_names || proxy.domain_names, forward_scheme || proxy.forward_scheme,
             forward_host || proxy.forward_host, forward_port || proxy.forward_port,
             ssl_enabled !== undefined ? (ssl_enabled ? 1 : 0) : proxy.ssl_enabled,
             ssl_cert_id !== undefined ? ssl_cert_id : proxy.ssl_cert_id,
             advanced_config !== undefined ? advanced_config : proxy.advanced_config,
             stream_protocol !== undefined ? stream_protocol : proxy.stream_protocol,
             incoming_port !== undefined ? incoming_port : proxy.incoming_port,
             id);

      // Update modules
      if (module_ids !== undefined) {
        db.prepare('DELETE FROM proxy_modules WHERE proxy_id = ?').run(id);
        if (Array.isArray(module_ids) && module_ids.length > 0) {
          const insertModule = db.prepare('INSERT INTO proxy_modules (proxy_id, module_id) VALUES (?, ?)');
          for (const moduleId of module_ids) {
            insertModule.run(id, moduleId);
          }
        }
      }

      // Auto-enable Force HTTPS module if SSL is being enabled
      const finalSSLState = ssl_enabled !== undefined ? ssl_enabled : proxy.ssl_enabled;
      if (finalSSLState) {
        const forceHTTPSModule = db.prepare('SELECT id FROM modules WHERE name = ?').get('Force HTTPS');
        if (forceHTTPSModule) {
          db.prepare(`
            INSERT OR IGNORE INTO proxy_modules (proxy_id, module_id)
            VALUES (?, ?)
          `).run(id, forceHTTPSModule.id);
        }
      }
    });

    // Execute transaction
    updateProxyTransaction();

    // Regenerate config
    const updatedProxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(id);
    const modules = db.prepare(`
      SELECT m.* FROM modules m
      JOIN proxy_modules pm ON m.id = pm.module_id
      WHERE pm.proxy_id = ?
    `).all(id);

    let config;
    if (updatedProxy.type === 'stream') {
      config = generateStreamBlock(updatedProxy);
    } else if (updatedProxy.type === '404') {
      config = generate404Block(updatedProxy);
    } else {
      config = generateServerBlock(updatedProxy, modules, db);

      if (updatedProxy.ssl_enabled && updatedProxy.ssl_cert_id) {
        const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?').get(updatedProxy.ssl_cert_id);
        if (cert) {
          config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
          config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
        }
      }
    }

    // Use stored config filename (or generate if missing for legacy records)
    const filename = updatedProxy.config_filename || `${sanitizeFilename(updatedProxy.name)}.conf`;
    writeNginxConfig(filename, config);

    // Ensure the config file has correct extension based on enabled state
    if (updatedProxy.enabled) {
      enableNginxConfig(filename);
    } else {
      disableNginxConfig(filename);
    }

    // Test nginx configuration
    const testResult = testNginxConfig();
    if (!testResult.success) {
      throw new Error(`Nginx config test failed: ${testResult.error}`);
    }

    // Queue nginx reload to apply changes
    const { reloadId } = await reloadManager.queueReload();

    // Update config status
    db.prepare(`
      UPDATE proxy_hosts
      SET config_status = 'active', config_error = NULL, config_filename = ?
      WHERE id = ?
    `).run(filename, id);

    logAudit(req.user.userId, 'update', 'proxy', id, JSON.stringify({ name: updatedProxy.name, changes: body }), getClientIP(req));

    // Get final proxy state
    const finalProxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(id);
    sendJSON(res, { success: true, proxy: finalProxy, reloadId });
  } catch (error) {
    console.error('Update proxy error:', error);

    // Mark as error if update fails
    db.prepare(`
      UPDATE proxy_hosts
      SET config_status = 'error', config_error = ?
      WHERE id = ?
    `).run(error.message || 'Update failed', id);

    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleDeleteProxy(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);

  const proxy = db.prepare('SELECT name, config_filename FROM proxy_hosts WHERE id = ?').get(id);
  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  try {
    // Use stored filename or generate for legacy records
    const filename = proxy.config_filename || `${sanitizeFilename(proxy.name)}.conf`;
    deleteNginxConfig(filename);

    db.prepare('DELETE FROM proxy_hosts WHERE id = ?').run(id);

    // Queue nginx reload to apply deletion
    const { reloadId } = await reloadManager.queueReload();

    logAudit(req.user.userId, 'delete', 'proxy', id, JSON.stringify({ name: proxy.name }), getClientIP(req));

    sendJSON(res, { success: true, reloadId });
  } catch (error) {
    console.error('Delete proxy error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleToggleProxy(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);

  const proxy = db.prepare('SELECT name, enabled, config_filename FROM proxy_hosts WHERE id = ?').get(id);
  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  try {
    const newEnabled = proxy.enabled ? 0 : 1;
    db.prepare('UPDATE proxy_hosts SET enabled = ? WHERE id = ?').run(newEnabled, id);

    // Use stored filename or generate for legacy records
    const filename = proxy.config_filename || `${sanitizeFilename(proxy.name)}.conf`;
    if (newEnabled) {
      enableNginxConfig(filename);
    } else {
      disableNginxConfig(filename);
    }

    // Queue nginx reload to apply change
    const { reloadId } = await reloadManager.queueReload();

    logAudit(req.user.userId, newEnabled ? 'enable' : 'disable', 'proxy', id, JSON.stringify({ name: proxy.name }), getClientIP(req));

    sendJSON(res, { success: true, enabled: newEnabled, reloadId });
  } catch (error) {
    console.error('Toggle proxy error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

// ============================================================================
// Module Handlers
// ============================================================================

function handleGetModules(req, res) {
  const modules = db.prepare('SELECT * FROM modules ORDER BY name ASC').all();
  sendJSON(res, modules);
}

async function handleCreateModule(req, res) {
  const body = await parseBody(req);
  const { name, description, content } = body;

  if (!name || !content) {
    return sendJSON(res, { error: 'Name and content required' }, 400);
  }

  try {
    const result = db.prepare('INSERT INTO modules (name, description, content) VALUES (?, ?, ?)').run(name, description || null, content);
    logAudit(req.user.userId, 'create', 'module', result.lastInsertRowid, JSON.stringify({ name }), getClientIP(req));
    sendJSON(res, { success: true, id: result.lastInsertRowid }, 201);
  } catch (error) {
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleUpdateModule(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);
  const body = await parseBody(req);
  const { name, description, content } = body;

  const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(id);
  if (!module) {
    return sendJSON(res, { error: 'Module not found' }, 404);
  }

  try {
    db.prepare('UPDATE modules SET name = ?, description = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(name || module.name, description !== undefined ? description : module.description, content || module.content, id);

    logAudit(req.user.userId, 'update', 'module', id, JSON.stringify({ name: name || module.name, changes: body }), getClientIP(req));
    sendJSON(res, { success: true });
  } catch (error) {
    sendJSON(res, { error: error.message }, 500);
  }
}

function handleDeleteModule(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);

  const module = db.prepare('SELECT name FROM modules WHERE id = ?').get(id);
  if (!module) {
    return sendJSON(res, { error: 'Module not found' }, 404);
  }

  try {
    db.prepare('DELETE FROM modules WHERE id = ?').run(id);
    logAudit(req.user.userId, 'delete', 'module', id, JSON.stringify({ name: module.name }), getClientIP(req));
    sendJSON(res, { success: true });
  } catch (error) {
    sendJSON(res, { error: error.message }, 500);
  }
}

function handleGetModuleSnippets(req, res) {
  // Get all modules except Gzip Compression (always enabled)
  const modules = db.prepare(`
    SELECT id, name, description, content, level
    FROM modules
    WHERE name != 'Gzip Compression'
    ORDER BY level, name
  `).all();

  // Group by level
  const grouped = {
    server: modules.filter(m => m.level === 'server'),
    location: modules.filter(m => m.level === 'location'),
    redirect: modules.filter(m => m.level === 'redirect')
  };

  sendJSON(res, grouped);
}

function handleMigrateCompressionModules(req, res) {
  const fs = require('fs');

  try {
    // Check if Brotli is installed
    const brotliPath = '/usr/share/nginx/modules/mod-brotli.conf';
    const isBrotliInstalled = fs.existsSync(brotliPath);

    const newModules = [
      {
        name: 'Gzip Compression',
        description: 'Enable gzip compression (built-in)',
        content: `gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;`
      },
      {
        name: 'Gzip Compression (Aggressive)',
        description: 'Aggressive gzip compression with more types',
        content: `gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 9;
gzip_min_length 256;
gzip_types
  application/atom+xml
  application/geo+json
  application/javascript
  application/x-javascript
  application/json
  application/ld+json
  application/manifest+json
  application/rdf+xml
  application/rss+xml
  application/vnd.ms-fontobject
  application/wasm
  application/x-web-app-manifest+json
  application/xhtml+xml
  application/xml
  font/eot
  font/otf
  font/ttf
  image/bmp
  image/svg+xml
  text/cache-manifest
  text/calendar
  text/css
  text/javascript
  text/markdown
  text/plain
  text/xml
  text/vcard
  text/vnd.rim.location.xloc
  text/vtt
  text/x-component
  text/x-cross-domain-policy;`
      },
      {
        name: 'Brotli Compression',
        description: 'Enable Brotli compression (requires nginx-mod-brotli package)',
        content: isBrotliInstalled
          ? `brotli on;
brotli_comp_level 6;
brotli_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;`
          : `# Not yet installed - run: dnf install nginx-mod-brotli`
      },
      {
        name: 'Brotli Compression (Aggressive)',
        description: 'Aggressive Brotli compression (requires nginx-mod-brotli package)',
        content: isBrotliInstalled
          ? `brotli on;
brotli_comp_level 11;
brotli_min_length 256;
brotli_types
  application/atom+xml
  application/geo+json
  application/javascript
  application/x-javascript
  application/json
  application/ld+json
  application/manifest+json
  application/rdf+xml
  application/rss+xml
  application/vnd.ms-fontobject
  application/wasm
  application/x-web-app-manifest+json
  application/xhtml+xml
  application/xml
  font/eot
  font/otf
  font/ttf
  image/bmp
  image/svg+xml
  text/cache-manifest
  text/calendar
  text/css
  text/javascript
  text/markdown
  text/plain
  text/xml;`
          : `# Not yet installed - run: dnf install nginx-mod-brotli`
      },
      {
        name: 'HTTP/3 (QUIC)',
        description: 'Enable HTTP/3 with QUIC protocol (requires nginx 1.25.0+ with http_v3_module)',
        content: `# Requires nginx 1.25.0+ compiled with --with-http_v3_module
# Current version: nginx 1.20.1 (does not support HTTP/3)
# To upgrade, see: https://nginx.org/en/docs/http/ngx_http_v3_module.html
# After upgrade, uncomment these lines:
# listen 443 quic reuseport;
# listen 443 ssl;
# http3 on;
# http3_hq on;
# quic_retry on;
# add_header Alt-Svc 'h3=":443"; ma=86400' always;`
      }
    ];

    const insertModule = db.prepare('INSERT OR IGNORE INTO modules (name, description, content) VALUES (?, ?, ?)');
    let addedCount = 0;

    for (const module of newModules) {
      const exists = db.prepare('SELECT id FROM modules WHERE name = ?').get(module.name);
      if (!exists) {
        insertModule.run(module.name, module.description, module.content);
        addedCount++;
      }
    }

    logAudit(req.user.userId, 'migrate_modules', 'module', null, JSON.stringify({ added: addedCount, brotli_installed: isBrotliInstalled }), getClientIP(req));

    sendJSON(res, {
      success: true,
      added: addedCount,
      brotli_installed: isBrotliInstalled,
      message: `Added ${addedCount} new compression module(s)`
    });
  } catch (error) {
    console.error('Migration error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

// ============================================================================
// SSL Certificate Handlers
// ============================================================================

function handleGetCertificates(req, res) {
  const certificates = db.prepare('SELECT * FROM ssl_certificates ORDER BY created_at DESC').all();

  // Add usage information for each certificate
  const certificatesWithUsage = certificates.map(cert => {
    // Get proxy hosts using this certificate
    const proxiesUsingCert = db.prepare(`
      SELECT id, name FROM proxy_hosts WHERE ssl_cert_id = ?
    `).all(cert.id);

    // Check if used by admin interface
    const { getSetting } = require('../db');
    const adminCertId = getSetting('admin_cert_id');
    const usedByAdmin = adminCertId && parseInt(adminCertId) === cert.id;

    return {
      ...cert,
      in_use: proxiesUsingCert.length > 0 || usedByAdmin,
      used_by_proxies: proxiesUsingCert,
      used_by_admin: usedByAdmin
    };
  });

  sendJSON(res, certificatesWithUsage);
}

async function handleCreateCertificate(req, res) {
  const body = await parseBody(req);
  const { name, cert_content, key_content } = body;

  if (!name || !cert_content || !key_content) {
    return sendJSON(res, { error: 'Name, certificate content, and key content required' }, 400);
  }

  try {
    // Parse certificate to extract metadata
    const certInfo = parseCertificate(cert_content);
    
    // Validate certificate and key pair
    const isValid = validateCertificateKeyPair(cert_content, key_content);
    if (!isValid) {
      return sendJSON(res, { error: 'Certificate and key do not match' }, 400);
    }

    // Save certificate files to disk
    const { certPath, keyPath } = saveCertificateFiles(cert_content, key_content, name);

    // Extract domain names and issuer
    const domainNames = certInfo.domains.join(', ');
    const issuer = certInfo.issuer.organizationName || certInfo.issuer.commonName || 'Unknown';
    const expiresAt = certInfo.notAfter ? certInfo.notAfter.toISOString() : null;

    // Insert into database
    const result = db.prepare(`
      INSERT INTO ssl_certificates (name, domain_names, issuer, expires_at, cert_path, key_path) 
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, domainNames, issuer, expiresAt, certPath, keyPath);
    
    logAudit(req.user.userId, 'create', 'certificate', result.lastInsertRowid, JSON.stringify({ name, domainNames }), getClientIP(req));
    
    sendJSON(res, { 
      success: true, 
      id: result.lastInsertRowid,
      certificate: {
        id: result.lastInsertRowid,
        name,
        domain_names: domainNames,
        issuer,
        expires_at: expiresAt,
        cert_path: certPath,
        key_path: keyPath
      }
    }, 201);
  } catch (error) {
    console.error('Certificate creation error:', error);
    sendJSON(res, { error: error.message || 'Failed to create certificate' }, 500);
  }
}

async function handleDeleteCertificate(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);

  const cert = db.prepare('SELECT name, cert_path, key_path FROM ssl_certificates WHERE id = ?').get(id);
  if (!cert) {
    return sendJSON(res, { error: 'Certificate not found' }, 404);
  }

  try {
    // Get proxy hosts using this certificate
    const affectedProxies = db.prepare('SELECT id, name FROM proxy_hosts WHERE ssl_cert_id = ?').all(id);

    // Check if used by admin interface
    const { getSetting, setSetting } = require('../db');
    const adminCertId = getSetting('admin_cert_id');
    const usedByAdmin = adminCertId && parseInt(adminCertId) === id;

    // Disable TLS on all affected proxy hosts
    if (affectedProxies.length > 0) {
      db.prepare('UPDATE proxy_hosts SET ssl_enabled = 0, ssl_cert_id = NULL WHERE ssl_cert_id = ?').run(id);

      // Regenerate configs for affected proxies
      for (const proxy of affectedProxies) {
        try {
          const updatedProxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(proxy.id);
          const modules = db.prepare(`
            SELECT m.* FROM modules m
            JOIN proxy_modules pm ON m.id = pm.module_id
            WHERE pm.proxy_id = ?
          `).all(proxy.id);

          let config;
          if (updatedProxy.type === 'stream') {
            config = generateStreamBlock(updatedProxy);
          } else if (updatedProxy.type === '404') {
            config = generate404Block(updatedProxy);
          } else {
            config = generateServerBlock(updatedProxy, modules, db);
          }

          const filename = updatedProxy.config_filename || `${sanitizeFilename(updatedProxy.name)}.conf`;
          writeNginxConfig(filename, config);

          // Ensure correct file extension based on enabled state
          if (updatedProxy.enabled) {
            enableNginxConfig(filename);
          } else {
            disableNginxConfig(filename);
          }
        } catch (configError) {
          console.error(`Failed to regenerate config for proxy ${proxy.name}:`, configError);
        }
      }

      // Test and reload nginx
      const testResult = testNginxConfig();
      if (testResult.success) {
        await reloadManager.queueReload();
      }
    }

    // Clear admin interface certificate if it was using this cert
    if (usedByAdmin) {
      setSetting('admin_cert_id', '');
    }

    // Delete certificate files from disk
    deleteCertificateFiles(cert.cert_path, cert.key_path);

    // Delete from database
    db.prepare('DELETE FROM ssl_certificates WHERE id = ?').run(id);

    const auditDetails = {
      name: cert.name,
      affected_proxies: affectedProxies.map(p => p.name),
      affected_admin: usedByAdmin
    };

    logAudit(req.user.userId, 'delete', 'certificate', id, JSON.stringify(auditDetails), getClientIP(req));

    sendJSON(res, {
      success: true,
      affected_proxies: affectedProxies.length,
      affected_admin: usedByAdmin,
      message: affectedProxies.length > 0
        ? `Certificate deleted. TLS has been disabled on ${affectedProxies.length} proxy host(s).`
        : 'Certificate deleted successfully.'
    });
  } catch (error) {
    console.error('Delete certificate error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

// ============================================================================
// Nginx Operation Handlers
// ============================================================================

function handleNginxTest(req, res) {
  const result = testNginxConfig();
  sendJSON(res, result);
}

async function handleNginxReload(req, res) {
  const { reloadId } = await reloadManager.queueReload();

  logAudit(req.user.userId, 'reload_nginx', 'nginx', null, null, getClientIP(req));

  sendJSON(res, { success: true, reloadId, message: 'Reload queued' });
}

function handleNginxReloadStatus(req, res, parsedUrl) {
  const reloadId = parseInt(parsedUrl.pathname.split('/').pop());
  const status = reloadManager.getReloadStatus(reloadId);
  sendJSON(res, status);
}

function handleNginxStatus(req, res) {
  const status = getNginxStatus();
  sendJSON(res, status);
}

function handleGetAuditLog(req, res) {
  const logs = db.prepare(`
    SELECT
      al.*,
      u.username
    FROM audit_log al
    LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.created_at DESC
    LIMIT 100
  `).all();

  sendJSON(res, logs);
}

// ============================================================================
// Settings Handlers
// ============================================================================

function handleGetSettings(req, res) {
  const settings = {};
  const allSettings = getAllSettings();

  // Convert array of {key, value} to object
  for (const setting of allSettings) {
    settings[setting.key] = setting.value;
  }

  sendJSON(res, settings);
}

async function handleUpdateSettings(req, res) {
  const body = await parseBody(req);
  const { default_server_behavior, default_server_custom_url, admin_cert_id } = body;

  try {
    // Validate behavior option
    const validBehaviors = ['drop', '404', 'custom'];
    if (default_server_behavior && !validBehaviors.includes(default_server_behavior)) {
      return sendJSON(res, { error: 'Invalid default server behavior' }, 400);
    }

    let adminCertChanged = false;

    // Update settings
    if (default_server_behavior) {
      setSetting('default_server_behavior', default_server_behavior);
    }

    if (default_server_custom_url !== undefined) {
      setSetting('default_server_custom_url', default_server_custom_url);
    }

    // Handle admin certificate update
    if (admin_cert_id !== undefined) {
      // Validate certificate exists if provided
      if (admin_cert_id) {
        const cert = db.prepare('SELECT id FROM ssl_certificates WHERE id = ?').get(parseInt(admin_cert_id));
        if (!cert) {
          return sendJSON(res, { error: 'Invalid certificate ID' }, 400);
        }
      }
      setSetting('admin_cert_id', admin_cert_id || '');
      adminCertChanged = true;
    }

    // Regenerate default server configuration (only for nginx settings)
    if (default_server_behavior || default_server_custom_url !== undefined) {
      const { initializeDefaultServer } = require('../utils/default-server');
      initializeDefaultServer();

      // Reload nginx to apply changes
      const { reloadId } = await reloadManager.queueReload();
      if (!reloadResult.success) {
        return sendJSON(res, { error: `Settings saved but nginx reload failed: ${reloadResult.error}` }, 500);
      }
    }

    logAudit(req.user.userId, 'update_settings', 'settings', null, JSON.stringify(body), getClientIP(req));

    // Different message if admin cert was changed
    if (adminCertChanged) {
      sendJSON(res, {
        success: true,
        message: 'Settings updated successfully',
        requiresRestart: true,
        restartMessage: 'Admin interface certificate changed. Please restart the server for changes to take effect.'
      });
    } else {
      sendJSON(res, { success: true, message: 'Settings updated successfully' });
    }
  } catch (error) {
    console.error('Update settings error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

// ============================================================================
// Custom Config Handlers (Text Editor)
// ============================================================================

function handleGetRawConfig(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[4]);

  const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(id);
  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  try {
    let config = proxy.advanced_config;

    // If advanced_config is empty, generate from structured fields (lazy migration)
    if (!config || !config.trim()) {
      const { migrateProxyToTextEditor } = require('../utils/config-migration');

      // Get associated modules for this proxy
      const modules = db.prepare(`
        SELECT m.* FROM modules m
        INNER JOIN proxy_modules pm ON m.id = pm.module_id
        WHERE pm.proxy_id = ?
      `).all(proxy.id);

      config = migrateProxyToTextEditor(proxy, modules, db);
    }

    sendJSON(res, {
      config,
      name: proxy.name,
      type: proxy.type,
      enabled: proxy.enabled === 1,
      launch_url: proxy.launch_url || null
    });
  } catch (error) {
    console.error('Get raw config error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleGetConfigTemplate(req, res) {
  const body = await parseBody(req);
  const { type, name, options } = body;

  if (!type) {
    return sendJSON(res, { error: 'Proxy type required' }, 400);
  }

  try {
    const { getTemplateForType } = require('../utils/config-templates');
    const config = getTemplateForType(type, name || 'New Proxy', options || {});

    sendJSON(res, { config });
  } catch (error) {
    console.error('Get config template error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleTestCustomConfig(req, res) {
  const body = await parseBody(req);
  const { config } = body;

  if (!config) {
    return sendJSON(res, { error: 'Config content required' }, 400);
  }

  try {
    // Generate test filename
    const testFilename = `test_${Date.now()}.conf`;

    // Write temporary config file
    writeNginxConfig(testFilename, config);

    // Test nginx configuration
    const testResult = testNginxConfig();

    // Clean up test file (force delete, don't rename)
    try {
      forceDeleteNginxConfig(testFilename);
    } catch (cleanupError) {
      console.error('Test config cleanup error:', cleanupError);
    }

    if (!testResult.success) {
      return sendJSON(res, {
        success: false,
        error: testResult.error,
        message: 'Configuration test failed. Please fix the errors before saving.'
      }, 400);
    }

    sendJSON(res, {
      success: true,
      message: 'Configuration test passed! You can now save this configuration.'
    });
  } catch (error) {
    console.error('Test custom config error:', error);
    sendJSON(res, {
      success: false,
      error: error.message || 'Failed to test configuration'
    }, 500);
  }
}

async function handleSaveCustomConfig(req, res) {
  const body = await parseBody(req);
  const { proxyId, name, type, enabled, config, launch_url } = body;

  if (!name || !config) {
    return sendJSON(res, { error: 'Name and config content required' }, 400);
  }

  let finalProxyId = proxyId ? parseInt(proxyId) : null;
  const isUpdate = !!finalProxyId;

  try {
    // Generate filename from name
    const safeFilename = sanitizeFilename(name);
    const configFilename = `${finalProxyId || 'new'}-${safeFilename}.conf`;

    // Update or insert
    if (isUpdate) {
      // Update existing proxy
      const existing = db.prepare('SELECT id FROM proxy_hosts WHERE id = ?').get(finalProxyId);
      if (!existing) {
        return sendJSON(res, { error: 'Proxy not found' }, 404);
      }

      db.prepare(`
        UPDATE proxy_hosts
        SET name = ?, type = ?, enabled = ?, advanced_config = ?, launch_url = ?,
            config_filename = ?, config_status = 'pending', domain_names = 'N/A', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, type, enabled ? 1 : 0, config, launch_url || null, configFilename, finalProxyId);
    } else {
      // Insert new proxy
      const result = db.prepare(`
        INSERT INTO proxy_hosts (name, type, enabled, advanced_config, launch_url, config_filename,
                                  config_status, domain_names, forward_host, forward_port)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', 'N/A', 'N/A', 0)
      `).run(name, type, enabled ? 1 : 0, config, launch_url || null, configFilename);
      finalProxyId = result.lastInsertRowid;

      // Update filename with actual ID
      const actualFilename = `${finalProxyId}-${safeFilename}.conf`;
      db.prepare('UPDATE proxy_hosts SET config_filename = ? WHERE id = ?').run(actualFilename, finalProxyId);
      configFilename = actualFilename;
    }

    // Write nginx config
    writeNginxConfig(configFilename, config);

    // Enable or disable based on enabled flag
    if (enabled) {
      enableNginxConfig(configFilename);
    } else {
      disableNginxConfig(configFilename);
    }

    // Test nginx configuration
    const testResult = testNginxConfig();
    if (!testResult.success) {
      throw new Error(`Nginx config test failed: ${testResult.error}`);
    }

    // Reload nginx to apply changes
    const { reloadId } = await reloadManager.queueReload();

    // Update status to active
    db.prepare(`
      UPDATE proxy_hosts
      SET config_status = 'active', config_error = NULL
      WHERE id = ?
    `).run(finalProxyId);

    logAudit(req.user.userId, isUpdate ? 'update' : 'create', 'proxy', finalProxyId, JSON.stringify({ name, type, launch_url }), getClientIP(req));

    // Get updated proxy for response
    const updatedProxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(finalProxyId);

    sendJSON(res, {
      success: true,
      proxyId: finalProxyId,
      proxy: updatedProxy,
      message: isUpdate ? 'Proxy updated successfully!' : 'Proxy created successfully!'
    }, isUpdate ? 200 : 201);
  } catch (error) {
    console.error('Save config error:', error);

    // Rollback: mark as error if proxy was created
    if (finalProxyId) {
      try {
        db.prepare(`
          UPDATE proxy_hosts
          SET config_status = 'error', config_error = ?, enabled = 0
          WHERE id = ?
        `).run(error.message || 'Configuration failed', finalProxyId);
      } catch (rollbackError) {
        console.error('Rollback error:', rollbackError);
      }
    }

    sendJSON(res, { error: error.message || 'Failed to save configuration' }, 500);
  }
}

// ============================================================================
// Statistics Handlers
// ============================================================================

async function handleGetStatistics(req, res, parsedUrl) {
  try {
    // Get query parameters
    const params = new URLSearchParams(parsedUrl.search);
    const timeRange = params.get('range') || '24h';
    // Allow forcing cache refresh via query parameter
    const forceRefresh = params.get('refresh') === 'true';

    // Force refresh if requested
    if (forceRefresh) {
      await refreshStatsCache();
    }

    // Get traffic statistics from unified cache (5-minute refresh)
    let statistics = getCachedTrafficStats(timeRange);

    // If cache not ready yet, return empty stats
    if (!statistics) {
      statistics = {
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
    } else {
      // Map to legacy format for backward compatibility
      statistics = {
        ...statistics,
        uniqueVisitors: statistics.totalRequests, // Approximate
        statusCodes: statistics.statusCategories,
        errors4xx: statistics.statusCategories['4xx'] || 0,
        errors5xx: statistics.statusCategories['5xx'] || 0,
        errorRate4xx: statistics.errorRate,
        errorRate5xx: statistics.errorRate
        // topHosts is already included from statistics spread above
      };
    }

    sendJSON(res, statistics);
  } catch (error) {
    console.error('Statistics error:', error);
    sendJSON(res, { error: error.message || 'Failed to get statistics' }, 500);
  }
}

// ============================================================================
// Security Rules Handlers
// ============================================================================

function handleGetSecurityRules(req, res, parsedUrl) {
  try {
    const params = new URLSearchParams(parsedUrl.search);
    const ruleType = params.get('type');

    let query = 'SELECT * FROM security_rules';
    let queryParams = [];

    if (ruleType) {
      query += ' WHERE rule_type = ?';
      queryParams.push(ruleType);
    }

    query += ' ORDER BY created_at DESC';

    const rules = db.prepare(query).all(...queryParams);
    sendJSON(res, { rules });
  } catch (error) {
    console.error('Get security rules error:', error);
    sendJSON(res, { error: error.message || 'Failed to get security rules' }, 500);
  }
}

async function handleCreateSecurityRule(req, res) {
  try {
    const body = await parseBody(req);
    const { rule_type, rule_value, action, description, enabled } = body;

    if (!rule_type || !rule_value) {
      return sendJSON(res, { error: 'rule_type and rule_value are required' }, 400);
    }

    // Validate rule_type
    const validTypes = ['ip_blacklist', 'geo_block', 'user_agent_filter'];
    if (!validTypes.includes(rule_type)) {
      return sendJSON(res, { error: 'Invalid rule_type' }, 400);
    }

    const result = db.prepare(`
      INSERT INTO security_rules (rule_type, rule_value, action, description, enabled)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      rule_type,
      rule_value,
      action || 'deny',
      description || null,
      enabled !== undefined ? enabled : 1
    );

    // Update global security config
    const { updateGlobalSecurityConfig } = require('../utils/security-config-generator');
    updateGlobalSecurityConfig(db);

    // Log audit
    logAudit(
      req.user.id,
      'create',
      'security_rule',
      result.lastInsertRowid,
      `Created ${rule_type} rule: ${rule_value}`,
      getClientIP(req)
    );

    // Trigger nginx reload
    const { safeReload } = require('../utils/nginx-ops');
    const { reloadId } = await reloadManager.queueReload();
    if (!reloadResult.success) {
      console.error('Nginx reload error:', reloadResult.error);
    }

    sendJSON(res, {
      success: true,
      id: result.lastInsertRowid,
      message: 'Security rule created successfully'
    });
  } catch (error) {
    console.error('Create security rule error:', error);
    sendJSON(res, { error: error.message || 'Failed to create security rule' }, 500);
  }
}

async function handleUpdateSecurityRule(req, res, parsedUrl) {
  try {
    const id = parseInt(parsedUrl.pathname.split('/')[4]);
    const body = await parseBody(req);
    const { rule_value, action, description, enabled } = body;

    const rule = db.prepare('SELECT * FROM security_rules WHERE id = ?').get(id);
    if (!rule) {
      return sendJSON(res, { error: 'Security rule not found' }, 404);
    }

    db.prepare(`
      UPDATE security_rules
      SET rule_value = ?, action = ?, description = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      rule_value || rule.rule_value,
      action || rule.action,
      description !== undefined ? description : rule.description,
      enabled !== undefined ? enabled : rule.enabled,
      id
    );

    // Update global security config
    const { updateGlobalSecurityConfig } = require('../utils/security-config-generator');
    updateGlobalSecurityConfig(db);

    // Log audit
    logAudit(
      req.user.id,
      'update',
      'security_rule',
      id,
      `Updated ${rule.rule_type} rule: ${rule_value || rule.rule_value}`,
      getClientIP(req)
    );

    // Trigger nginx reload
    const { safeReload } = require('../utils/nginx-ops');
    const { reloadId } = await reloadManager.queueReload();
    if (!reloadResult.success) {
      console.error('Nginx reload error:', reloadResult.error);
    }

    sendJSON(res, { success: true, message: 'Security rule updated successfully' });
  } catch (error) {
    console.error('Update security rule error:', error);
    sendJSON(res, { error: error.message || 'Failed to update security rule' }, 500);
  }
}

async function handleDeleteSecurityRule(req, res, parsedUrl) {
  try {
    const id = parseInt(parsedUrl.pathname.split('/')[4]);

    const rule = db.prepare('SELECT * FROM security_rules WHERE id = ?').get(id);
    if (!rule) {
      return sendJSON(res, { error: 'Security rule not found' }, 404);
    }

    db.prepare('DELETE FROM security_rules WHERE id = ?').run(id);

    // Update global security config
    const { updateGlobalSecurityConfig } = require('../utils/security-config-generator');
    updateGlobalSecurityConfig(db);

    // Log audit
    logAudit(
      req.user.id,
      'delete',
      'security_rule',
      id,
      `Deleted ${rule.rule_type} rule: ${rule.rule_value}`,
      getClientIP(req)
    );

    // Trigger nginx reload
    const { safeReload } = require('../utils/nginx-ops');
    const { reloadId } = await reloadManager.queueReload();
    if (!reloadResult.success) {
      console.error('Nginx reload error:', reloadResult.error);
    }

    sendJSON(res, { success: true, message: 'Security rule deleted successfully' });
  } catch (error) {
    console.error('Delete security rule error:', error);
    sendJSON(res, { error: error.message || 'Failed to delete security rule' }, 500);
  }
}

async function handleBulkImportSecurityRules(req, res) {
  try {
    const body = await parseBody(req);
    const { rule_type, rules } = body;

    if (!rule_type || !Array.isArray(rules) || rules.length === 0) {
      return sendJSON(res, { error: 'rule_type and rules array are required' }, 400);
    }

    const validTypes = ['ip_blacklist', 'geo_block', 'user_agent_filter'];
    if (!validTypes.includes(rule_type)) {
      return sendJSON(res, { error: 'Invalid rule_type' }, 400);
    }

    const insertStmt = db.prepare(`
      INSERT INTO security_rules (rule_type, rule_value, action, description, enabled)
      VALUES (?, ?, ?, ?, ?)
    `);

    let imported = 0;
    for (const rule of rules) {
      if (rule.rule_value) {
        insertStmt.run(
          rule_type,
          rule.rule_value,
          rule.action || 'deny',
          rule.description || null,
          rule.enabled !== undefined ? rule.enabled : 1
        );
        imported++;
      }
    }

    // Update global security config
    const { updateGlobalSecurityConfig } = require('../utils/security-config-generator');
    updateGlobalSecurityConfig(db);

    // Log audit
    logAudit(
      req.user.id,
      'bulk_import',
      'security_rule',
      null,
      `Bulk imported ${imported} ${rule_type} rules`,
      getClientIP(req)
    );

    // Trigger nginx reload
    const { safeReload } = require('../utils/nginx-ops');
    const { reloadId } = await reloadManager.queueReload();
    if (!reloadResult.success) {
      console.error('Nginx reload error:', reloadResult.error);
    }

    sendJSON(res, {
      success: true,
      imported,
      message: `Successfully imported ${imported} security rules`
    });
  } catch (error) {
    console.error('Bulk import security rules error:', error);
    sendJSON(res, { error: error.message || 'Failed to bulk import security rules' }, 500);
  }
}

// ============================================================================
// Rate Limiting Handlers
// ============================================================================

function handleGetRateLimits(req, res, parsedUrl) {
  try {
    const params = new URLSearchParams(parsedUrl.search);
    const proxyId = params.get('proxy_id');

    let query = 'SELECT * FROM rate_limits';
    let queryParams = [];

    if (proxyId) {
      query += ' WHERE proxy_id = ?';
      queryParams.push(parseInt(proxyId));
    }

    query += ' ORDER BY created_at DESC';

    const rateLimits = db.prepare(query).all(...queryParams);
    sendJSON(res, { rateLimits });
  } catch (error) {
    console.error('Get rate limits error:', error);
    sendJSON(res, { error: error.message || 'Failed to get rate limits' }, 500);
  }
}

async function handleCreateRateLimit(req, res) {
  try {
    const body = await parseBody(req);
    const { proxy_id, rate, burst, nodelay, enabled } = body;

    if (!proxy_id || !rate) {
      return sendJSON(res, { error: 'proxy_id and rate are required' }, 400);
    }

    // Check if proxy exists
    const proxy = db.prepare('SELECT id, name FROM proxy_hosts WHERE id = ?').get(proxy_id);
    if (!proxy) {
      return sendJSON(res, { error: 'Proxy not found' }, 404);
    }

    // Generate zone name
    const zoneName = `proxy_${proxy_id}_ratelimit`;

    const result = db.prepare(`
      INSERT INTO rate_limits (proxy_id, zone_name, rate, burst, nodelay, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      proxy_id,
      zoneName,
      rate,
      burst !== undefined ? burst : 50,
      nodelay !== undefined ? nodelay : 0,
      enabled !== undefined ? enabled : 1
    );

    // Update global security config and regenerate proxy config
    const { updateGlobalSecurityConfig } = require('../utils/security-config-generator');
    updateGlobalSecurityConfig(db);

    // Regenerate the proxy config
    const updatedProxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(proxy_id);
    const modules = db.prepare(`
      SELECT m.* FROM modules m
      JOIN proxy_modules pm ON m.id = pm.module_id
      WHERE pm.proxy_id = ?
    `).all(proxy_id);

    const { generateServerBlock, writeNginxConfig } = require('../utils/nginx-parser');
    let config = generateServerBlock(updatedProxy, modules, db);

    // Replace SSL placeholders if needed
    if (updatedProxy.ssl_enabled && updatedProxy.ssl_cert_id) {
      const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?')
        .get(updatedProxy.ssl_cert_id);
      if (cert) {
        config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
        config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
      }
    }

    const filename = updatedProxy.config_filename || `${updatedProxy.id}.conf`;
    writeNginxConfig(filename, config);

    // Ensure correct file extension based on enabled state
    if (updatedProxy.enabled) {
      enableNginxConfig(filename);
    } else {
      disableNginxConfig(filename);
    }

    // Log audit
    logAudit(
      req.user.id,
      'create',
      'rate_limit',
      result.lastInsertRowid,
      `Created rate limit for proxy ${proxy.name}: ${rate}`,
      getClientIP(req)
    );

    // Trigger nginx reload
    const { safeReload } = require('../utils/nginx-ops');
    const { reloadId } = await reloadManager.queueReload();
    if (!reloadResult.success) {
      console.error('Nginx reload error:', reloadResult.error);
    }

    sendJSON(res, {
      success: true,
      id: result.lastInsertRowid,
      message: 'Rate limit created successfully'
    });
  } catch (error) {
    console.error('Create rate limit error:', error);
    sendJSON(res, { error: error.message || 'Failed to create rate limit' }, 500);
  }
}

async function handleUpdateRateLimit(req, res, parsedUrl) {
  try {
    const id = parseInt(parsedUrl.pathname.split('/')[4]);
    const body = await parseBody(req);
    const { rate, burst, nodelay, enabled } = body;

    const rateLimit = db.prepare('SELECT * FROM rate_limits WHERE id = ?').get(id);
    if (!rateLimit) {
      return sendJSON(res, { error: 'Rate limit not found' }, 404);
    }

    db.prepare(`
      UPDATE rate_limits
      SET rate = ?, burst = ?, nodelay = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      rate || rateLimit.rate,
      burst !== undefined ? burst : rateLimit.burst,
      nodelay !== undefined ? nodelay : rateLimit.nodelay,
      enabled !== undefined ? enabled : rateLimit.enabled,
      id
    );

    // Update global security config and regenerate proxy config
    const { updateGlobalSecurityConfig } = require('../utils/security-config-generator');
    updateGlobalSecurityConfig(db);

    // Regenerate the proxy config
    const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(rateLimit.proxy_id);
    const modules = db.prepare(`
      SELECT m.* FROM modules m
      JOIN proxy_modules pm ON m.id = pm.module_id
      WHERE pm.proxy_id = ?
    `).all(rateLimit.proxy_id);

    const { generateServerBlock, writeNginxConfig } = require('../utils/nginx-parser');
    let config = generateServerBlock(proxy, modules, db);

    // Replace SSL placeholders if needed
    if (proxy.ssl_enabled && proxy.ssl_cert_id) {
      const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?')
        .get(proxy.ssl_cert_id);
      if (cert) {
        config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
        config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
      }
    }

    const filename = proxy.config_filename || `${proxy.id}.conf`;
    writeNginxConfig(filename, config);

    // Ensure correct file extension based on enabled state
    if (proxy.enabled) {
      enableNginxConfig(filename);
    } else {
      disableNginxConfig(filename);
    }

    // Log audit
    logAudit(
      req.user.id,
      'update',
      'rate_limit',
      id,
      `Updated rate limit: ${rate || rateLimit.rate}`,
      getClientIP(req)
    );

    // Trigger nginx reload
    const { safeReload } = require('../utils/nginx-ops');
    const { reloadId } = await reloadManager.queueReload();
    if (!reloadResult.success) {
      console.error('Nginx reload error:', reloadResult.error);
    }

    sendJSON(res, { success: true, message: 'Rate limit updated successfully' });
  } catch (error) {
    console.error('Update rate limit error:', error);
    sendJSON(res, { error: error.message || 'Failed to update rate limit' }, 500);
  }
}

async function handleDeleteRateLimit(req, res, parsedUrl) {
  try {
    const id = parseInt(parsedUrl.pathname.split('/')[4]);

    const rateLimit = db.prepare('SELECT * FROM rate_limits WHERE id = ?').get(id);
    if (!rateLimit) {
      return sendJSON(res, { error: 'Rate limit not found' }, 404);
    }

    db.prepare('DELETE FROM rate_limits WHERE id = ?').run(id);

    // Update global security config and regenerate proxy config
    const { updateGlobalSecurityConfig } = require('../utils/security-config-generator');
    updateGlobalSecurityConfig(db);

    // Regenerate the proxy config
    const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(rateLimit.proxy_id);
    if (proxy) {
      const modules = db.prepare(`
        SELECT m.* FROM modules m
        JOIN proxy_modules pm ON m.id = pm.module_id
        WHERE pm.proxy_id = ?
      `).all(rateLimit.proxy_id);

      const { generateServerBlock, writeNginxConfig } = require('../utils/nginx-parser');
      let config = generateServerBlock(proxy, modules, db);

      // Replace SSL placeholders if needed
      if (proxy.ssl_enabled && proxy.ssl_cert_id) {
        const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?')
          .get(proxy.ssl_cert_id);
        if (cert) {
          config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
          config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
        }
      }

      const filename = proxy.config_filename || `${proxy.id}.conf`;
      writeNginxConfig(filename, config);

      // Ensure correct file extension based on enabled state
      if (proxy.enabled) {
        enableNginxConfig(filename);
      } else {
        disableNginxConfig(filename);
      }
    }

    // Log audit
    logAudit(
      req.user.id,
      'delete',
      'rate_limit',
      id,
      `Deleted rate limit for proxy ${rateLimit.proxy_id}`,
      getClientIP(req)
    );

    // Trigger nginx reload
    const { safeReload } = require('../utils/nginx-ops');
    const { reloadId } = await reloadManager.queueReload();
    if (!reloadResult.success) {
      console.error('Nginx reload error:', reloadResult.error);
    }

    sendJSON(res, { success: true, message: 'Rate limit deleted successfully' });
  } catch (error) {
    console.error('Delete rate limit error:', error);
    sendJSON(res, { error: error.message || 'Failed to delete rate limit' }, 500);
  }
}

// ============================================================================
// Security Settings Handlers
// ============================================================================

function handleGetSecuritySettings(req, res) {
  try {
    const settingKeys = [
      'security_ip_blacklist_enabled',
      'security_geo_blocking_enabled',
      'security_user_agent_filtering_enabled',
      'security_default_deny_countries',
      'security_geoip_database_path',
      'waf_enabled',
      'waf_mode',
      'waf_default_profile_id'
    ];

    const settings = {};
    for (const key of settingKeys) {
      const value = getSetting(key);
      // Convert '0'/'1' to boolean for enabled fields
      if (key.endsWith('_enabled')) {
        settings[key] = value === '1';
      } else {
        settings[key] = value || '';
      }
    }

    sendJSON(res, settings);
  } catch (error) {
    console.error('Get security settings error:', error);
    sendJSON(res, { error: error.message || 'Failed to get security settings' }, 500);
  }
}

async function handleUpdateSecuritySettings(req, res) {
  try {
    const body = await parseBody(req);

    const allowedKeys = [
      'security_ip_blacklist_enabled',
      'security_geo_blocking_enabled',
      'security_user_agent_filtering_enabled',
      'security_default_deny_countries',
      'security_geoip_database_path',
      'waf_enabled',
      'waf_mode',
      'waf_default_profile_id'
    ];

    for (const key of allowedKeys) {
      if (body.hasOwnProperty(key)) {
        let value = body[key];
        // Convert boolean to '0'/'1' for enabled fields
        if (key.endsWith('_enabled')) {
          value = value ? '1' : '0';
        }
        setSetting(key, String(value));
      }
    }

    // Update global security config
    const { updateGlobalSecurityConfig } = require('../utils/security-config-generator');
    updateGlobalSecurityConfig(db);

    // Log audit
    logAudit(
      req.user.id,
      'update',
      'security_settings',
      null,
      `Updated security settings`,
      getClientIP(req)
    );

    // Trigger nginx reload
    const { safeReload } = require('../utils/nginx-ops');
    const { reloadId } = await reloadManager.queueReload();
    if (!reloadResult.success) {
      console.error('Nginx reload error:', reloadResult.error);
    }

    sendJSON(res, { success: true, message: 'Security settings updated successfully' });
  } catch (error) {
    console.error('Update security settings error:', error);
    sendJSON(res, { error: error.message || 'Failed to update security settings' }, 500);
  }
}

// ============================================================================
// Security Statistics Handlers
// ============================================================================

function handleGetSecurityStats(req, res, parsedUrl) {
  try {
    const { getCachedSecurityStats } = require('../utils/stats-cache-service');
    const params = new URLSearchParams(parsedUrl.search);
    const timeRange = params.get('range') || '24h';

    // Get cached stats
    const stats = getCachedSecurityStats(timeRange);

    if (!stats) {
      // Cache not ready yet, return basic rule counts
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

      return sendJSON(res, {
        timeRange,
        blocked: {
          total: 0,
          byRule: {
            ip_blacklist: 0,
            geo_block: 0,
            user_agent_filter: 0,
            rate_limit: 0
          }
        },
        topBlockedIPs: [],
        topBlockedCountries: [],
        rateLimitHits: 0,
        activeRules: {
          ipBlacklist: ipBlacklistCount,
          geoBlock: geoBlockCount,
          userAgentFilter: uaFilterCount,
          rateLimit: rateLimitCount
        },
        cacheStatus: 'loading'
      });
    }

    sendJSON(res, {
      ...stats,
      cacheStatus: 'ready'
    });
  } catch (error) {
    console.error('Get security stats error:', error);
    sendJSON(res, { error: error.message || 'Failed to get security stats' }, 500);
  }
}

function handleGetRecentBlocks(req, res, parsedUrl) {
  try {
    // For now, return empty array
    // In the future, parse nginx logs for 403/429 responses
    const params = new URLSearchParams(parsedUrl.search);
    const limit = parseInt(params.get('limit') || '50');

    const blocks = [];

    sendJSON(res, { blocks });
  } catch (error) {
    console.error('Get recent blocks error:', error);
    sendJSON(res, { error: error.message || 'Failed to get recent blocks' }, 500);
  }
}

// ============================================================================
// Nginx Tuning & Statistics Handlers
// ============================================================================

/**
 * Get nginx tuning stats (top 10s for tuning decisions)
 */
async function handleGetNginxTuningStats(req, res, parsedUrl) {
  try {
    const { getCachedNginxStats, getCacheAge } = require('../utils/stats-cache-service');
    const params = new URLSearchParams(parsedUrl.search);
    const hoursBack = parseInt(params.get('hours') || '24');
    const excludePrivate = params.get('excludePrivate') !== 'false'; // Default true

    // Determine cache key based on hours
    const timeRange = hoursBack === 24 ? '24h' : '7d';

    // Get cached stats
    const stats = getCachedNginxStats(timeRange, excludePrivate);

    if (!stats) {
      // Cache not ready yet, return minimal response
      return sendJSON(res, {
        timeRange: `${hoursBack}h`,
        topIPs: [],
        topUserAgents: [],
        topCountries: [],
        totalRequests: 0,
        uniqueIPCount: 0,
        blockedRequests: 0,
        rateLimitedRequests: 0,
        cacheStatus: 'loading',
        message: 'Statistics are being generated. Please refresh in a few seconds.'
      });
    }

    sendJSON(res, {
      timeRange: `${hoursBack}h`,
      topIPs: stats.topIPs,
      topUserAgents: stats.topUserAgents,
      topCountries: stats.topCountries || [],
      totalRequests: stats.totalRequests,
      uniqueIPCount: stats.uniqueIPCount,
      blockedRequests: stats.blockedRequests,
      rateLimitedRequests: stats.rateLimitedRequests,
      cacheStatus: 'ready',
      cacheAge: getCacheAge()
    });
  } catch (error) {
    console.error('Get nginx tuning stats error:', error);
    sendJSON(res, { error: error.message || 'Failed to get tuning statistics' }, 500);
  }
}

/**
 * Get nginx statistics (effectiveness metrics)
 */
async function handleGetNginxStatistics(req, res, parsedUrl) {
  try {
    const { getCachedNginxStats, getCacheAge } = require('../utils/stats-cache-service');
    const params = new URLSearchParams(parsedUrl.search);
    const hoursBack = parseInt(params.get('hours') || '24');

    // Determine cache key based on hours
    const timeRange = hoursBack === 24 ? '24h' : '7d';

    // Get cached stats
    const stats = getCachedNginxStats(timeRange, false); // Don't exclude private IPs for this endpoint

    if (!stats) {
      // Cache not ready yet
      return sendJSON(res, {
        timeRange: `${hoursBack}h`,
        totalRequests: 0,
        successfulRequests: 0,
        blockedRequests: 0,
        rateLimitedRequests: 0,
        successRate: '0.00',
        blockedPercentage: '0.00',
        rateLimitedPercentage: '0.00',
        statusBreakdown: {},
        errorStats: {},
        activeRules: {
          ipBlacklist: 0,
          geoBlock: 0,
          userAgentFilter: 0,
          rateLimit: 0
        },
        metrics: {
          avgRequestsPerHour: 0,
          avgBlocksPerHour: 0,
          avgRateLimitsPerHour: 0
        },
        cacheStatus: 'loading',
        message: 'Statistics are being generated. Please refresh in a few seconds.'
      });
    }

    // Calculate additional metrics
    const successRate = stats.totalRequests > 0
      ? ((stats.successfulRequests / stats.totalRequests) * 100).toFixed(2)
      : '0.00';

    const blockedPercentage = stats.totalRequests > 0
      ? ((stats.blockedRequests / stats.totalRequests) * 100).toFixed(2)
      : '0.00';

    const rateLimitedPercentage = stats.totalRequests > 0
      ? ((stats.rateLimitedRequests / stats.totalRequests) * 100).toFixed(2)
      : '0.00';

    // Get security rule counts
    const activeRules = {
      ipBlacklist: db.prepare(
        "SELECT COUNT(*) as count FROM security_rules WHERE rule_type = 'ip_blacklist' AND enabled = 1"
      ).get().count,
      geoBlock: db.prepare(
        "SELECT COUNT(*) as count FROM security_rules WHERE rule_type = 'geo_block' AND enabled = 1"
      ).get().count,
      userAgentFilter: db.prepare(
        "SELECT COUNT(*) as count FROM security_rules WHERE rule_type = 'user_agent_filter' AND enabled = 1"
      ).get().count,
      rateLimit: db.prepare(
        "SELECT COUNT(*) as count FROM rate_limits WHERE enabled = 1"
      ).get().count
    };

    sendJSON(res, {
      timeRange: `${hoursBack}h`,
      totalRequests: stats.totalRequests,
      successfulRequests: stats.successfulRequests,
      blockedRequests: stats.blockedRequests,
      rateLimitedRequests: stats.rateLimitedRequests,
      successRate,
      blockedPercentage,
      rateLimitedPercentage,
      statusBreakdown: stats.requestsByStatus,
      errorStats: stats.errorStats,
      activeRules,
      metrics: {
        avgRequestsPerHour: (stats.totalRequests / hoursBack).toFixed(0),
        avgBlocksPerHour: (stats.blockedRequests / hoursBack).toFixed(0),
        avgRateLimitsPerHour: (stats.rateLimitedRequests / hoursBack).toFixed(0)
      },
      cacheStatus: 'ready',
      cacheAge: getCacheAge()
    });
  } catch (error) {
    console.error('Get nginx statistics error:', error);
    sendJSON(res, { error: error.message || 'Failed to get nginx statistics' }, 500);
  }
}

// ============================================================================
// DNS Providers Handlers
// ============================================================================

/**
 * Get list of DNS providers
 */
function handleGetDNSProviders(req, res) {
  try {
    const providers = getProviders();
    sendJSON(res, { providers });
  } catch (error) {
    console.error('Get DNS providers error:', error);
    sendJSON(res, { error: error.message || 'Failed to get DNS providers' }, 500);
  }
}

// ============================================================================
// DNS Credentials Handlers
// ============================================================================

/**
 * Get all DNS credentials
 */
function handleGetDNSCredentials(req, res) {
  try {
    // Check if encryption is configured
    if (!isEncryptionConfigured()) {
      return sendJSON(res, {
        error: 'Encryption not configured. Please set CERT_ENCRYPTION_KEY in .env file',
        credentials: []
      }, 500);
    }

    // Use unified credentials table with dns credential_type filter
    const credentials = db.prepare(`
      SELECT
        id,
        name,
        provider,
        created_at,
        updated_at
      FROM credentials
      WHERE credential_type = 'dns'
      ORDER BY created_at DESC
    `).all();

    sendJSON(res, { credentials });
  } catch (error) {
    console.error('Get DNS credentials error:', error);
    sendJSON(res, { error: error.message || 'Failed to get DNS credentials' }, 500);
  }
}

/**
 * Create new DNS credential
 */
async function handleCreateDNSCredential(req, res) {
  try {
    const body = await parseBody(req);
    const { name, provider, credentials } = body;

    // Validate inputs
    if (!name || !provider || !credentials) {
      return sendJSON(res, { error: 'Name, provider, and credentials are required' }, 400);
    }

    // Check if encryption is configured
    if (!isEncryptionConfigured()) {
      return sendJSON(res, {
        error: 'Encryption not configured. Please set CERT_ENCRYPTION_KEY in .env file'
      }, 500);
    }

    // Validate provider
    const providerDef = getProvider(provider);
    if (!providerDef) {
      return sendJSON(res, { error: `Unknown provider: ${provider}` }, 400);
    }

    // Validate credentials
    const validation = validateCredentials(provider, credentials);
    if (!validation.valid) {
      return sendJSON(res, {
        error: 'Invalid credentials',
        details: validation.errors
      }, 400);
    }

    // Check for duplicate name
    const existing = db.prepare(
      'SELECT id FROM credentials WHERE name = ? AND credential_type = ?'
    ).get(name, 'dns');

    if (existing) {
      return sendJSON(res, { error: 'Credential with this name already exists' }, 400);
    }

    // Encrypt credentials
    const encrypted = encryptCredentials(credentials);

    // Insert into database
    const result = db.prepare(`
      INSERT INTO credentials (name, credential_type, provider, credentials_encrypted, created_by)
      VALUES (?, 'dns', ?, ?, ?)
    `).run(name, provider, encrypted, req.user.id);

    logAudit(req.user.id, 'create', 'dns_credential', result.lastInsertRowid, null, getClientIP(req));

    sendJSON(res, {
      success: true,
      message: 'DNS credential created successfully',
      id: result.lastInsertRowid
    }, 201);
  } catch (error) {
    console.error('Create DNS credential error:', error);
    sendJSON(res, { error: error.message || 'Failed to create DNS credential' }, 500);
  }
}

/**
 * Update DNS credential
 */
async function handleUpdateDNSCredential(req, res, parsedUrl) {
  try {
    const id = parseInt(parsedUrl.pathname.split('/').pop());
    const body = await parseBody(req);
    const { name, credentials } = body;

    // Check if credential exists
    const existing = db.prepare('SELECT * FROM credentials WHERE id = ? AND credential_type = ?').get(id, 'dns');
    if (!existing) {
      return sendJSON(res, { error: 'DNS credential not found' }, 404);
    }

    // Check if encryption is configured
    if (!isEncryptionConfigured()) {
      return sendJSON(res, {
        error: 'Encryption not configured. Please set CERT_ENCRYPTION_KEY in .env file'
      }, 500);
    }

    // Build update query
    const updates = [];
    const params = [];

    if (name) {
      // Check for duplicate name
      const duplicate = db.prepare(
        'SELECT id FROM credentials WHERE name = ? AND id != ? AND credential_type = ?'
      ).get(name, id, 'dns');

      if (duplicate) {
        return sendJSON(res, { error: 'Credential with this name already exists' }, 400);
      }

      updates.push('name = ?');
      params.push(name);
    }

    if (credentials) {
      // Validate credentials
      const validation = validateCredentials(existing.provider, credentials);
      if (!validation.valid) {
        return sendJSON(res, {
          error: 'Invalid credentials',
          details: validation.errors
        }, 400);
      }

      // Encrypt credentials
      const encrypted = encryptCredentials(credentials);
      updates.push('credentials_encrypted = ?');
      params.push(encrypted);
    }

    if (updates.length === 0) {
      return sendJSON(res, { error: 'No updates provided' }, 400);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    db.prepare(`
      UPDATE credentials
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params);

    logAudit(req.user.id, 'update', 'dns_credential', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'DNS credential updated successfully' });
  } catch (error) {
    console.error('Update DNS credential error:', error);
    sendJSON(res, { error: error.message || 'Failed to update DNS credential' }, 500);
  }
}

/**
 * Delete DNS credential
 */
function handleDeleteDNSCredential(req, res, parsedUrl) {
  try {
    const id = parseInt(parsedUrl.pathname.split('/').pop());

    // Check if credential exists
    const existing = db.prepare('SELECT * FROM credentials WHERE id = ? AND credential_type = ?').get(id, 'dns');
    if (!existing) {
      return sendJSON(res, { error: 'DNS credential not found' }, 404);
    }

    // Check if credential is in use
    const inUse = db.prepare(`
      SELECT COUNT(*) as count
      FROM ssl_certificates
      WHERE dns_credential_id = ? AND auto_renew = 1
    `).get(id);

    if (inUse.count > 0) {
      return sendJSON(res, {
        error: `Cannot delete credential: in use by ${inUse.count} certificate(s) with auto-renewal enabled`
      }, 400);
    }

    // Delete credential
    db.prepare('DELETE FROM credentials WHERE id = ?').run(id);

    logAudit(req.user.id, 'delete', 'dns_credential', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'DNS credential deleted successfully' });
  } catch (error) {
    console.error('Delete DNS credential error:', error);
    sendJSON(res, { error: error.message || 'Failed to delete DNS credential' }, 500);
  }
}

// ============================================================================
// Certificate Ordering Handlers
// ============================================================================

/**
 * Order a certificate via Certbot
 */
async function handleOrderCertificate(req, res) {
  try {
    const body = await parseBody(req);
    const {
      email,
      domains,
      challengeType,
      dnsCredentialId,
      propagationSeconds,
      autoRenew,
      certName
    } = body;

    // Validate inputs
    if (!email || !domains || !Array.isArray(domains) || domains.length === 0) {
      return sendJSON(res, { error: 'Email and at least one domain are required' }, 400);
    }

    if (!challengeType || !['http-01', 'dns-01'].includes(challengeType)) {
      return sendJSON(res, { error: 'Challenge type must be http-01 or dns-01' }, 400);
    }

    // Check for wildcard domains with HTTP-01
    const hasWildcard = domains.some(d => d.trim().startsWith('*'));
    if (hasWildcard && challengeType === 'http-01') {
      return sendJSON(res, {
        error: 'Wildcard domains require DNS-01 challenge'
      }, 400);
    }

    let result;
    let certbotConfig = { email, domains, challengeType };

    if (challengeType === 'http-01') {
      // Order using HTTP-01 challenge
      result = await orderCertificateHTTP({
        email,
        domains,
        certName
      });
    } else {
      // DNS-01 challenge - need credentials
      if (!dnsCredentialId) {
        return sendJSON(res, {
          error: 'DNS credential is required for DNS-01 challenge'
        }, 400);
      }

      // Get DNS credentials
      const credentialRecord = db.prepare(
        'SELECT * FROM credentials WHERE id = ? AND credential_type = ?'
      ).get(dnsCredentialId, 'dns');

      if (!credentialRecord) {
        return sendJSON(res, { error: 'DNS credential not found' }, 404);
      }

      // Decrypt credentials
      const credentials = decryptCredentials(credentialRecord.credentials_encrypted);

      // Order using DNS-01 challenge
      result = await orderCertificateDNS({
        email,
        domains,
        providerId: credentialRecord.provider,
        credentials,
        propagationSeconds: propagationSeconds || 10,
        certName
      });

      certbotConfig.dnsCredentialId = dnsCredentialId;
      certbotConfig.provider = credentialRecord.provider;
      certbotConfig.propagationSeconds = propagationSeconds || 10;
    }

    if (!result.success) {
      return sendJSON(res, {
        error: 'Certificate ordering failed',
        details: result.error,
        output: result.output
      }, 500);
    }

    // Read certificate files
    const certFiles = await require('../utils/certbot').readCertificateFiles(
      certName || domains[0]
    );

    // Parse certificate to extract metadata (same as uploaded certificates)
    const certInfo = parseCertificate(certFiles.cert);

    // Extract domain names and issuer (same format as uploaded certificates)
    const domainNames = certInfo.domains && certInfo.domains.length > 0
      ? certInfo.domains.join(', ')
      : domains.join(', ');
    const issuer = certInfo.issuer.organizationName || certInfo.issuer.commonName || 'Let\'s Encrypt';
    const expiresAt = certInfo.notAfter ? certInfo.notAfter.toISOString() : null;

    // Use the certificate name or first domain as the filename
    const certFileName = certInfo.subject.commonName || certInfo.domains[0] || domains[0];
    const savedPaths = saveCertificateFiles(
      certFiles.fullchain,  // Use fullchain (includes intermediate certs)
      certFiles.privkey,
      certFileName
    );

    // Insert certificate into database (same as uploaded certificates)
    const certResult = db.prepare(`
      INSERT INTO ssl_certificates (
        name,
        domain_names,
        issuer,
        expires_at,
        cert_path,
        key_path,
        source,
        auto_renew,
        challenge_type,
        dns_credential_id,
        certbot_config
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      certFileName,
      domainNames,
      issuer,
      expiresAt,
      savedPaths.certPath,
      savedPaths.keyPath,
      'certbot',
      autoRenew ? 1 : 0,
      challengeType,
      dnsCredentialId || null,
      JSON.stringify(certbotConfig)
    );

    logAudit(req.user.id, 'order_certificate', 'ssl_certificate', certResult.lastInsertRowid, null, getClientIP(req));

    sendJSON(res, {
      success: true,
      message: 'Certificate ordered successfully',
      certificate: {
        id: certResult.lastInsertRowid,
        name: certInfo.subject.CN,
        domain: domains[0],
        expires_at: certInfo.validTo,
        source: 'certbot',
        auto_renew: autoRenew ? 1 : 0
      },
      output: result.output
    }, 201);
  } catch (error) {
    console.error('Order certificate error:', error);
    sendJSON(res, { error: error.message || 'Failed to order certificate' }, 500);
  }
}

/**
 * Get Certbot installation status
 */
async function handleGetCertbotStatus(req, res) {
  try {
    const certbotStatus = await checkCertbotInstallation();
    const encryptionConfigured = isEncryptionConfigured();
    const instructions = getInstallationInstructions();

    // Check DNS provider plugins
    const providers = getProviders();
    const pluginStatus = await Promise.all(
      providers.map(async (provider) => ({
        id: provider.id,
        name: provider.name,
        plugin: provider.plugin,
        installed: await isProviderInstalled(provider.id),
        installCommand: provider.installCommand
      }))
    );

    sendJSON(res, {
      certbot: certbotStatus,
      encryption: {
        configured: encryptionConfigured,
        warning: !encryptionConfigured ? 'CERT_ENCRYPTION_KEY not set in .env' : null
      },
      dnsProviders: pluginStatus,
      instructions
    });
  } catch (error) {
    console.error('Get certbot status error:', error);
    sendJSON(res, { error: error.message || 'Failed to get certbot status' }, 500);
  }
}

// ============================================================================
// WAF ENDPOINT HANDLERS
// ============================================================================

// Global SSE clients map for real-time event streaming
const sseClients = new Map();

/**
 * Get all WAF profiles
 */
function handleGetWAFProfiles(req, res) {
  try {
    const profiles = db.prepare(`
      SELECT
        p.*,
        COUNT(DISTINCT ph.id) as proxy_count
      FROM waf_profiles p
      LEFT JOIN proxy_hosts ph ON p.id = ph.waf_profile_id
      GROUP BY p.id
      ORDER BY p.name
    `).all();

    sendJSON(res, { profiles });
  } catch (error) {
    console.error('Get WAF profiles error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Create new WAF profile
 */
async function handleCreateWAFProfile(req, res) {
  try {
    const body = await parseBody(req);
    const { name, description, ruleset, paranoia_level, config_json } = body;

    console.log('Creating WAF profile:', { name, ruleset, paranoia_level });
    console.log('Config JSON:', JSON.stringify(config_json, null, 2));

    // Validation
    if (!name || !ruleset || paranoia_level < 1 || paranoia_level > 4) {
      return sendJSON(res, { error: 'Invalid profile data' }, 400);
    }

    const result = db.prepare(`
      INSERT INTO waf_profiles (name, description, ruleset, paranoia_level, config_json, enabled)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(name, description || '', ruleset, paranoia_level, JSON.stringify(config_json || {}));

    // Regenerate profile config and create empty exclusion file
    try {
      const { generateProfileConfig, generateExclusionConfig, getProfileExclusions } = require('../utils/modsecurity-config-generator');
      const fs = require('fs');
      const path = require('path');

      // Get the newly created profile
      const newProfile = db.prepare('SELECT * FROM waf_profiles WHERE id = ?').get(result.lastInsertRowid);

      // Generate profile config
      const profileConfig = generateProfileConfig(newProfile);
      const profilesDir = path.join(__dirname, '../../data/modsec-profiles');

      // Ensure directory exists
      if (!fs.existsSync(profilesDir)) {
        fs.mkdirSync(profilesDir, { recursive: true });
      }

      // Write profile config
      const profilePath = path.join(profilesDir, `profile_${newProfile.id}.conf`);
      fs.writeFileSync(profilePath, profileConfig, 'utf8');
      console.log(`Generated WAF profile config: ${profilePath}`);

      // Create empty exclusion file
      const exclusions = getProfileExclusions(db, newProfile.id);
      const exclusionPath = path.join(profilesDir, `exclusions_profile_${newProfile.id}.conf`);
      generateExclusionConfig(exclusions, exclusionPath);
      console.log(`Generated WAF exclusion file: ${exclusionPath}`);
    } catch (err) {
      console.error('Failed to generate WAF profile config:', err);
    }

    logAudit(req.user.id, 'create_waf_profile', 'waf_profile', result.lastInsertRowid,
             null, getClientIP(req));

    sendJSON(res, {
      success: true,
      profile: { id: result.lastInsertRowid, name }
    }, 201);
  } catch (error) {
    console.error('Create WAF profile error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Update WAF profile
 */
async function handleUpdateWAFProfile(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];
    const body = await parseBody(req);

    console.log(`Updating WAF profile ${id}:`, { name: body.name, ruleset: body.ruleset, paranoia_level: body.paranoia_level });
    console.log('Config JSON:', JSON.stringify(body.config_json, null, 2));

    db.prepare(`
      UPDATE waf_profiles
      SET name = ?, description = ?, ruleset = ?,
          paranoia_level = ?, config_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(body.name, body.description || '', body.ruleset,
           body.paranoia_level, JSON.stringify(body.config_json || {}), id);

    // Regenerate profile config and exclusion file
    try {
      const { generateProfileConfig, generateExclusionConfig, getProfileExclusions } = require('../utils/modsecurity-config-generator');
      const fs = require('fs');
      const path = require('path');

      // Get the updated profile
      const updatedProfile = db.prepare('SELECT * FROM waf_profiles WHERE id = ?').get(id);

      // Generate profile config
      const profileConfig = generateProfileConfig(updatedProfile);
      const profilesDir = path.join(__dirname, '../../data/modsec-profiles');

      // Ensure directory exists
      if (!fs.existsSync(profilesDir)) {
        fs.mkdirSync(profilesDir, { recursive: true });
      }

      // Write profile config
      const profilePath = path.join(profilesDir, `profile_${updatedProfile.id}.conf`);
      fs.writeFileSync(profilePath, profileConfig, 'utf8');
      console.log(`Updated WAF profile config: ${profilePath}`);

      // Ensure exclusion file exists
      const exclusions = getProfileExclusions(db, updatedProfile.id);
      const exclusionPath = path.join(profilesDir, `exclusions_profile_${updatedProfile.id}.conf`);
      generateExclusionConfig(exclusions, exclusionPath);
      console.log(`Updated WAF exclusion file: ${exclusionPath}`);

      // Reload nginx to apply changes
      await reloadManager.queueReload();
    } catch (err) {
      console.error('Failed to update WAF profile config:', err);
    }

    logAudit(req.user.id, 'update_waf_profile', 'waf_profile', id, null, getClientIP(req));
    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Update WAF profile error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Delete WAF profile
 */
function handleDeleteWAFProfile(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    // Check if profile is in use (single profile model)
    const inUse = db.prepare('SELECT COUNT(*) as count FROM proxy_hosts WHERE waf_profile_id = ?')
                    .get(id);

    if (inUse.count > 0) {
      return sendJSON(res, {
        error: `Profile is assigned to ${inUse.count} proxy(s). Remove assignments first.`
      }, 400);
    }

    db.prepare('DELETE FROM waf_profiles WHERE id = ?').run(id);

    logAudit(req.user.id, 'delete_waf_profile', 'waf_profile', id, null, getClientIP(req));
    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Delete WAF profile error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get WAF profile config file content
 */
function handleGetWAFProfileConfig(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];
    const fs = require('fs');
    const path = require('path');

    // Check if profile exists
    const profile = db.prepare('SELECT * FROM waf_profiles WHERE id = ?').get(id);
    if (!profile) {
      return sendJSON(res, { error: 'Profile not found' }, 404);
    }

    // Read the profile config file
    const profilePath = path.join(__dirname, '../../data/modsec-profiles', `profile_${id}.conf`);

    if (!fs.existsSync(profilePath)) {
      return sendJSON(res, {
        error: 'Profile config file not found',
        message: 'The configuration file has not been generated yet. Try editing and saving the profile.'
      }, 404);
    }

    const configContent = fs.readFileSync(profilePath, 'utf8');

    sendJSON(res, {
      profile_id: id,
      profile_name: profile.name,
      config_path: profilePath,
      config_content: configContent
    });
  } catch (error) {
    console.error('Get WAF profile config error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get WAF events with filtering
 */
function handleGetWAFEvents(req, res, parsedUrl) {
  try {
    const params = parsedUrl.searchParams;
    const limit = parseInt(params.get('limit') || '100');
    const offset = parseInt(params.get('offset') || '0');
    const proxyId = params.get('proxy_id');
    const severity = params.get('severity');
    const attackType = params.get('attack_type');
    const clientIp = params.get('client_ip');
    const startDate = params.get('start_date');
    const endDate = params.get('end_date');
    const blocked = params.get('blocked');

    let query = `
      SELECT
        e.*,
        p.name as proxy_name,
        p.domain_names,
        json_extract(e.raw_log, '$.transaction.response.http_code') as http_status
      FROM waf_events e
      LEFT JOIN proxy_hosts p ON e.proxy_id = p.id
      WHERE 1=1
    `;
    const queryParams = [];

    if (proxyId) {
      query += ' AND e.proxy_id = ?';
      queryParams.push(proxyId);
    }
    if (severity) {
      query += ' AND e.severity = ?';
      queryParams.push(severity);
    }
    if (attackType) {
      query += ' AND LOWER(e.attack_type) = LOWER(?)';
      queryParams.push(attackType);
    }
    if (clientIp) {
      query += ' AND e.client_ip = ?';
      queryParams.push(clientIp);
    }
    if (startDate) {
      query += ' AND e.timestamp >= ?';
      queryParams.push(startDate);
    }
    if (endDate) {
      query += ' AND e.timestamp <= ?';
      queryParams.push(endDate);
    }
    if (blocked !== null && blocked !== undefined && blocked !== '') {
      query += ' AND e.blocked = ?';
      // Convert string "true"/"false" to 1/0
      const blockedValue = blocked === 'true' || blocked === true ? 1 : 0;
      queryParams.push(blockedValue);
    }

    query += ' ORDER BY e.timestamp DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    // Use WAF database (main database is attached as 'maindb' at startup)
    const wafDb = getWAFDb();

    // Update query to use maindb.proxy_hosts
    query = query.replace('LEFT JOIN proxy_hosts p', 'LEFT JOIN maindb.proxy_hosts p');

    const events = wafDb.prepare(query).all(...queryParams);

    // Get total count for pagination (use same params except limit/offset)
    let countQuery = 'SELECT COUNT(*) as total FROM waf_events e WHERE 1=1';
    const countParams = [];

    if (proxyId) {
      countQuery += ' AND e.proxy_id = ?';
      countParams.push(proxyId);
    }
    if (severity) {
      countQuery += ' AND e.severity = ?';
      countParams.push(severity);
    }
    if (attackType) {
      countQuery += ' AND LOWER(e.attack_type) = LOWER(?)';
      countParams.push(attackType);
    }
    if (clientIp) {
      countQuery += ' AND e.client_ip = ?';
      countParams.push(clientIp);
    }
    if (startDate) {
      countQuery += ' AND e.timestamp >= ?';
      countParams.push(startDate);
    }
    if (endDate) {
      countQuery += ' AND e.timestamp <= ?';
      countParams.push(endDate);
    }
    if (blocked !== null && blocked !== undefined && blocked !== '') {
      countQuery += ' AND e.blocked = ?';
      const blockedValue = blocked === 'true' || blocked === true ? 1 : 0;
      countParams.push(blockedValue);
    }

    const total = wafDb.prepare(countQuery).get(...countParams).total;

    sendJSON(res, { events, total, limit, offset });
  } catch (error) {
    console.error('Get WAF events error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get WAF statistics
 */
function handleGetWAFStats(req, res, parsedUrl) {
  try {
    const params = parsedUrl.searchParams;
    const hours = parseInt(params.get('hours') || '24');
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const wafDb = getWAFDb();

    // Total events
    const totalEvents = wafDb.prepare(`
      SELECT COUNT(*) as count FROM waf_events
      WHERE timestamp >= ?
    `).get(cutoffTime).count;

    // Blocked attacks
    const blockedAttacks = wafDb.prepare(`
      SELECT COUNT(*) as count FROM waf_events
      WHERE timestamp >= ? AND blocked = 1
    `).get(cutoffTime).count;

    // Active profiles (single profile model) - from main DB
    const activeProfiles = db.prepare(`
      SELECT COUNT(DISTINCT waf_profile_id) as count FROM proxy_hosts WHERE waf_profile_id IS NOT NULL
    `).get().count;

    // Events by attack type
    const eventsByType = wafDb.prepare(`
      SELECT attack_type, COUNT(*) as count
      FROM waf_events
      WHERE timestamp >= ?
      GROUP BY attack_type
      ORDER BY count DESC
      LIMIT 10
    `).all(cutoffTime);

    // Top attacking IPs
    const topIPs = wafDb.prepare(`
      SELECT client_ip, COUNT(*) as count
      FROM waf_events
      WHERE timestamp >= ?
      GROUP BY client_ip
      ORDER BY count DESC
      LIMIT 10
    `).all(cutoffTime);

    // Events over time (hourly buckets)
    const timeline = wafDb.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00:00', timestamp) as hour,
        COUNT(*) as count,
        SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blocked_count
      FROM waf_events
      WHERE timestamp >= ?
      GROUP BY hour
      ORDER BY hour
    `).all(cutoffTime);

    // Events by severity
    const bySeverity = wafDb.prepare(`
      SELECT severity, COUNT(*) as count
      FROM waf_events
      WHERE timestamp >= ?
      GROUP BY severity
    `).all(cutoffTime);

    sendJSON(res, {
      total_events: totalEvents,
      totalEvents: totalEvents, // camelCase for frontend
      blocked_attacks: blockedAttacks,
      blockedEvents: blockedAttacks, // camelCase for frontend
      active_profiles: activeProfiles,
      profileCount: activeProfiles, // camelCase for frontend
      enabled: activeProfiles > 0, // WAF is enabled if any profiles are active
      by_type: eventsByType,
      top_ips: topIPs,
      timeline,
      by_severity: bySeverity
    });
  } catch (error) {
    console.error('Get WAF stats error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * SSE endpoint for real-time WAF event streaming
 */
function handleWAFEventsStream(req, res, parsedUrl) {
  // Verify authentication - check both Authorization header and query parameter
  // EventSource doesn't support custom headers, so we accept token via query param
  const authHeader = req.headers.authorization;
  let token = extractToken(authHeader);

  // If no token in header, check query parameter
  if (!token) {
    token = parsedUrl.searchParams.get('token');
  }

  console.log('[SSE] Token received:', token ? 'Yes (length: ' + token.length + ')' : 'No');

  const user = verifyToken(token);

  console.log('[SSE] User verified:', user ? 'Yes (user: ' + user.username + ')' : 'No');

  if (!user) {
    console.log('[SSE] Authentication failed - sending 401');
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Unauthorized');
    return;
  }

  // Setup SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable nginx buffering
  });

  // Send initial connection message
  res.write('data: {"type":"connected"}\n\n');

  // Generate unique client ID
  const clientId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Store client
  sseClients.set(clientId, { res, user });

  // Keep-alive ping every 30 seconds
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (error) {
      clearInterval(keepAliveInterval);
      sseClients.delete(clientId);
    }
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(keepAliveInterval);
    sseClients.delete(clientId);
    console.log(`SSE client ${clientId} disconnected`);
  });

  console.log(`SSE client ${clientId} connected`);
}

/**
 * Broadcast WAF event to all SSE clients
 * This is called by the log parser daemon
 */
function broadcastWAFEvent(event) {
  const message = JSON.stringify({
    type: 'waf_event',
    event
  });

  for (const [clientId, client] of sseClients.entries()) {
    try {
      client.res.write(`data: ${message}\n\n`);
    } catch (error) {
      console.error(`Failed to send to SSE client ${clientId}:`, error.message);
      sseClients.delete(clientId);
    }
  }
}

// Make broadcastWAFEvent available to log parser
const { getWAFLogParser } = require('../utils/waf-log-parser');
const wafLogParser = getWAFLogParser();
wafLogParser.setBroadcastFunction(broadcastWAFEvent);

/**
 * Broadcast ban event to all SSE clients for real-time updates
 */
function broadcastBanEvent(eventType, data) {
  const message = JSON.stringify({
    type: 'ban_event',
    eventType, // 'ban_created', 'ban_removed', 'ban_updated'
    data
  });

  for (const [clientId, client] of sseClients.entries()) {
    try {
      client.res.write(`data: ${message}\n\n`);
    } catch (error) {
      console.error(`Failed to send ban event to SSE client ${clientId}:`, error.message);
      sseClients.delete(clientId);
    }
  }
}

/**
 * Helper: Regenerate configs for all proxies using a specific profile
 */
async function regenerateProfileProxyConfigs(profileId) {
  try {
    const { generateServerBlock, writeNginxConfig } = require('../utils/nginx-parser');
    const { getProfileExclusions, generateExclusionConfig } = require('../utils/modsecurity-config-generator');
    const path = require('path');

    // Regenerate the exclusion file for this profile FIRST
    // This ensures the exclusion file is up-to-date before proxy configs reference it
    try {
      const projectRoot = path.join(__dirname, '../..');
      const profilesDir = path.join(projectRoot, 'data/modsec-profiles');
      const exclusionPath = path.join(profilesDir, `exclusions_profile_${profileId}.conf`);

      const exclusions = getProfileExclusions(db, profileId);
      generateExclusionConfig(exclusions, exclusionPath);
      console.log(`✓ Regenerated exclusion file: ${exclusionPath} (${exclusions.length} rules)`);
    } catch (exclusionError) {
      console.error('Failed to regenerate exclusion file:', exclusionError);
      // Continue anyway - proxy configs can still be regenerated
    }

    // Get all proxies using this profile
    const proxies = db.prepare(`
      SELECT * FROM proxy_hosts WHERE waf_profile_id = ?
    `).all(profileId);

    for (const proxy of proxies) {
      // Get modules for this proxy
      const modules = db.prepare(`
        SELECT m.* FROM modules m
        JOIN proxy_modules pm ON m.id = pm.module_id
        WHERE pm.proxy_id = ?
      `).all(proxy.id);

      // Generate full server block config
      let config = generateServerBlock(proxy, modules, db);

      // Replace SSL placeholders if needed
      if (proxy.ssl_enabled && proxy.ssl_cert_id) {
        const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?')
          .get(proxy.ssl_cert_id);
        if (cert) {
          config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
          config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
        }
      }

      // Write the config file
      const filename = proxy.config_filename || `${proxy.id}.conf`;
      writeNginxConfig(filename, config);

      console.log(`✓ Regenerated config for proxy: ${proxy.domain_names}`);
    }

    // Reload nginx to apply changes
    await reloadManager.queueReload();

    console.log(`Regenerated configs for ${proxies.length} proxies using profile ${profileId}`);
  } catch (error) {
    console.error('Failed to regenerate profile proxy configs:', error);
  }
}

/**
 * Get WAF exclusions
 */
function handleGetWAFExclusions(req, res, parsedUrl) {
  try {
    const profileId = parsedUrl.searchParams.get('profile_id');

    let query = `
      SELECT
        e.*,
        p.name as profile_name
      FROM waf_exclusions e
      LEFT JOIN waf_profiles p ON e.profile_id = p.id
    `;

    const params = [];
    if (profileId) {
      query += ' WHERE e.profile_id = ?';
      params.push(profileId);
    }

    query += ' ORDER BY e.created_at DESC';

    const exclusions = db.prepare(query).all(...params);
    sendJSON(res, { exclusions });
  } catch (error) {
    console.error('Get WAF exclusions error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Create WAF exclusion
 */
async function handleCreateWAFExclusion(req, res) {
  try {
    const body = await parseBody(req);
    let { profile_id, proxy_id, rule_id, path_pattern, parameter_name, reason } = body;

    if (!rule_id) {
      return sendJSON(res, { error: 'Rule ID is required' }, 400);
    }

    // Auto-detect profile from proxy if not specified
    if (!profile_id && proxy_id) {
      const proxy = db.prepare('SELECT waf_profile_id FROM proxy_hosts WHERE id = ?').get(proxy_id);
      profile_id = proxy?.waf_profile_id;
    }

    if (!profile_id) {
      return sendJSON(res, { error: 'Profile ID is required (or provide proxy_id to auto-detect)' }, 400);
    }

    const result = db.prepare(`
      INSERT INTO waf_exclusions
      (profile_id, rule_id, path_pattern, parameter_name, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(profile_id, rule_id, path_pattern || null,
           parameter_name || null, reason || null);

    // Regenerate all proxies using this profile
    await regenerateProfileProxyConfigs(profile_id);

    logAudit(req.user.id, 'create_waf_exclusion', 'waf_exclusion',
             result.lastInsertRowid, null, getClientIP(req));

    sendJSON(res, { success: true, id: result.lastInsertRowid }, 201);
  } catch (error) {
    console.error('Create WAF exclusion error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Delete WAF exclusion
 */
async function handleDeleteWAFExclusion(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const exclusion = db.prepare('SELECT profile_id FROM waf_exclusions WHERE id = ?').get(id);

    db.prepare('DELETE FROM waf_exclusions WHERE id = ?').run(id);

    // Regenerate configs for all proxies using this profile
    if (exclusion && exclusion.profile_id) {
      await regenerateProfileProxyConfigs(exclusion.profile_id);
    }

    logAudit(req.user.id, 'delete_waf_exclusion', 'waf_exclusion', id,
             null, getClientIP(req));
    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Delete WAF exclusion error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get WAF profile assigned to a proxy (single profile model)
 */
function handleGetProxyWAFProfiles(req, res, parsedUrl) {
  try {
    const proxyId = parsedUrl.pathname.split('/')[3];

    // Get assigned profile (single)
    const profile = db.prepare(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.paranoia_level,
        p.enabled
      FROM waf_profiles p
      INNER JOIN proxy_hosts ph ON p.id = ph.waf_profile_id
      WHERE ph.id = ?
    `).get(proxyId);

    sendJSON(res, { profile: profile || null });
  } catch (error) {
    console.error('Get proxy WAF profile error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Assign WAF profile to proxy (single profile model - replaces existing)
 */
async function handleAssignWAFProfile(req, res, parsedUrl) {
  try {
    const proxyId = parsedUrl.pathname.split('/')[3];
    const body = await parseBody(req);
    const { profile_id } = body;

    // Validate profile exists
    const profileExists = db.prepare(`
      SELECT id FROM waf_profiles WHERE id = ?
    `).get(profile_id);

    if (!profileExists) {
      return sendJSON(res, { error: 'WAF profile not found' }, 404);
    }

    // Update proxy with the profile (replaces any existing assignment)
    db.prepare(`
      UPDATE proxy_hosts
      SET waf_profile_id = ?
      WHERE id = ?
    `).run(profile_id, proxyId);

    // Regenerate proxy nginx config with WAF
    try {
      const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(proxyId);
      if (proxy) {
        // Fetch modules for this proxy
        const modules = db.prepare(`
          SELECT m.* FROM modules m
          INNER JOIN proxy_modules pm ON m.id = pm.module_id
          WHERE pm.proxy_id = ?
        `).all(proxyId);

        const configFilename = sanitizeFilename(proxy.name) + '.conf';

        let config;
        if (proxy.type === 'stream') {
          config = generateStreamBlock(proxy);
        } else if (proxy.type === '404') {
          config = generate404Block(proxy);
        } else {
          config = generateServerBlock(proxy, modules, db);
        }

        // Replace SSL cert placeholders if needed
        if (proxy.ssl_enabled && proxy.ssl_cert_id) {
          const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?').get(proxy.ssl_cert_id);
          if (cert) {
            config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
            config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
          }
        }

        writeNginxConfig(configFilename, config);

        // Ensure correct file extension based on enabled state
        if (proxy.enabled) {
          enableNginxConfig(configFilename);
        } else {
          disableNginxConfig(configFilename);
        }

        await reloadManager.queueReload();
      }
    } catch (err) {
      console.error('Failed to regenerate proxy config:', err);
    }

    logAudit(req.user.id, 'assign_waf_profile', 'proxy', proxyId,
             `Assigned profile ${profile_id}`, getClientIP(req));

    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Assign WAF profile error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Remove WAF profile from proxy (single profile model)
 */
async function handleRemoveWAFProfile(req, res, parsedUrl) {
  try {
    const proxyId = parsedUrl.pathname.split('/')[3];

    // Clear the waf_profile_id column
    db.prepare(`
      UPDATE proxy_hosts
      SET waf_profile_id = NULL
      WHERE id = ?
    `).run(proxyId);

    // Regenerate proxy config
    try {
      const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(proxyId);
      if (proxy) {
        // Fetch modules for this proxy
        const modules = db.prepare(`
          SELECT m.* FROM modules m
          INNER JOIN proxy_modules pm ON m.id = pm.module_id
          WHERE pm.proxy_id = ?
        `).all(proxyId);

        const configFilename = sanitizeFilename(proxy.name) + '.conf';

        let config;
        if (proxy.type === 'stream') {
          config = generateStreamBlock(proxy);
        } else if (proxy.type === '404') {
          config = generate404Block(proxy);
        } else {
          config = generateServerBlock(proxy, modules, db);
        }

        // Replace SSL cert placeholders if needed
        if (proxy.ssl_enabled && proxy.ssl_cert_id) {
          const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?').get(proxy.ssl_cert_id);
          if (cert) {
            config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
            config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
          }
        }

        writeNginxConfig(configFilename, config);

        // Ensure correct file extension based on enabled state
        if (proxy.enabled) {
          enableNginxConfig(configFilename);
        } else {
          disableNginxConfig(configFilename);
        }

        await reloadManager.queueReload();
      }
    } catch (err) {
      console.error('Failed to regenerate proxy config:', err);
    }

    logAudit(req.user.id, 'remove_waf_profile', 'proxy', proxyId,
             'Removed WAF profile', getClientIP(req));

    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Remove WAF profile error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Get notification settings
 */
function handleGetNotificationSettings(req, res) {
  try {
    const settings = {
      enabled: getSetting('notifications_enabled') === '1',
      apprise_urls: JSON.parse(getSetting('notification_apprise_urls') || '[]'),
      triggers: {
        waf_blocks: getSetting('notification_waf_blocks') === '1',
        waf_high_severity: getSetting('notification_waf_high_severity') === '1',
        waf_threshold: parseInt(getSetting('notification_waf_threshold') || '10'),
        waf_threshold_minutes: parseInt(getSetting('notification_waf_threshold_minutes') || '5'),
        system_errors: getSetting('notification_system_errors') === '1',
        proxy_changes: getSetting('notification_proxy_changes') === '1',
        cert_expiry: getSetting('notification_cert_expiry') === '1',
        cert_expiry_days: parseInt(getSetting('notification_cert_expiry_days') || '7'),
        ban_issued: getSetting('notification_ban_issued') === '1',
        ban_cleared: getSetting('notification_ban_cleared') === '1'
      }
    };

    sendJSON(res, settings);
  } catch (error) {
    console.error('Get notification settings error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Update notification settings
 */
async function handleUpdateNotificationSettings(req, res) {
  try {
    const body = await parseBody(req);

    setSetting('notifications_enabled', body.enabled ? '1' : '0');
    setSetting('notification_apprise_urls', JSON.stringify(body.apprise_urls || []));

    if (body.triggers) {
      setSetting('notification_waf_blocks', body.triggers.waf_blocks ? '1' : '0');
      setSetting('notification_waf_high_severity', body.triggers.waf_high_severity ? '1' : '0');
      setSetting('notification_waf_threshold', String(body.triggers.waf_threshold || 10));
      setSetting('notification_waf_threshold_minutes', String(body.triggers.waf_threshold_minutes || 5));
      setSetting('notification_system_errors', body.triggers.system_errors ? '1' : '0');
      setSetting('notification_proxy_changes', body.triggers.proxy_changes ? '1' : '0');
      setSetting('notification_cert_expiry', body.triggers.cert_expiry ? '1' : '0');
      setSetting('notification_cert_expiry_days', String(body.triggers.cert_expiry_days || 7));
      setSetting('notification_ban_issued', body.triggers.ban_issued ? '1' : '0');
      setSetting('notification_ban_cleared', body.triggers.ban_cleared ? '1' : '0');
    }

    logAudit(req.user.id, 'update_notification_settings', 'settings', null,
             null, getClientIP(req));

    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Update notification settings error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Test notification
 */
async function handleTestNotification(req, res) {
  try {
    const { sendTestNotification } = require('../utils/notification-service');
    const result = await sendTestNotification();

    if (result.success) {
      sendJSON(res, { success: true, message: 'Test notification sent' });
    } else {
      // Check both 'reason' and 'error' properties for consistent error handling
      const errorMessage = result.reason || result.error || 'Unknown error';
      sendJSON(res, {
        success: false,
        error: `Failed to send: ${errorMessage}`
      }, 400);
    }
  } catch (error) {
    console.error('Test notification error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

// ============================================================================
// END WAF ENDPOINT HANDLERS
// ============================================================================

// ============================================================================
// BAN SYSTEM HANDLERS
// ============================================================================

const {
  banIP,
  unbanIP,
  makeBanPermanent: makeBanPermanentService,
  getBanDetails,
  getActiveBans,
  getBanStatistics
} = require('../utils/ban-service');

const { getProviderInfo } = require('../utils/ban-providers');
const { getBanQueue } = require('../utils/ban-queue');
const { getDetectionStats, getTrackedIPs } = require('../utils/detection-engine');

// ============================================================================
// Ban Integrations Handlers
// ============================================================================

// ============================================================================
// Credentials Management Handlers
// ============================================================================

function handleGetCredentials(req, res, parsedUrl) {
  try {
    const type = parsedUrl.searchParams.get('type');

    let query = 'SELECT id, name, credential_type, provider, created_at, updated_at FROM credentials';
    const params = [];

    if (type) {
      query += ' WHERE credential_type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC';

    const credentials = db.prepare(query).all(...params);

    sendJSON(res, { credentials });
  } catch (error) {
    console.error('Get credentials error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleCreateCredential(req, res) {
  try {
    const body = await parseBody(req);
    const { name, credential_type, provider, credentials } = body;

    if (!name || !credential_type || !credentials) {
      return sendJSON(res, { error: 'Name, credential_type, and credentials are required' }, 400);
    }

    // Encrypt credentials
    const encryptedData = encryptCredentials(credentials);

    const result = db.prepare(`
      INSERT INTO credentials (name, credential_type, provider, credentials_encrypted)
      VALUES (?, ?, ?, ?)
    `).run(name, credential_type, provider || null, encryptedData);

    logAudit(req.user.id, 'create_credential', 'credential', result.lastInsertRowid, null, getClientIP(req));

    sendJSON(res, { success: true, id: result.lastInsertRowid }, 201);
  } catch (error) {
    console.error('Create credential error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleUpdateCredential(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[3];
    const body = await parseBody(req);
    const { name, credential_type, provider, credentials } = body;

    if (!name || !credential_type) {
      return sendJSON(res, { error: 'Name and credential_type are required' }, 400);
    }

    // If credentials provided, encrypt them
    let updateFields = ['name = ?', 'credential_type = ?', 'provider = ?', 'updated_at = CURRENT_TIMESTAMP'];
    let params = [name, credential_type, provider || null];

    if (credentials) {
      const encryptedData = encryptCredentials(credentials);
      updateFields.push('credentials_encrypted = ?');
      params.push(encryptedData);
    }

    params.push(id);

    db.prepare(`
      UPDATE credentials
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `).run(...params);

    logAudit(req.user.id, 'update_credential', 'credential', id, null, getClientIP(req));

    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Update credential error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

function handleDeleteCredential(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[3];

    // Check if credential is in use
    const inUse = db.prepare(`
      SELECT COUNT(*) as count FROM ban_integrations WHERE credential_id = ?
    `).get(id);

    if (inUse && inUse.count > 0) {
      return sendJSON(res, { error: 'Cannot delete credential that is in use by integrations' }, 400);
    }

    db.prepare('DELETE FROM credentials WHERE id = ?').run(id);

    logAudit(req.user.id, 'delete_credential', 'credential', id, null, getClientIP(req));

    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Delete credential error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

// ============================================================================
// Ban System Handlers
// ============================================================================

function handleGetBanIntegrations(req, res) {
  try {
    const integrations = db.prepare(`
      SELECT
        i.*,
        c.name as credential_name,
        c.credential_type,
        (SELECT COUNT(*) FROM ip_bans WHERE integrations_notified LIKE '%"id":' || i.id || '%') as bans_sent
      FROM ban_integrations i
      LEFT JOIN credentials c ON i.credential_id = c.id
      ORDER BY i.created_at DESC
    `).all();

    // Get provider info for each integration
    const integrationsWithInfo = integrations.map(integration => {
      const info = getProviderInfo(integration.type);
      return {
        ...integration,
        provider_info: info,
        config: JSON.parse(integration.config_json || '{}')
      };
    });

    sendJSON(res, { integrations: integrationsWithInfo });
  } catch (error) {
    console.error('Get ban integrations error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleCreateBanIntegration(req, res) {
  try {
    const body = await parseBody(req);
    const { name, type, credential_id, config_json, enabled } = body;

    if (!name || !type) {
      return sendJSON(res, { error: 'Name and type are required' }, 400);
    }

    // Validate provider type
    const providerInfo = getProviderInfo(type);
    if (!providerInfo) {
      return sendJSON(res, { error: `Unknown provider type: ${type}` }, 400);
    }

    const result = db.prepare(`
      INSERT INTO ban_integrations (name, type, credential_id, config_json, enabled)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, type, credential_id || null, config_json || '{}', enabled ? 1 : 0);

    logAudit(req.user.userId, 'create_ban_integration', 'ban_integration', result.lastInsertRowid, null, getClientIP(req));

    sendJSON(res, {
      success: true,
      id: result.lastInsertRowid,
      message: 'Ban integration created successfully'
    }, 201);
  } catch (error) {
    console.error('Create ban integration error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleUpdateBanIntegration(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];
    const body = await parseBody(req);
    const { name, credential_id, config_json, enabled } = body;

    const existing = db.prepare('SELECT * FROM ban_integrations WHERE id = ?').get(id);
    if (!existing) {
      return sendJSON(res, { error: 'Integration not found' }, 404);
    }

    db.prepare(`
      UPDATE ban_integrations
      SET name = ?, credential_id = ?, config_json = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name || existing.name,
      credential_id !== undefined ? credential_id : existing.credential_id,
      config_json || existing.config_json,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      id
    );

    logAudit(req.user.userId, 'update_ban_integration', 'ban_integration', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'Integration updated successfully' });
  } catch (error) {
    console.error('Update ban integration error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

function handleDeleteBanIntegration(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const existing = db.prepare('SELECT * FROM ban_integrations WHERE id = ?').get(id);
    if (!existing) {
      return sendJSON(res, { error: 'Integration not found' }, 404);
    }

    db.prepare('DELETE FROM ban_integrations WHERE id = ?').run(id);

    logAudit(req.user.userId, 'delete_ban_integration', 'ban_integration', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'Integration deleted successfully' });
  } catch (error) {
    console.error('Delete ban integration error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleTestBanIntegration(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const integration = db.prepare('SELECT * FROM ban_integrations WHERE id = ?').get(id);
    if (!integration) {
      return sendJSON(res, { error: 'Integration not found' }, 404);
    }

    // Test connection using provider
    const { getProvider } = require('../utils/ban-providers');

    try {
      const provider = getProvider(integration);
      const testResult = await provider.testConnection();

      sendJSON(res, {
        success: testResult.success,
        message: testResult.message
      });
    } catch (error) {
      sendJSON(res, {
        success: false,
        message: error.message
      }, 400);
    }
  } catch (error) {
    console.error('Test ban integration error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

// ============================================================================
// IP Bans Handlers
// ============================================================================

function handleGetBans(req, res, parsedUrl) {
  try {
    const limit = parseInt(parsedUrl.searchParams.get('limit')) || 100;
    const bans = getActiveBans(limit);

    sendJSON(res, { bans });
  } catch (error) {
    console.error('Get bans error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleCreateBan(req, res) {
  try {
    const body = await parseBody(req);
    const { ip_address, reason, duration, severity } = body;

    if (!ip_address) {
      return sendJSON(res, { error: 'IP address is required' }, 400);
    }

    if (!reason) {
      return sendJSON(res, { error: 'Reason is required' }, 400);
    }

    const result = await banIP(ip_address, {
      reason,
      severity: severity || 'MEDIUM',
      ban_duration: duration || null,  // null = permanent
      auto_banned: false,
      banned_by: req.user.userId
    });

    if (!result.success) {
      return sendJSON(res, { error: result.message }, 400);
    }

    logAudit(req.user.userId, 'manual_ban', 'ip_ban', result.ban_id, JSON.stringify({ ip_address, reason }), getClientIP(req));

    // Broadcast ban event for real-time updates
    broadcastBanEvent('ban_created', {
      ip_address,
      reason,
      severity: severity || 'MEDIUM',
      ban_id: result.ban_id
    });

    sendJSON(res, {
      success: true,
      ban_id: result.ban_id,
      message: result.message,
      integrations_queued: result.integrations_queued
    }, 201);
  } catch (error) {
    console.error('Create ban error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleUnban(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const ban = db.prepare('SELECT ip_address FROM ip_bans WHERE id = ?').get(id);
    if (!ban) {
      return sendJSON(res, { error: 'Ban not found' }, 404);
    }

    const result = await unbanIP(ban.ip_address, req.user.userId);

    if (!result.success) {
      return sendJSON(res, { error: result.message }, 400);
    }

    logAudit(req.user.userId, 'manual_unban', 'ip_ban', id, JSON.stringify({ ip_address: ban.ip_address }), getClientIP(req));

    // Broadcast ban event for real-time updates
    broadcastBanEvent('ban_removed', {
      ip_address: ban.ip_address,
      ban_id: id
    });

    sendJSON(res, {
      success: true,
      message: result.message,
      integrations_queued: result.integrations_queued || 0
    });
  } catch (error) {
    console.error('Unban error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleMakeBanPermanent(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const ban = db.prepare('SELECT ip_address FROM ip_bans WHERE id = ?').get(id);
    if (!ban) {
      return sendJSON(res, { error: 'Ban not found' }, 404);
    }

    const result = await makeBanPermanentService(ban.ip_address);

    if (!result.success) {
      return sendJSON(res, { error: result.message }, 400);
    }

    logAudit(req.user.userId, 'make_ban_permanent', 'ip_ban', id, JSON.stringify({ ip_address: ban.ip_address }), getClientIP(req));

    // Broadcast ban event for real-time updates
    broadcastBanEvent('ban_updated', {
      ip_address: ban.ip_address,
      ban_id: id,
      permanent: true
    });

    sendJSON(res, { success: true, message: result.message });
  } catch (error) {
    console.error('Make ban permanent error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

function handleGetBanStats(req, res) {
  try {
    const stats = getBanStatistics();
    const detectionStats = getDetectionStats();
    const trackedIPs = getTrackedIPs(20);  // Top 20 tracked IPs

    sendJSON(res, {
      ...stats,
      detection: detectionStats,
      tracked_ips: trackedIPs
    });
  } catch (error) {
    console.error('Get ban stats error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleSyncAllBans(req, res) {
  try {
    const { getBanSyncService } = require('../utils/ban-sync-service');
    const syncService = getBanSyncService();

    console.log(`Manual ban sync triggered by user ${req.user.userId}`);

    // Trigger full sync
    await syncService.syncAllBans();

    logAudit(req.user.userId, 'sync_all_bans', 'ban_system', null, null, getClientIP(req));

    sendJSON(res, {
      success: true,
      message: 'Ban synchronization completed successfully'
    });
  } catch (error) {
    console.error('Sync all bans error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleSyncSingleIP(req, res, parsedUrl) {
  try {
    const ip = decodeURIComponent(parsedUrl.pathname.split('/')[5]);

    if (!ip) {
      return sendJSON(res, { error: 'IP address is required' }, 400);
    }

    const { getBanSyncService } = require('../utils/ban-sync-service');
    const syncService = getBanSyncService();

    console.log(`Manual sync for IP ${ip} triggered by user ${req.user.userId}`);

    const result = await syncService.syncIP(ip);

    logAudit(req.user.userId, 'sync_single_ip', 'ban_system', null, JSON.stringify({ ip }), getClientIP(req));

    sendJSON(res, result);
  } catch (error) {
    console.error('Sync single IP error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

function handleGetSyncStatus(req, res) {
  try {
    const { getBanSyncService } = require('../utils/ban-sync-service');
    const syncService = getBanSyncService();

    const status = syncService.getStatus();

    sendJSON(res, status);
  } catch (error) {
    console.error('Get sync status error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

// ============================================================================
// IP Whitelist Handlers
// ============================================================================

function handleGetWhitelist(req, res) {
  try {
    const whitelist = db.prepare(`
      SELECT
        w.*,
        u.username as added_by_username
      FROM ip_whitelist w
      LEFT JOIN users u ON w.added_by = u.id
      ORDER BY w.priority ASC, w.created_at DESC
    `).all();

    sendJSON(res, { whitelist });
  } catch (error) {
    console.error('Get whitelist error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleAddToWhitelist(req, res) {
  try {
    const body = await parseBody(req);
    const { ip_address, ip_range, reason, priority } = body;

    if (!ip_address && !ip_range) {
      return sendJSON(res, { error: 'IP address or IP range is required' }, 400);
    }

    // Check if already whitelisted
    const existing = db.prepare(
      'SELECT id FROM ip_whitelist WHERE ip_address = ? OR ip_range = ?'
    ).get(ip_address || null, ip_range || null);

    if (existing) {
      return sendJSON(res, { error: 'IP or range is already whitelisted' }, 400);
    }

    const result = db.prepare(`
      INSERT INTO ip_whitelist (ip_address, ip_range, type, reason, priority, added_by)
      VALUES (?, ?, 'manual', ?, ?, ?)
    `).run(
      ip_address || null,
      ip_range || null,
      reason || 'Manual whitelist',
      priority || 50,
      req.user.userId
    );

    logAudit(req.user.userId, 'add_to_whitelist', 'ip_whitelist', result.lastInsertRowid,
      JSON.stringify({ ip_address, ip_range, reason }), getClientIP(req));

    sendJSON(res, {
      success: true,
      id: result.lastInsertRowid,
      message: 'IP added to whitelist successfully'
    }, 201);
  } catch (error) {
    console.error('Add to whitelist error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

function handleRemoveFromWhitelist(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const entry = db.prepare('SELECT type FROM ip_whitelist WHERE id = ?').get(id);
    if (!entry) {
      return sendJSON(res, { error: 'Whitelist entry not found' }, 404);
    }

    if (entry.type === 'system') {
      return sendJSON(res, { error: 'Cannot remove system whitelist entries' }, 403);
    }

    db.prepare('DELETE FROM ip_whitelist WHERE id = ?').run(id);

    logAudit(req.user.userId, 'remove_from_whitelist', 'ip_whitelist', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'IP removed from whitelist successfully' });
  } catch (error) {
    console.error('Remove from whitelist error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

// ============================================================================
// Detection Rules Handlers
// ============================================================================

function handleGetDetectionRules(req, res) {
  try {
    const rules = db.prepare(`
      SELECT
        r.*,
        (SELECT COUNT(*) FROM ip_bans WHERE detection_rule_id = r.id) as total_bans
      FROM ips_detection_rules r
      ORDER BY r.priority ASC, r.created_at DESC
    `).all();

    // Parse JSON fields
    const rulesWithParsed = rules.map(rule => ({
      ...rule,
      attack_types: rule.attack_types ? JSON.parse(rule.attack_types) : null
    }));

    sendJSON(res, { rules: rulesWithParsed });
  } catch (error) {
    console.error('Get detection rules error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleCreateDetectionRule(req, res) {
  try {
    const body = await parseBody(req);
    const {
      name, threshold, time_window, attack_types, severity_filter,
      proxy_id, ban_duration, ban_severity, priority, enabled
    } = body;

    if (!name || !threshold || !time_window) {
      return sendJSON(res, { error: 'Name, threshold, and time_window are required' }, 400);
    }

    const result = db.prepare(`
      INSERT INTO ips_detection_rules (
        name, threshold, time_window, attack_types, severity_filter,
        proxy_id, ban_duration, ban_severity, priority, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, threshold, time_window,
      attack_types ? JSON.stringify(attack_types) : null,
      severity_filter || 'ALL',
      proxy_id || null,
      ban_duration || 3600,
      ban_severity || 'MEDIUM',
      priority || 100,
      enabled !== undefined ? (enabled ? 1 : 0) : 1
    );

    logAudit(req.user.userId, 'create_detection_rule', 'detection_rule', result.lastInsertRowid,
      JSON.stringify({ name, threshold, time_window }), getClientIP(req));

    sendJSON(res, {
      success: true,
      id: result.lastInsertRowid,
      message: 'Detection rule created successfully'
    }, 201);
  } catch (error) {
    console.error('Create detection rule error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleUpdateDetectionRule(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];
    const body = await parseBody(req);

    const existing = db.prepare('SELECT * FROM ips_detection_rules WHERE id = ?').get(id);
    if (!existing) {
      return sendJSON(res, { error: 'Detection rule not found' }, 404);
    }

    const {
      name, threshold, time_window, attack_types, severity_filter,
      proxy_id, ban_duration, ban_severity, priority, enabled
    } = body;

    db.prepare(`
      UPDATE ips_detection_rules
      SET name = ?, threshold = ?, time_window = ?, attack_types = ?,
          severity_filter = ?, proxy_id = ?, ban_duration = ?,
          ban_severity = ?, priority = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name !== undefined ? name : existing.name,
      threshold !== undefined ? threshold : existing.threshold,
      time_window !== undefined ? time_window : existing.time_window,
      attack_types !== undefined ? JSON.stringify(attack_types) : existing.attack_types,
      severity_filter !== undefined ? severity_filter : existing.severity_filter,
      proxy_id !== undefined ? proxy_id : existing.proxy_id,
      ban_duration !== undefined ? ban_duration : existing.ban_duration,
      ban_severity !== undefined ? ban_severity : existing.ban_severity,
      priority !== undefined ? priority : existing.priority,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      id
    );

    logAudit(req.user.userId, 'update_detection_rule', 'detection_rule', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'Detection rule updated successfully' });
  } catch (error) {
    console.error('Update detection rule error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

function handleDeleteDetectionRule(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const existing = db.prepare('SELECT * FROM ips_detection_rules WHERE id = ?').get(id);
    if (!existing) {
      return sendJSON(res, { error: 'Detection rule not found' }, 404);
    }

    db.prepare('DELETE FROM ips_detection_rules WHERE id = ?').run(id);

    logAudit(req.user.userId, 'delete_detection_rule', 'detection_rule', id, null, getClientIP(req));

    sendJSON(res, { success: true, message: 'Detection rule deleted successfully' });
  } catch (error) {
    console.error('Delete detection rule error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

function handleToggleDetectionRule(req, res, parsedUrl) {
  try {
    const id = parsedUrl.pathname.split('/')[4];

    const existing = db.prepare('SELECT enabled FROM ips_detection_rules WHERE id = ?').get(id);
    if (!existing) {
      return sendJSON(res, { error: 'Detection rule not found' }, 404);
    }

    const newEnabled = existing.enabled ? 0 : 1;

    db.prepare('UPDATE ips_detection_rules SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newEnabled, id);

    logAudit(req.user.userId, newEnabled ? 'enable_detection_rule' : 'disable_detection_rule',
      'detection_rule', id, null, getClientIP(req));

    sendJSON(res, {
      success: true,
      enabled: newEnabled === 1,
      message: `Detection rule ${newEnabled ? 'enabled' : 'disabled'} successfully`
    });
  } catch (error) {
    console.error('Toggle detection rule error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

// ============================================================================
// Queue Status Handler
// ============================================================================

function handleGetQueueStatus(req, res) {
  try {
    const banQueue = getBanQueue();
    const status = banQueue.getStatus();

    sendJSON(res, {
      queue: status,
      rate_limit: '1 request per 5 seconds per integration'
    });
  } catch (error) {
    console.error('Get queue status error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

// ============================================================================
// END BAN SYSTEM HANDLERS
// ============================================================================

module.exports = {
  handleAPI,
  broadcastBanEvent
};
