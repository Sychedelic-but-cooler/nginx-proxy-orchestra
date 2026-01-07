const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Get ACME webroot directory
 * Uses ACME_WEBROOT environment variable or defaults to data/acme-challenges
 */
function getACMEWebrootPath() {
  if (process.env.ACME_WEBROOT) {
    return process.env.ACME_WEBROOT;
  }
  // Default to data/acme-challenges in project root
  return path.join(__dirname, '../../data/acme-challenges');
}

// ACME challenge webroot directory
const ACME_WEBROOT = getACMEWebrootPath();
const ACME_CHALLENGE_DIR = path.join(ACME_WEBROOT, '.well-known', 'acme-challenge');

/**
 * Initialize ACME challenge webroot directory
 * This directory is used by Certbot to write challenge files
 * that Let's Encrypt will access via HTTP to verify domain ownership
 */
function initializeACMEWebroot() {
  try {
    console.log('Initializing ACME webroot directory...');

    // Create webroot directory if it doesn't exist
    if (!fs.existsSync(ACME_WEBROOT)) {
      fs.mkdirSync(ACME_WEBROOT, { recursive: true, mode: 0o755 });
      console.log(`Created ACME webroot: ${ACME_WEBROOT}`);
    }

    // Create .well-known/acme-challenge directory
    if (!fs.existsSync(ACME_CHALLENGE_DIR)) {
      fs.mkdirSync(ACME_CHALLENGE_DIR, { recursive: true, mode: 0o755 });
      console.log(`Created ACME challenge directory: ${ACME_CHALLENGE_DIR}`);
    }

    // Set proper permissions (readable by nginx) if using system path
    if (ACME_WEBROOT.startsWith('/var/') || ACME_WEBROOT.startsWith('/srv/')) {
      try {
        execSync(`chmod 755 ${ACME_WEBROOT}`);
        execSync(`chmod 755 ${path.join(ACME_WEBROOT, '.well-known')}`);
        execSync(`chmod 755 ${ACME_CHALLENGE_DIR}`);
        console.log('Set ACME directory permissions');
      } catch (error) {
        console.warn('Could not set ACME directory permissions (may need root):', error.message);
      }
    }

    console.log('ACME webroot initialized successfully');
    return { success: true, path: ACME_WEBROOT };
  } catch (error) {
    console.error('Failed to initialize ACME webroot:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check if ACME webroot is properly configured
 */
function checkACMEWebroot() {
  const checks = {
    webroot_exists: fs.existsSync(ACME_WEBROOT),
    challenge_dir_exists: fs.existsSync(ACME_CHALLENGE_DIR),
    webroot_writable: false,
    nginx_can_read: false
  };

  // Check if writable
  try {
    const testFile = path.join(ACME_CHALLENGE_DIR, '.test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    checks.webroot_writable = true;
  } catch (error) {
    checks.webroot_writable = false;
  }

  // Check if nginx can read (check permissions)
  try {
    const stats = fs.statSync(ACME_CHALLENGE_DIR);
    // Check if others have read permission
    checks.nginx_can_read = (stats.mode & 0o004) !== 0;
  } catch (error) {
    checks.nginx_can_read = false;
  }

  return checks;
}

/**
 * Get ACME webroot path
 */
function getACMEWebroot() {
  return ACME_WEBROOT;
}

module.exports = {
  initializeACMEWebroot,
  checkACMEWebroot,
  getACMEWebroot,
  ACME_WEBROOT
};
