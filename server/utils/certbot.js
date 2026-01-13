const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { getACMEWebroot } = require('./acme-setup');
const {
  getProvider,
  createCredentialFile,
  deleteCredentialFile,
  buildCertbotCommand
} = require('./dns-providers');
const { validateEmail, validateDomains } = require('./input-validator');

/**
 * Get certbot directories - use data folder to avoid needing root
 */
function getCertbotDirs() {
  const baseDir = process.env.CERTBOT_DIR || path.join(__dirname, '../../data/letsencrypt');

  return {
    configDir: path.join(baseDir, 'config'),
    workDir: path.join(baseDir, 'work'),
    logsDir: path.join(baseDir, 'logs'),
    liveDir: path.join(baseDir, 'config', 'live'),
    archiveDir: path.join(baseDir, 'config', 'archive'),
    renewalDir: path.join(baseDir, 'config', 'renewal')
  };
}

// Initialize certbot directories
function initializeCertbotDirs() {
  const dirs = getCertbotDirs();

  for (const dir of Object.values(dirs)) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }
}

// Initialize on module load
initializeCertbotDirs();

// Certbot certificate storage
const certbotDirs = getCertbotDirs();
const CERTBOT_LIVE_DIR = certbotDirs.liveDir;
const CERTBOT_ARCHIVE_DIR = certbotDirs.archiveDir;
const CERTBOT_RENEWAL_DIR = certbotDirs.renewalDir;

// Certificate paths relative to domain directory
const CERT_FILES = {
  cert: 'cert.pem',
  chain: 'chain.pem',
  fullchain: 'fullchain.pem',
  privkey: 'privkey.pem'
};

/**
 * Check if certbot is installed
 * @returns {Promise<Object>} { installed: boolean, version: string }
 */
async function checkCertbotInstallation() {
  try {
    const { stdout } = await execAsync('certbot --version');
    const version = stdout.trim();
    return { installed: true, version };
  } catch (error) {
    return { installed: false, version: null, error: error.message };
  }
}

/**
 * Order certificate using HTTP-01 challenge
 * @param {Object} options - Certificate order options
 * @param {String} options.email - Contact email
 * @param {Array} options.domains - Array of domain names
 * @param {String} options.certName - Certificate name (optional)
 * @param {Boolean} options.dryRun - Test mode using staging server (optional)
 * @returns {Promise<Object>} Result object
 */
async function orderCertificateHTTP(options) {
  const { email, domains, certName, dryRun } = options;

  // SECURITY: Validate inputs to prevent command injection
  if (!email || !domains || domains.length === 0) {
    throw new Error('Email and at least one domain are required');
  }

  // Validate email format
  const validatedEmail = validateEmail(email);

  // Validate all domains
  const validatedDomains = validateDomains(domains, { allowWildcard: false });

  // Check for wildcard domains (not supported with HTTP-01)
  const hasWildcard = validatedDomains.some(d => d.trim().startsWith('*'));
  if (hasWildcard) {
    throw new Error('Wildcard domains require DNS-01 challenge. Use orderCertificateDNS instead.');
  }

  const webroot = getACMEWebroot();
  const dirs = getCertbotDirs();

  // Build certbot command
  const args = [
    'certonly',
    '--non-interactive',
    '--agree-tos',
    `--email=${validatedEmail}`,
    '--webroot',
    `--webroot-path=${webroot}`,
    '--preferred-challenges=http',
    `--config-dir=${dirs.configDir}`,
    `--work-dir=${dirs.workDir}`,
    `--logs-dir=${dirs.logsDir}`
  ];

  // Add dry-run/staging flags if requested
  if (dryRun) {
    args.push('--dry-run', '--staging');
  }

  // Add certificate name if provided
  if (certName) {
    args.push(`--cert-name=${certName}`);
  }

  // Add domains
  for (const domain of validatedDomains) {
    args.push('-d', domain.trim());
  }

  try {
    const result = await executeCertbot(args);
    const certPath = getCertificatePath(certName || validatedDomains[0]);

    return {
      success: true,
      challengeType: 'http-01',
      certPath,
      domains: validatedDomains,
      message: 'Certificate ordered successfully',
      output: result.output
    };
  } catch (error) {
    return {
      success: false,
      challengeType: 'http-01',
      domains: validatedDomains,
      error: error.message,
      output: error.output || ''
    };
  }
}

