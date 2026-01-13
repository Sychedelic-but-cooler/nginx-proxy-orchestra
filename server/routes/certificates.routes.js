/**
 * Certificates routes
 * Manages SSL/TLS certificates and certbot integration
 */

const { db, logAudit, getSetting, setSetting } = require('../db');
const { parseBody, sendJSON, getClientIP } = require('./shared/utils');
const {
  parseCertificate,
  validateCertificateKeyPair,
  saveCertificateFiles,
  deleteCertificateFiles
} = require('../utils/ssl-parser');
const {
  checkCertbotInstallation,
  orderCertificateHTTP,
  orderCertificateDNS,
  getInstallationInstructions,
  readCertificateFiles
} = require('../utils/certbot');
const {
  getProviders,
  isProviderInstalled
} = require('../utils/dns-providers');
const {
  decryptCredentials,
  isEncryptionConfigured
} = require('../utils/credential-encryption');
const {
  generateServerBlock,
  generateStreamBlock,
  generate404Block,
  writeNginxConfig,
  enableNginxConfig,
  disableNginxConfig,
  sanitizeFilename
} = require('../utils/nginx-parser');
const { testNginxConfig } = require('../utils/nginx-ops');
const { reloadManager } = require('../utils/nginx-reload-manager');

/**
 * Handle certificate-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleCertificateRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/certificates' && method === 'GET') {
    return handleGetCertificates(req, res);
  }

  if (pathname === '/api/certificates' && method === 'POST') {
    return handleCreateCertificate(req, res);
  }

  if (pathname.match(/^\/api\/certificates\/\d+$/) && method === 'DELETE') {
    return handleDeleteCertificate(req, res, parsedUrl);
  }

  if (pathname === '/api/certificates/order' && method === 'POST') {
    return handleOrderCertificate(req, res);
  }

  if (pathname === '/api/certbot/status' && method === 'GET') {
    return handleGetCertbotStatus(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get certificates
 * Returns all SSL certificates with usage information
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetCertificates(req, res) {
  const certificates = db.prepare('SELECT * FROM ssl_certificates ORDER BY created_at DESC').all();

  // Add usage information for each certificate
  const certificatesWithUsage = certificates.map(cert => {
    // Get proxy hosts using this certificate
    const proxiesUsingCert = db.prepare(`
      SELECT id, name FROM proxy_hosts WHERE ssl_cert_id = ?
    `).all(cert.id);

    // Check if used by admin interface
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

/**
 * Create certificate
 * Uploads and validates a new SSL certificate
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
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

/**
 * Delete certificate
 * Removes a certificate and disables SSL on affected proxies
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with certificate ID
 */
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
    const adminCertId = getSetting('admin_cert_id');
    const usedByAdmin = adminCertId && parseInt(adminCertId) === id;

    // Disable TLS on all affected proxy hosts
    if (affectedProxies.length > 0) {
      db.prepare('UPDATE proxy_hosts SET ssl_enabled = 0, ssl_cert_id = NULL WHERE ssl_cert_id = ?').run(id);

      // Regenerate configs for affected proxies
      for (const proxy of affectedProxies) {
        try {
          const updatedProxy = db.prepare('SELECT * FROM proxy_hosts WHERE id = ?').get(proxy.id);
          
          let config;
          
          // If proxy has advanced_config, update it to remove SSL directives
          if (updatedProxy.advanced_config && updatedProxy.advanced_config.trim()) {
            config = updatedProxy.advanced_config;
            
            // Remove SSL listen directives
            config = config.replace(/listen\s+443\s+ssl[^;]*;?\n?/g, '');
            config = config.replace(/listen\s+\[::\]:443\s+ssl[^;]*;?\n?/g, '');
            config = config.replace(/listen\s+443\s+quic[^;]*;?\n?/g, '');
            config = config.replace(/listen\s+\[::\]:443\s+quic[^;]*;?\n?/g, '');
            
            // Remove SSL certificate directives
            config = config.replace(/ssl_certificate\s+[^;]+;?\n?/g, '');
            config = config.replace(/ssl_certificate_key\s+[^;]+;?\n?/g, '');
            
            // Remove SSL-related directives
            config = config.replace(/ssl_protocols[^;]+;?\n?/g, '');
            config = config.replace(/ssl_ciphers[^;]+;?\n?/g, '');
            config = config.replace(/ssl_prefer_server_ciphers[^;]+;?\n?/g, '');
            
            // Clean up extra blank lines
            config = config.replace(/\n{3,}/g, '\n\n');
            
            // Update the database with modified config
            db.prepare('UPDATE proxy_hosts SET advanced_config = ? WHERE id = ?').run(config, proxy.id);
          } else {
            // Generate from structured fields
            const modules = db.prepare(`
              SELECT m.* FROM modules m
              JOIN proxy_modules pm ON m.id = pm.module_id
              WHERE pm.proxy_id = ?
            `).all(proxy.id);

            if (updatedProxy.type === 'stream') {
              config = generateStreamBlock(updatedProxy);
            } else if (updatedProxy.type === '404') {
              config = generate404Block(updatedProxy);
            } else {
              config = generateServerBlock(updatedProxy, modules, db);
            }
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

/**
 * Order certificate via certbot
 * Orders a Let's Encrypt certificate using HTTP-01 or DNS-01 challenge
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
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
        'SELECT * FROM dns_credentials WHERE id = ?'
      ).get(dnsCredentialId);

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
    const certFiles = await readCertificateFiles(certName || domains[0]);

    // Parse certificate to extract metadata
    const certInfo = parseCertificate(certFiles.cert);

    // Extract domain names and issuer
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

    // Insert certificate into database
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

    logAudit(req.user.userId, 'order_certificate', 'ssl_certificate', certResult.lastInsertRowid, null, getClientIP(req));

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
 * Get certbot status
 * Returns certbot installation status and DNS provider plugin status
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
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

module.exports = handleCertificateRoutes;
