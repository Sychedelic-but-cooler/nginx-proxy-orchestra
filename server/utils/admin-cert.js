const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Get the admin SSL directory
 */
function getAdminSslDir() {
  const sslDir = process.env.SSL_DIR || path.join(__dirname, '../../data/ssl');
  if (!fs.existsSync(sslDir)) {
    fs.mkdirSync(sslDir, { recursive: true });
  }
  return sslDir;
}

/**
 * Get paths for admin certificate files
 */
function getAdminCertPaths() {
  const sslDir = getAdminSslDir();
  return {
    cert: path.join(sslDir, 'admin-self-signed.crt'),
    key: path.join(sslDir, 'admin-self-signed.key')
  };
}

/**
 * Check if self-signed admin certificate exists
 */
function hasAdminCert() {
  const paths = getAdminCertPaths();
  return fs.existsSync(paths.cert) && fs.existsSync(paths.key);
}

/**
 * Generate a self-signed certificate for the admin interface
 */
function generateSelfSignedCert() {
  const paths = getAdminCertPaths();

  console.log('🔐 Generating self-signed certificate for admin interface...');

  try {
    // Generate private key and self-signed certificate
    // Valid for 365 days, 2048-bit RSA key
    const cmd = `openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout "${paths.key}" \
      -out "${paths.cert}" \
      -subj "/C=US/ST=State/L=City/O=Nginx Proxy Orchestra/CN=localhost"`;

    execSync(cmd, { stdio: 'pipe' });

    // Set proper permissions
    fs.chmodSync(paths.key, 0o600);
    fs.chmodSync(paths.cert, 0o644);

    console.log('✅ Self-signed certificate generated successfully');
    console.log(`   Certificate: ${paths.cert}`);
    console.log(`   Key: ${paths.key}`);
    console.log('');
    console.log('⚠️  NOTE: This is a self-signed certificate. Your browser will show');
    console.log('   a security warning. You can configure a trusted certificate in');
    console.log('   Settings > Admin Interface Certificate');
    console.log('');

    return true;
  } catch (error) {
    console.error('❌ Failed to generate self-signed certificate:', error.message);
    return false;
  }
}

/**
 * Ensure admin certificate exists (create if missing)
 */
function ensureAdminCert() {
  if (!hasAdminCert()) {
    return generateSelfSignedCert();
  }
  return true;
}

/**
 * Get the active admin certificate paths (from settings or default)
 */
function getActiveCertPaths(db) {
  const { getSetting } = require('../db');

  // Check if user has configured a custom certificate
  const adminCertId = getSetting('admin_cert_id');

  if (adminCertId) {
    try {
      const cert = db.prepare('SELECT cert_path, key_path FROM ssl_certificates WHERE id = ?').get(parseInt(adminCertId));
      if (cert && fs.existsSync(cert.cert_path) && fs.existsSync(cert.key_path)) {
        return {
          cert: cert.cert_path,
          key: cert.key_path,
          isCustom: true
        };
      }
    } catch (error) {
      console.warn('⚠️  Failed to load custom admin certificate, falling back to self-signed');
    }
  }

  // Fall back to self-signed certificate
  const paths = getAdminCertPaths();
  return {
    cert: paths.cert,
    key: paths.key,
    isCustom: false
  };
}

module.exports = {
  getAdminSslDir,
  getAdminCertPaths,
  hasAdminCert,
  generateSelfSignedCert,
  ensureAdminCert,
  getActiveCertPaths
};
