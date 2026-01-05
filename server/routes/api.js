const { db, logAudit } = require('../db');
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
  enableNginxConfig,
  disableNginxConfig
} = require('../utils/nginx-parser');
const {
  getNginxStatus,
  safeReload,
  testNginxConfig
} = require('../utils/nginx-ops');
const {
  parseCertificate,
  validateCertificateKeyPair,
  saveCertificateFiles,
  deleteCertificateFiles
} = require('../utils/ssl-parser');

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
      sc.name as ssl_cert_name
    FROM proxy_hosts ph
    LEFT JOIN ssl_certificates sc ON ph.ssl_cert_id = sc.id
    ORDER BY ph.created_at DESC
  `).all();

  sendJSON(res, proxies);
}

function handleGetProxy(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/').pop());
  const proxy = db.prepare(`
    SELECT ph.*, sc.name as ssl_cert_name
    FROM proxy_hosts ph
    LEFT JOIN ssl_certificates sc ON ph.ssl_cert_id = sc.id
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
  const { name, type, domain_names, forward_scheme, forward_host, forward_port, ssl_enabled, ssl_cert_id, advanced_config, module_ids } = body;

  if (!name || !domain_names || !forward_host || !forward_port) {
    return sendJSON(res, { error: 'Missing required fields' }, 400);
  }

  try {
    // Insert proxy
    const result = db.prepare(`
      INSERT INTO proxy_hosts (name, type, domain_names, forward_scheme, forward_host, forward_port, ssl_enabled, ssl_cert_id, advanced_config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, type || 'reverse', domain_names, forward_scheme || 'http', forward_host, forward_port, ssl_enabled ? 1 : 0, ssl_cert_id || null, advanced_config || null);

    const proxyId = result.lastInsertRowid;

    // Associate modules
    if (module_ids && Array.isArray(module_ids)) {
      const insertModule = db.prepare('INSERT INTO proxy_modules (proxy_id, module_id) VALUES (?, ?)');
      for (const moduleId of module_ids) {
        insertModule.run(proxyId, moduleId);
      }
    }

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
      config = generateServerBlock(proxy, modules);

      // Replace SSL cert placeholders if needed
      if (ssl_enabled && ssl_cert_id) {
        const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?').get(ssl_cert_id);
        if (cert) {
          config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
          config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
        }
      }
    }

    const filename = `${name}.conf`;
    writeNginxConfig(filename, config);
    enableNginxConfig(filename);

    logAudit(req.user.userId, 'create', 'proxy', proxyId, JSON.stringify({ name, type }), getClientIP(req));

    sendJSON(res, { success: true, id: proxyId, proxy }, 201);
  } catch (error) {
    console.error('Create proxy error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

async function handleUpdateProxy(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);
  const body = await parseBody(req);

  const proxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(id);
  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  const { name, domain_names, forward_scheme, forward_host, forward_port, ssl_enabled, ssl_cert_id, advanced_config, module_ids } = body;

  try {
    db.prepare(`
      UPDATE proxy_hosts 
      SET name = ?, domain_names = ?, forward_scheme = ?, forward_host = ?, forward_port = ?,
          ssl_enabled = ?, ssl_cert_id = ?, advanced_config = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name || proxy.name, domain_names || proxy.domain_names, forward_scheme || proxy.forward_scheme,
           forward_host || proxy.forward_host, forward_port || proxy.forward_port, 
           ssl_enabled !== undefined ? (ssl_enabled ? 1 : 0) : proxy.ssl_enabled,
           ssl_cert_id !== undefined ? ssl_cert_id : proxy.ssl_cert_id,
           advanced_config !== undefined ? advanced_config : proxy.advanced_config, id);

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
      config = generateServerBlock(updatedProxy, modules);

      if (updatedProxy.ssl_enabled && updatedProxy.ssl_cert_id) {
        const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?').get(updatedProxy.ssl_cert_id);
        if (cert) {
          config = config.replace('{{SSL_CERT_PATH}}', cert.cert_path);
          config = config.replace('{{SSL_KEY_PATH}}', cert.key_path);
        }
      }
    }

    const filename = `${updatedProxy.name}.conf`;
    writeNginxConfig(filename, config);

    logAudit(req.user.userId, 'update', 'proxy', id, JSON.stringify(body), getClientIP(req));

    sendJSON(res, { success: true, proxy: updatedProxy });
  } catch (error) {
    console.error('Update proxy error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

function handleDeleteProxy(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);
  
  const proxy = db.prepare('SELECT name FROM proxy_hosts WHERE id = ?').get(id);
  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  try {
    const filename = `${proxy.name}.conf`;
    deleteNginxConfig(filename);
    
    db.prepare('DELETE FROM proxy_hosts WHERE id = ?').run(id);
    
    logAudit(req.user.userId, 'delete', 'proxy', id, JSON.stringify({ name: proxy.name }), getClientIP(req));

    sendJSON(res, { success: true });
  } catch (error) {
    console.error('Delete proxy error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

function handleToggleProxy(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);
  
  const proxy = db.prepare('SELECT name, enabled FROM proxy_hosts WHERE id = ?').get(id);
  if (!proxy) {
    return sendJSON(res, { error: 'Proxy not found' }, 404);
  }

  try {
    const newEnabled = proxy.enabled ? 0 : 1;
    db.prepare('UPDATE proxy_hosts SET enabled = ? WHERE id = ?').run(newEnabled, id);

    const filename = `${proxy.name}.conf`;
    if (newEnabled) {
      enableNginxConfig(filename);
    } else {
      disableNginxConfig(filename);
    }

    logAudit(req.user.userId, newEnabled ? 'enable' : 'disable', 'proxy', id, null, getClientIP(req));

    sendJSON(res, { success: true, enabled: newEnabled });
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
    
    logAudit(req.user.userId, 'update', 'module', id, JSON.stringify(body), getClientIP(req));
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

// ============================================================================
// SSL Certificate Handlers
// ============================================================================

function handleGetCertificates(req, res) {
  const certificates = db.prepare('SELECT * FROM ssl_certificates ORDER BY created_at DESC').all();
  sendJSON(res, certificates);
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

function handleDeleteCertificate(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);
  
  const cert = db.prepare('SELECT name, cert_path, key_path FROM ssl_certificates WHERE id = ?').get(id);
  if (!cert) {
    return sendJSON(res, { error: 'Certificate not found' }, 404);
  }

  // Check if certificate is in use
  const inUse = db.prepare('SELECT COUNT(*) as count FROM proxy_hosts WHERE ssl_cert_id = ?').get(id);
  if (inUse.count > 0) {
    return sendJSON(res, { error: 'Certificate is in use by proxy hosts' }, 400);
  }

  try {
    // Delete certificate files from disk
    deleteCertificateFiles(cert.cert_path, cert.key_path);
    
    // Delete from database
    db.prepare('DELETE FROM ssl_certificates WHERE id = ?').run(id);
    logAudit(req.user.userId, 'delete', 'certificate', id, JSON.stringify({ name: cert.name }), getClientIP(req));
    sendJSON(res, { success: true });
  } catch (error) {
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

function handleNginxReload(req, res) {
  const result = safeReload();
  
  if (result.success) {
    logAudit(req.user.userId, 'reload_nginx', 'nginx', null, null, getClientIP(req));
  }
  
  sendJSON(res, result);
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

module.exports = {
  handleAPI
};