/**
 * Order certificate using DNS-01 challenge
 * @param {Object} options - Certificate order options
 * @param {String} options.email - Contact email
 * @param {Array} options.domains - Array of domain names
 * @param {String} options.providerId - DNS provider ID
 * @param {Object} options.credentials - Decrypted DNS credentials
 * @param {Number} options.propagationSeconds - DNS propagation delay (10-120)
 * @param {String} options.certName - Certificate name (optional)
 * @param {Boolean} options.dryRun - Test mode using staging server (optional)
 * @returns {Promise<Object>} Result object
 */
async function orderCertificateDNS(options) {
  const {
    email,
    domains,
    providerId,
    credentials,
    propagationSeconds = 10,
    certName,
    dryRun
  } = options;

  // SECURITY: Validate inputs to prevent command injection
  if (!email || !domains || domains.length === 0) {
    throw new Error('Email and at least one domain are required');
  }

  if (!providerId || !credentials) {
    throw new Error('DNS provider and credentials are required for DNS-01 challenge');
  }

  // Validate email format
  const validatedEmail = validateEmail(email);

  // Validate all domains (wildcards allowed for DNS-01)
  const validatedDomains = validateDomains(domains, { allowWildcard: true });

  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown DNS provider: ${providerId}`);
  }

  let credentialFilePath = null;

  try {
    // Create temporary credential file
    const credName = certName || validatedDomains[0].replace(/\*/g, 'wildcard');
    credentialFilePath = createCredentialFile(providerId, credentials, credName);
    console.log('[DNS-01] Created credential file:', credentialFilePath);

    // Build certbot command
    const dirs = getCertbotDirs();
    const args = buildCertbotCommand(
      providerId,
      credentialFilePath,
      propagationSeconds,
      validatedEmail,
      validatedDomains,
      dirs,
      dryRun
    );
    console.log('[DNS-01] Certbot args:', args);

    // Add certificate name if provided
    if (certName) {
      args.push(`--cert-name=${certName}`);
    }

    const result = await executeCertbot(args);
    const certPath = getCertificatePath(certName || validatedDomains[0]);

    return {
      success: true,
      challengeType: 'dns-01',
      provider: providerId,
      certPath,
      domains: validatedDomains,
      message: 'Certificate ordered successfully',
      output: result.output
    };
  } catch (error) {
    return {
      success: false,
      challengeType: 'dns-01',
      provider: providerId,
      domains: validatedDomains,
      error: error.message,
      output: error.output || ''
    };
  } finally {
    // Clean up credential file
    if (credentialFilePath) {
      try {
        deleteCredentialFile(credentialFilePath);
      } catch (cleanupError) {
        console.error('Failed to delete credential file:', cleanupError.message);
      }
    }
  }
}

/**
 * Renew a certificate
 * @param {String} certName - Certificate name
 * @param {Object} options - Renewal options (for DNS-01)
 * @returns {Promise<Object>} Result object
 */
async function renewCertificate(certName, options = {}) {
  const dirs = getCertbotDirs();

  const args = [
    'renew',
    '--non-interactive',
    `--cert-name=${certName}`,
    '--force-renewal',
    `--config-dir=${dirs.configDir}`,
    `--work-dir=${dirs.workDir}`,
    `--logs-dir=${dirs.logsDir}`
  ];

  // For DNS-01 challenges, we need to provide credentials again
  if (options.providerId && options.credentials) {
    let credentialFilePath = null;

    try {
      // Create temporary credential file
      credentialFilePath = createCredentialFile(
        options.providerId,
        options.credentials,
        certName
      );

      // Note: Certbot renewal should use the stored configuration
      // but we provide credentials as a fallback
      const result = await executeCertbot(args);

      return {
        success: true,
        certName,
        message: 'Certificate renewed successfully',
        output: result.output
      };
    } catch (error) {
      return {
        success: false,
        certName,
        error: error.message,
        output: error.output || ''
      };
    } finally {
      if (credentialFilePath) {
        try {
          deleteCredentialFile(credentialFilePath);
        } catch (cleanupError) {
          console.error('Failed to delete credential file:', cleanupError.message);
        }
      }
    }
  } else {
    // HTTP-01 renewal (simpler)
    try {
      const result = await executeCertbot(args);

      return {
        success: true,
        certName,
        message: 'Certificate renewed successfully',
        output: result.output
      };
    } catch (error) {
      return {
        success: false,
        certName,
        error: error.message,
        output: error.output || ''
      };
    }
  }
}

/**
 * Execute certbot command
 * @param {Array} args - Certbot arguments
 * @returns {Promise<Object>} { success: boolean, output: string }
 */
function executeCertbot(args) {
  return new Promise((resolve, reject) => {
    // Log the full command for debugging
    console.log('[Certbot Command]', 'certbot', args.join(' '));

    const certbot = spawn('certbot', args);

    let stdout = '';
    let stderr = '';

    certbot.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('[Certbot]', data.toString().trim());
    });

    certbot.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('[Certbot Error]', data.toString().trim());
    });

    certbot.on('close', (code) => {
      const output = stdout + '\n' + stderr;

      if (code === 0) {
        resolve({
          success: true,
          output: output.trim()
        });
      } else {
        const error = new Error(`Certbot exited with code ${code}`);
        error.output = output.trim();
        reject(error);
      }
    });

    certbot.on('error', (error) => {
      error.output = stderr || error.message;
      reject(error);
    });
  });
}

/**
 * Get certificate path for a domain
 * @param {String} certName - Certificate name or primary domain
 * @returns {String} Path to certificate directory
 */
function getCertificatePath(certName) {
  // Clean up cert name (remove wildcard asterisks)
  const cleanName = certName.replace(/\*/g, '').replace(/^\./, '');
  return path.join(CERTBOT_LIVE_DIR, cleanName);
}

/**
 * Read certificate files from certbot directory
 * @param {String} certName - Certificate name
 * @returns {Promise<Object>} Certificate file contents
 */
async function readCertificateFiles(certName) {
  const certDir = getCertificatePath(certName);

  if (!fs.existsSync(certDir)) {
    throw new Error(`Certificate directory not found: ${certDir}`);
  }

  const cert = fs.readFileSync(path.join(certDir, CERT_FILES.cert), 'utf8');
  const chain = fs.readFileSync(path.join(certDir, CERT_FILES.chain), 'utf8');
  const fullchain = fs.readFileSync(path.join(certDir, CERT_FILES.fullchain), 'utf8');
  const privkey = fs.readFileSync(path.join(certDir, CERT_FILES.privkey), 'utf8');

  return {
    cert,
    chain,
    fullchain,
    privkey,
    certPath: certDir
  };
}

/**
 * Parse certificate expiry date
 * @param {String} certPath - Path to certificate file
 * @returns {Promise<Date>} Expiry date
 */
async function getCertificateExpiry(certPath) {
  try {
    const certFile = path.join(certPath, CERT_FILES.cert);
    const { stdout } = await execAsync(
      `openssl x509 -enddate -noout -in "${certFile}"`
    );

    // Parse output: "notAfter=Jan  1 00:00:00 2025 GMT"
    const match = stdout.match(/notAfter=(.+)/);
    if (match) {
      return new Date(match[1]);
    }

    throw new Error('Could not parse certificate expiry date');
  } catch (error) {
    throw new Error(`Failed to get certificate expiry: ${error.message}`);
  }
}

/**
 * Get certificate domains
 * @param {String} certPath - Path to certificate file
 * @returns {Promise<Array>} Array of domain names
 */
async function getCertificateDomains(certPath) {
  try {
    const certFile = path.join(certPath, CERT_FILES.cert);
    const { stdout } = await execAsync(
      `openssl x509 -text -noout -in "${certFile}"`
    );

    const domains = [];

    // Extract CN (Common Name)
    const cnMatch = stdout.match(/Subject:.*CN\s*=\s*([^,\n]+)/);
    if (cnMatch) {
      domains.push(cnMatch[1].trim());
    }

    // Extract SANs (Subject Alternative Names)
    const sanMatch = stdout.match(/Subject Alternative Name:\s*\n\s*(.+)/);
    if (sanMatch) {
      const sans = sanMatch[1].split(',').map(s => {
        const parts = s.trim().split(':');
        return parts[parts.length - 1];
      });
      domains.push(...sans);
    }

    // Remove duplicates
    return [...new Set(domains)];
  } catch (error) {
    throw new Error(`Failed to get certificate domains: ${error.message}`);
  }
}

/**
 * Check which certificates need renewal
 * @param {Number} daysBeforeExpiry - Days before expiry to consider (default: 30)
 * @returns {Promise<Array>} Array of certificates needing renewal
 */
async function checkRenewals(daysBeforeExpiry = 30) {
  try {
    const dirs = getCertbotDirs();
    // Use certbot's built-in renewal check
    const { stdout } = await execAsync(
      `certbot certificates --config-dir=${dirs.configDir} --work-dir=${dirs.workDir} --logs-dir=${dirs.logsDir}`
    );

    const certificates = parseCertbotCertificates(stdout);
    const needsRenewal = [];
    const now = new Date();
    const threshold = daysBeforeExpiry * 24 * 60 * 60 * 1000; // Convert to milliseconds

    for (const cert of certificates) {
      const timeUntilExpiry = cert.expiryDate - now;

      if (timeUntilExpiry < threshold) {
        needsRenewal.push({
          ...cert,
          daysUntilExpiry: Math.floor(timeUntilExpiry / (24 * 60 * 60 * 1000))
        });
      }
    }

    return needsRenewal;
  } catch (error) {
    console.error('Failed to check renewals:', error.message);
    return [];
  }
}

/**
 * Parse output of "certbot certificates" command
 * @param {String} output - Command output
 * @returns {Array} Parsed certificate information
 */
function parseCertbotCertificates(output) {
  const certificates = [];
  const certBlocks = output.split('Certificate Name:').slice(1);

  for (const block of certBlocks) {
    const lines = block.split('\n');
    const cert = {
      name: lines[0].trim(),
      domains: [],
      expiryDate: null,
      certPath: null
    };

    for (const line of lines) {
      if (line.includes('Domains:')) {
        const domainsStr = line.split('Domains:')[1].trim();
        cert.domains = domainsStr.split(' ').map(d => d.trim());
      } else if (line.includes('Expiry Date:')) {
        const dateStr = line.split('Expiry Date:')[1].split('(')[0].trim();
        cert.expiryDate = new Date(dateStr);
      } else if (line.includes('Certificate Path:')) {
        cert.certPath = line.split('Certificate Path:')[1].trim();
      }
    }

    if (cert.name) {
      certificates.push(cert);
    }
  }

  return certificates;
}

/**
 * Delete a certificate
 * @param {String} certName - Certificate name
 * @returns {Promise<Object>} Result object
 */
async function deleteCertificate(certName) {
  try {
    const dirs = getCertbotDirs();
    const args = [
      'delete',
      '--non-interactive',
      '--cert-name', certName,
      `--config-dir=${dirs.configDir}`,
      `--work-dir=${dirs.workDir}`,
      `--logs-dir=${dirs.logsDir}`
    ];
    const result = await executeCertbot(args);

    return {
      success: true,
      certName,
      message: 'Certificate deleted successfully',
      output: result.output
    };
  } catch (error) {
    return {
      success: false,
      certName,
      error: error.message,
      output: error.output || ''
    };
  }
}

/**
 * Get installation instructions for Certbot on Rocky Linux 9
 * @returns {Object} Installation instructions
 */
function getInstallationInstructions() {
  return {
    os: 'Rocky Linux 9',
    commands: [
      'dnf install -y epel-release',
      'dnf install -y certbot'
    ],
    instructions: `
Certbot Installation for Rocky Linux 9
========================================

1. Install EPEL repository:
   dnf install -y epel-release

2. Install Certbot:
   dnf install -y certbot

3. Verify installation:
   certbot --version

For more information, visit:
https://certbot.eff.org/instructions?ws=other&os=centosrhel9

DNS Provider Plugins:
---------------------
If you need DNS-01 challenge support, install the appropriate plugin:

- Cloudflare: dnf install -y python3-certbot-dns-cloudflare
- AWS Route53: dnf install -y python3-certbot-dns-route53
- Google Cloud: dnf install -y python3-certbot-dns-google
- DigitalOcean: dnf install -y python3-certbot-dns-digitalocean
- Azure: dnf install -y python3-certbot-dns-azure
`.trim()
  };
}

module.exports = {
  checkCertbotInstallation,
  orderCertificateHTTP,
  orderCertificateDNS,
  renewCertificate,
  readCertificateFiles,
  getCertificateExpiry,
  getCertificateDomains,
  checkRenewals,
  deleteCertificate,
  getInstallationInstructions,
  getCertbotDirs,
  CERTBOT_LIVE_DIR,
  CERTBOT_ARCHIVE_DIR,
  CERTBOT_RENEWAL_DIR
};
