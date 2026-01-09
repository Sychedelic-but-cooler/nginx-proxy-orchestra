const fs = require('fs');
const path = require('path');
const { getSetting } = require('../db');

/**
 * Get the nginx config directory
 * Defaults to data/conf in project root to avoid needing sudo
 */
function getConfigDir() {
  if (process.env.NGINX_CONFIG_DIR) {
    return process.env.NGINX_CONFIG_DIR;
  }
  // Default to data/conf in project root
  return path.join(__dirname, '../../data/conf');
}

/**
 * Generate default server configuration based on settings
 */
function generateDefaultServerConfig() {
  const behavior = getSetting('default_server_behavior') || 'drop';
  const customUrl = getSetting('default_server_custom_url') || '';

  let httpAction, httpsAction;

  if (behavior === 'drop') {
    // Return 444 to close connection without response
    httpAction = '    return 444;';
    httpsAction = '    return 444;';
  } else if (behavior === '404') {
    // Return 404 Not Found
    httpAction = '    return 404;';
    httpsAction = '    return 404;';
  } else if (behavior === 'custom' && customUrl) {
    // Redirect to custom URL
    httpAction = `    return 301 ${customUrl};`;
    httpsAction = `    return 301 ${customUrl};`;
  } else {
    // Fallback to drop
    httpAction = '    return 444;';
    httpsAction = '    return 444;';
  }

  return `# Default catch-all server
# This prevents unmatched domains from being served by other virtual hosts
# Automatically managed by Nginx Proxy Orchestra
# Behavior: ${behavior}${behavior === 'custom' && customUrl ? ' - ' + customUrl : ''}

# Catch all HTTP requests to undefined domains
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

${httpAction}
}

# Catch all HTTPS requests to undefined domains
server {
    # QUIC/HTTP3 listeners with reuseport (declared once for all virtual hosts)
    listen 443 quic reuseport default_server;
    listen [::]:443 quic default_server;

    # Standard HTTPS listeners
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;

    server_name _;

    # Use a self-signed certificate for the default server
    # This prevents SSL errors when accessing undefined domains
    ssl_certificate /etc/nginx/ssl/default.crt;
    ssl_certificate_key /etc/nginx/ssl/default.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # HTTP/3 advertisement header
    add_header Alt-Svc 'h3=":443"; ma=86400' always;

${httpsAction}
}
`;
}

/**
 * Create or update the default catch-all server configuration
 * This prevents disabled hosts from redirecting to active hosts
 */
function ensureDefaultServerExists() {
  const configDir = getConfigDir();
  const defaultConfigPath = path.join(configDir, '000-default.conf');

  const defaultConfig = generateDefaultServerConfig();

  try {
    const fileExisted = fs.existsSync(defaultConfigPath);

    // Always write the config to ensure it matches current settings
    fs.writeFileSync(defaultConfigPath, defaultConfig, { mode: 0o644 });

    return { success: true, created: !fileExisted, updated: fileExisted };
  } catch (error) {
    console.error('Failed to create default server config:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create self-signed certificate for default server
 */
function ensureDefaultSSLCertExists() {
  const sslDir = '/etc/nginx/ssl';
  const certPath = path.join(sslDir, 'default.crt');
  const keyPath = path.join(sslDir, 'default.key');

  // Check if cert already exists
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { success: true, created: false };
  }

  try {
    // Create SSL directory if it doesn't exist
    if (!fs.existsSync(sslDir)) {
      fs.mkdirSync(sslDir, { recursive: true, mode: 0o755 });
    }

    // Generate self-signed certificate using openssl
    const { execSync } = require('child_process');
    execSync(
      `openssl req -x509 -nodes -days 3650 -newkey rsa:2048 ` +
      `-keyout "${keyPath}" -out "${certPath}" ` +
      `-subj "/C=US/ST=State/L=City/O=Nginx Proxy Orchestra/CN=default.local"`,
      { stdio: 'pipe' }
    );

    // Set appropriate permissions
    fs.chmodSync(certPath, 0o644);
    fs.chmodSync(keyPath, 0o600);

    return { success: true, created: true };
  } catch (error) {
    console.error('Failed to create default SSL certificate:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Initialize default server configuration
 * Call this on server startup
 */
function initializeDefaultServer() {
  console.log('Initializing default catch-all server...');

  // Create default SSL certificate first
  const certResult = ensureDefaultSSLCertExists();
  if (!certResult.success) {
    console.warn('Warning: Could not create default SSL certificate');
    console.warn('Default HTTPS catch-all may not work properly');
  } else if (certResult.created) {
    console.log('✓ Created default SSL certificate');
  }

  // Create default server config
  const configResult = ensureDefaultServerExists();
  if (!configResult.success) {
    console.error('Error: Could not create default server configuration');
    return false;
  } else if (configResult.created) {
    console.log('✓ Created default catch-all server configuration');
  }

  return true;
}

module.exports = {
  ensureDefaultServerExists,
  ensureDefaultSSLCertExists,
  initializeDefaultServer
};
