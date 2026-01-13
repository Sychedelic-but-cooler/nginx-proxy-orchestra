const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ACME_WEBROOT } = require('./acme-setup');

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
 * Parse nginx configuration file to extract server blocks
 */
function parseNginxConfig(configContent) {
  const serverBlocks = [];
  
  // Match server blocks (including nested braces)
  const serverRegex = /server\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/gs;
  let match;
  
  while ((match = serverRegex.exec(configContent)) !== null) {
    const blockContent = match[1];
    
    serverBlocks.push({
      raw: match[0],
      serverName: extractDirective(blockContent, 'server_name'),
      listen: extractDirectives(blockContent, 'listen'),
      location: extractLocations(blockContent),
      sslCertificate: extractDirective(blockContent, 'ssl_certificate'),
      sslCertificateKey: extractDirective(blockContent, 'ssl_certificate_key')
    });
  }
  
  return serverBlocks;
}

/**
 * Extract a single directive value from config block
 */
function extractDirective(block, directive) {
  const regex = new RegExp(`${escapeRegex(directive)}\\s+([^;]+);`, 'i');
  const match = block.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extract multiple directive values from config block
 */
function extractDirectives(block, directive) {
  const regex = new RegExp(`${escapeRegex(directive)}\\s+([^;]+);`, 'gi');
  const matches = [];
  let match;
  
  while ((match = regex.exec(block)) !== null) {
    matches.push(match[1].trim());
  }
  
  return matches;
}

/**
 * Extract location blocks
 */
function extractLocations(block) {
  const locations = [];
  const locationRegex = /location\s+([^\s{]+)\s*\{([^}]+)\}/gs;
  let match;
  
  while ((match = locationRegex.exec(block)) !== null) {
    locations.push({
      path: match[1].trim(),
      config: match[2].trim()
    });
  }
  
  return locations;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize name for use as filename
 * Removes or replaces characters that are invalid in filenames
 * @param {string} name - The proxy name
 * @returns {string} - Safe filename (without .conf extension)
 */
function sanitizeFilename(name) {
  if (!name) {
    return `proxy_${Date.now()}`;
  }

  // Replace invalid filename characters with underscore
  // Invalid: < > : " / \ | ? * and control characters
  let sanitized = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

  // Remove leading/trailing dots and spaces
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');

  // Limit length to 200 characters
  sanitized = sanitized.substring(0, 200);

  // If empty after sanitization, use timestamp
  if (!sanitized) {
    sanitized = `proxy_${Date.now()}`;
  }

  return sanitized;
}

/**
 * Generate listen directives based on SSL settings (without hardcoded http2)
 * @param {Object} proxyHost - Proxy configuration
 * @param {Array} modules - Array of modules (not used yet, for future extensibility)
 * @returns {string} - Listen directives
 */
function generateListenDirectives(proxyHost, modules) {
  let directives = '';

  if (proxyHost.ssl_enabled) {
    // Check if HTTP/3 (QUIC) module is enabled
    const hasHTTP3 = modules.some(m => m.name === 'HTTP/3 (QUIC)');

    if (hasHTTP3) {
      // Add QUIC listeners first (no reuseport to avoid conflicts with multiple proxies)
      directives += `    listen 443 quic;\n`;
      directives += `    listen [::]:443 quic;\n`;
    }

    // Add SSL listeners
    directives += `    listen 443 ssl;\n`;
    directives += `    listen [::]:443 ssl;\n`;
  } else {
    directives += `    listen 80;\n`;
    directives += `    listen [::]:80;\n`;
  }

  return directives;
}

/**
 * Render Force HTTPS redirect block (special redirect module)
 * @param {string} domains - Space-separated domain names
 * @param {string} acmeWebroot - ACME challenge webroot path
 * @returns {string} - Complete redirect server block
 */
function renderForceHTTPSRedirect(domains, acmeWebroot) {
  let config = `# HTTP to HTTPS redirect\n`;
  config += `server {\n`;
  config += `    listen 80;\n`;
  config += `    listen [::]:80;\n`;
  config += `    server_name ${domains};\n`;
  config += `\n`;
  config += `    # ACME challenge for Let's Encrypt\n`;
  config += `    location /.well-known/acme-challenge/ {\n`;
  config += `        root ${acmeWebroot};\n`;
  config += `        allow all;\n`;
  config += `    }\n`;
  config += `\n`;
  config += `    # Redirect all other HTTP traffic to HTTPS\n`;
  config += `    location / {\n`;
  config += `        return 301 https://$server_name$request_uri;\n`;
  config += `    }\n`;
  config += `}\n\n`;

  return config;
}

/**
 * Render server-level modules (HSTS, Security Headers, HTTP/2, HTTP/3, etc.)
 * @param {Array} modules - Array of module objects with level property
 * @param {Object} proxyHost - Proxy configuration (unused, for future extensibility)
 * @returns {string} - Server-level module configuration
 */
function renderServerLevelModules(modules, proxyHost) {
  const serverModules = modules.filter(m => m.level === 'server');
  let config = '';

  for (const module of serverModules) {
    config += `    # Module: ${module.name}\n`;
    module.content.split('\n').forEach(line => {
      if (line.trim()) {
        config += `    ${line.trim()}\n`;
      }
    });
    config += `\n`;
  }

  return config;
}

/**
 * Render location-level modules (WebSocket, Brotli, Real IP, etc.)
 * @param {Array} modules - Array of module objects with level property
 * @param {Object} proxyHost - Proxy configuration (unused, for future extensibility)
 * @returns {string} - Location-level module configuration
 */
function renderLocationLevelModules(modules, proxyHost) {
  const locationModules = modules.filter(m => m.level === 'location');
  let config = '';

  // Skip Gzip Compression module as it's always enabled by default
  for (const module of locationModules.filter(m => m.name !== 'Gzip Compression')) {
    config += `        # Module: ${module.name}\n`;
    module.content.split('\n').forEach(line => {
      if (line.trim()) {
        config += `        ${line.trim()}\n`;
      }
    });
    config += `\n`;
  }

  return config;
}

/**
 * Generate nginx server block configuration
 */
function generateServerBlock(proxyHost, modules = [], db = null) {
  const domains = proxyHost.domain_names.split(',').map(d => d.trim()).join(' ');
  const upstreamUrl = `${proxyHost.forward_scheme}://${proxyHost.forward_host}:${proxyHost.forward_port}`;

  let config = `# Proxy: ${proxyHost.name}\n`;

  // Render Force HTTPS redirect module if present and SSL enabled
  const forceHTTPSModule = modules.find(m => m.level === 'redirect');
  if (proxyHost.ssl_enabled && forceHTTPSModule) {
    config += renderForceHTTPSRedirect(domains, ACME_WEBROOT);
  }

  // Main server block
  config += `server {\n`;

  // Listen directives (no hardcoded http2)
  config += generateListenDirectives(proxyHost, modules);
  config += `\n`;
  config += `    server_name ${domains};\n`;
  config += `\n`;

  // SSL configuration
  if (proxyHost.ssl_enabled && proxyHost.ssl_cert_id) {
    // SSL paths will be filled in by the API handler
    config += `    ssl_certificate {{SSL_CERT_PATH}};\n`;
    config += `    ssl_certificate_key {{SSL_KEY_PATH}};\n`;
    config += `    ssl_protocols TLSv1.2 TLSv1.3;\n`;
    config += `    ssl_ciphers HIGH:!aNULL:!MD5;\n`;
    config += `    ssl_prefer_server_ciphers on;\n`;
    config += `\n`;
  }

  // Security features
  if (db) {
    const { generateServerSecurityConfig } = require('./security-config-generator');
    config += generateServerSecurityConfig(db, proxyHost.id);

    // WAF features (ModSecurity)
    try {
      const { generateProxyWAFConfig } = require('./modsecurity-config-generator');
      config += generateProxyWAFConfig(db, proxyHost.id);
    } catch (error) {
      console.error('Error generating WAF config:', error.message);
    }
  }

  // Server-level modules (HSTS, Security Headers, HTTP/2, HTTP/3)
  config += renderServerLevelModules(modules, proxyHost);

  // ACME challenge location for Let's Encrypt certificate validation
  config += `    # ACME challenge for Let's Encrypt\n`;
  config += `    location /.well-known/acme-challenge/ {\n`;
  config += `        root ${ACME_WEBROOT};\n`;
  config += `        allow all;\n`;
  config += `    }\n`;
  config += `\n`;

  // Custom error pages (global)
  const { renderErrorPageDirectives } = require('./default-error-pages');
  config += renderErrorPageDirectives('    ');
  config += `\n`;

  // Location block
  config += `    location / {\n`;
  config += `        proxy_pass ${upstreamUrl};\n`;
  config += `        proxy_set_header Host $host;\n`;
  config += `        proxy_set_header X-Proxy-Target $server_name;\n`;

  // Only set default forwarding headers if Real IP module is not enabled
  const hasRealIPModule = modules.some(m => m.name === 'Real IP');
  if (!hasRealIPModule) {
    config += `        proxy_set_header X-Real-IP $remote_addr;\n`;
    config += `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n`;
    config += `        proxy_set_header X-Forwarded-Proto $scheme;\n`;
  }
  config += `\n`;

  // Security: Hide backend server information headers
  config += `        # Security: Remove information disclosure headers\n`;
  config += `        proxy_hide_header X-Powered-By;\n`;
  config += `        proxy_hide_header Server;\n`;
  config += `        proxy_hide_header X-AspNet-Version;\n`;
  config += `        proxy_hide_header X-AspNetMvc-Version;\n`;
  config += `        proxy_hide_header X-Generator;\n`;
  config += `        proxy_hide_header X-Runtime;\n`;
  config += `        proxy_hide_header X-Drupal-Cache;\n`;
  config += `        proxy_hide_header X-Drupal-Dynamic-Cache;\n`;
  config += `        proxy_hide_header X-Varnish;\n`;
  config += `        proxy_hide_header Via;\n`;
  config += `        proxy_hide_header X-Application-Context;\n`;
  config += `        proxy_hide_header X-Mod-Pagespeed;\n`;
  config += `        proxy_hide_header X-Page-Speed;\n`;
  config += `\n`;

  // Always enable Gzip compression (default for all hosts)
  config += `        # Gzip Compression (always enabled)\n`;
  config += `        gzip on;\n`;
  config += `        gzip_vary on;\n`;
  config += `        gzip_proxied any;\n`;
  config += `        gzip_comp_level 6;\n`;
  config += `        gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;\n`;
  config += `\n`;

  // Location-level modules (WebSocket, Brotli, Real IP, etc.)
  config += renderLocationLevelModules(modules, proxyHost);

  // Advanced config
  if (proxyHost.advanced_config) {
    proxyHost.advanced_config.split('\n').forEach(line => {
      if (line.trim()) {
        config += `        ${line.trim()}\n`;
      }
    });
  }

  config += `    }\n`;
  config += `}\n`;

  return config;
}

/**
 * Generate stream block configuration (for TCP/UDP proxying)
 */
function generateStreamBlock(proxyHost) {
  const upstreamName = `stream_${proxyHost.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const protocol = proxyHost.stream_protocol || 'tcp';
  const incomingPort = proxyHost.incoming_port || proxyHost.forward_port;

  let config = `# Stream: ${proxyHost.name} (${protocol.toUpperCase()})\n`;
  config += `upstream ${upstreamName} {\n`;
  config += `    server ${proxyHost.forward_host}:${proxyHost.forward_port};\n`;
  config += `}\n\n`;

  config += `server {\n`;
  config += `    listen ${incomingPort}${protocol === 'udp' ? ' udp' : ''};\n`;

  if (protocol === 'tcp') {
    config += `    listen [::]:${incomingPort};\n`;
  }

  config += `    proxy_pass ${upstreamName};\n`;

  if (proxyHost.advanced_config) {
    config += `\n`;
    proxyHost.advanced_config.split('\n').forEach(line => {
      if (line.trim()) {
        config += `    ${line.trim()}\n`;
      }
    });
  }

  config += `}\n`;

  return config;
}

/**
 * Generate 404 host configuration
 */
function generate404Block(proxyHost) {
  const domains = proxyHost.domain_names.split(',').map(d => d.trim()).join(' ');
  
  let config = `# 404 Host: ${proxyHost.name}\n`;
  config += `server {\n`;
  config += `    listen 80;\n`;
  config += `    listen [::]:80;\n`;
  
  if (proxyHost.ssl_enabled) {
    config += `    listen 443 ssl;\n`;
    config += `    listen [::]:443 ssl;\n`;
  }
  
  config += `\n`;
  config += `    server_name ${domains};\n`;
  config += `\n`;

  // ACME challenge location for Let's Encrypt certificate validation
  config += `    # ACME challenge for Let's Encrypt\n`;
  config += `    location /.well-known/acme-challenge/ {\n`;
  config += `        root ${ACME_WEBROOT};\n`;
  config += `        allow all;\n`;
  config += `    }\n`;
  config += `\n`;

  config += `    location / {\n`;
  config += `        return 404;\n`;
  config += `    }\n`;
  config += `}\n`;

  return config;
}

/**
 * Clean up old backup files for a specific config
 * Keeps only the most recent N backups
 */
function cleanupBackups(filename, keepCount = 3) {
  const configDir = getConfigDir();
  const configPath = path.join(configDir, filename);

  try {
    // Find all backup files for this config
    const backupPattern = `${filename}.backup.`;
    const allFiles = fs.readdirSync(configDir);

    const backupFiles = allFiles
      .filter(file => file.startsWith(backupPattern))
      .map(file => {
        const fullPath = path.join(configDir, file);
        const stats = fs.statSync(fullPath);
        return {
          name: file,
          path: fullPath,
          mtime: stats.mtime.getTime()
        };
      })
      .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first

    // Delete old backups (keep only the most recent N)
    if (backupFiles.length > keepCount) {
      const filesToDelete = backupFiles.slice(keepCount);
      filesToDelete.forEach(file => {
        try {
          fs.unlinkSync(file.path);
          console.log(`Cleaned up old backup: ${file.name}`);
        } catch (err) {
          console.error(`Failed to delete backup ${file.name}:`, err.message);
        }
      });
    }
  } catch (error) {
    console.error(`Error cleaning up backups for ${filename}:`, error.message);
  }
}

/**
 * Clean up old .deleted files older than specified days
 */
function cleanupDeletedFiles(daysOld = 7) {
  const configDir = getConfigDir();
  const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

  try {
    const allFiles = fs.readdirSync(configDir);
    const deletedFiles = allFiles.filter(file => file.includes('.deleted.'));

    deletedFiles.forEach(file => {
      const fullPath = path.join(configDir, file);
      const stats = fs.statSync(fullPath);

      if (stats.mtime.getTime() < cutoffTime) {
        try {
          fs.unlinkSync(fullPath);
          console.log(`Cleaned up old deleted file: ${file}`);
        } catch (err) {
          console.error(`Failed to delete ${file}:`, err.message);
        }
      }
    });
  } catch (error) {
    console.error('Error cleaning up deleted files:', error.message);
  }
}

/**
 * Write nginx configuration file
 */
function writeNginxConfig(filename, content) {
  const configDir = getConfigDir();

  // Create directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    console.warn(`Nginx config directory does not exist: ${configDir}`);
    console.warn('Creating directory...');
    fs.mkdirSync(configDir, { recursive: true });
  }

  const configPath = path.join(configDir, filename);

  // Create backup if file exists
  if (fs.existsSync(configPath)) {
    const backupPath = `${configPath}.backup.${Date.now()}`;
    fs.copyFileSync(configPath, backupPath);

    // Clean up old backups (keep only last 3)
    cleanupBackups(filename, 3);
  }

  fs.writeFileSync(configPath, content, 'utf8');
  return configPath;
}

/**
 * Read nginx configuration file
 */
function readNginxConfig(filename) {
  const configDir = getConfigDir();
  const configPath = path.join(configDir, filename);
  
  if (!fs.existsSync(configPath)) {
    return null;
  }
  
  return fs.readFileSync(configPath, 'utf8');
}

/**
 * Delete nginx configuration file
 */
function deleteNginxConfig(filename) {
  const configDir = getConfigDir();
  const configPath = path.join(configDir, filename);

  // Remove config file
  if (fs.existsSync(configPath)) {
    // Create backup before deleting
    const backupPath = `${configPath}.deleted.${Date.now()}`;
    fs.renameSync(configPath, backupPath);

    // Clean up old deleted files (older than 7 days)
    cleanupDeletedFiles(7);
  }
}

/**
 * Permanently delete nginx configuration file (for temporary test files)
 * This bypasses the safety rename and actually deletes the file
 */
function forceDeleteNginxConfig(filename) {
  const configDir = getConfigDir();
  const configPath = path.join(configDir, filename);

  // Actually delete the file
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

/**
 * Enable nginx configuration
 * In conf.d, configs are auto-loaded, so we just rename from .disabled to .conf
 */
function enableNginxConfig(filename) {
  const configDir = getConfigDir();
  
  // If file ends with .disabled, rename it to .conf
  const disabledPath = path.join(configDir, filename.replace('.conf', '.disabled'));
  const enabledPath = path.join(configDir, filename.endsWith('.conf') ? filename : filename + '.conf');
  
  if (fs.existsSync(disabledPath)) {
    fs.renameSync(disabledPath, enabledPath);
  } else if (!fs.existsSync(enabledPath)) {
    throw new Error(`Config file ${filename} does not exist`);
  }
}

/**
 * Disable nginx configuration
 * In conf.d, we rename .conf to .disabled so it's not loaded
 */
function disableNginxConfig(filename) {
  const configDir = getConfigDir();
  
  const enabledPath = path.join(configDir, filename);
  const disabledPath = path.join(configDir, filename.replace('.conf', '.disabled'));
  
  if (fs.existsSync(enabledPath)) {
    fs.renameSync(enabledPath, disabledPath);
  }
}

/**
 * Extract structured fields from nginx config for database storage
 * Parses the config to extract domain_names, forward info, SSL settings
 * @param {string} configContent - The nginx configuration content
 * @param {string} proxyType - The proxy type (reverse, stream, 404)
 * @returns {object} - Object with extracted fields
 */
function extractStructuredFields(configContent, proxyType) {
  const fields = {
    domain_names: 'N/A',
    forward_scheme: 'http',
    forward_host: 'N/A',
    forward_port: 0,
    ssl_enabled: 0,
    ssl_cert_id: null,
    ssl_cert_path: null,
    ssl_key_path: null
  };

  try {
    if (proxyType === 'stream') {
      // For stream proxies, extract from stream block
      const proxyPassMatch = configContent.match(/proxy_pass\s+([^:;]+):(\d+);/);
      if (proxyPassMatch) {
        fields.forward_host = proxyPassMatch[1].trim();
        fields.forward_port = parseInt(proxyPassMatch[2]);
      }
      
      const listenMatch = configContent.match(/listen\s+(\d+)/);
      if (listenMatch) {
        fields.incoming_port = parseInt(listenMatch[1]);
      }
      
      const protocolMatch = configContent.match(/listen\s+\d+\s+(udp|tcp)?/);
      fields.stream_protocol = protocolMatch ? protocolMatch[1] || 'tcp' : 'tcp';
      
      fields.domain_names = 'N/A'; // Streams don't use domains
      fields.ssl_enabled = 0; // Streams don't use SSL in nginx terms
    } else if (proxyType === '404') {
      // For 404 proxies, extract domains but no forward info
      const serverNameMatch = configContent.match(/server_name\s+([^;]+);/);
      if (serverNameMatch) {
        fields.domain_names = serverNameMatch[1].trim();
      }
      
      // Check if SSL is enabled (listen 443 ssl)
      const sslListenMatch = configContent.match(/listen\s+443\s+ssl/);
      fields.ssl_enabled = sslListenMatch ? 1 : 0;
      
      // Extract SSL certificate paths if present
      if (fields.ssl_enabled) {
        const certMatch = configContent.match(/ssl_certificate\s+([^;]+);/);
        const keyMatch = configContent.match(/ssl_certificate_key\s+([^;]+);/);
        if (certMatch) fields.ssl_cert_path = certMatch[1].trim();
        if (keyMatch) fields.ssl_key_path = keyMatch[1].trim();
      }
      
      // 404 proxies don't forward
      fields.forward_host = 'N/A';
      fields.forward_port = 0;
    } else {
      // For reverse proxies, extract all fields
      const serverNameMatch = configContent.match(/server_name\s+([^;]+);/);
      if (serverNameMatch) {
        fields.domain_names = serverNameMatch[1].trim();
      }
      
      // Extract proxy_pass to get forward info
      const proxyPassMatch = configContent.match(/proxy_pass\s+(https?):\/\/([^:;\/]+):?(\d+)?[^;]*;/);
      if (proxyPassMatch) {
        fields.forward_scheme = proxyPassMatch[1];
        fields.forward_host = proxyPassMatch[2];
        fields.forward_port = proxyPassMatch[3] ? parseInt(proxyPassMatch[3]) : (proxyPassMatch[1] === 'https' ? 443 : 80);
      }
      
      // Check if SSL is enabled (listen 443 ssl)
      const sslListenMatch = configContent.match(/listen\s+443\s+ssl/);
      fields.ssl_enabled = sslListenMatch ? 1 : 0;
      
      // Extract SSL certificate paths if present
      if (fields.ssl_enabled) {
        const certMatch = configContent.match(/ssl_certificate\s+([^;]+);/);
        const keyMatch = configContent.match(/ssl_certificate_key\s+([^;]+);/);
        if (certMatch) fields.ssl_cert_path = certMatch[1].trim();
        if (keyMatch) fields.ssl_key_path = keyMatch[1].trim();
      }
    }
  } catch (error) {
    console.error('Error extracting structured fields from config:', error);
    // Return defaults on error
  }

  return fields;
}

/**
 * Find certificate ID by matching cert/key paths
 * @param {object} db - Database instance
 * @param {string} certPath - Certificate file path
 * @param {string} keyPath - Key file path
 * @returns {number|null} - Certificate ID or null if not found
 */
function findCertificateByPaths(db, certPath, keyPath) {
  if (!certPath || !keyPath) return null;
  
  try {
    const cert = db.prepare(`
      SELECT id FROM ssl_certificates 
      WHERE cert_path = ? AND key_path = ?
    `).get(certPath, keyPath);
    
    return cert ? cert.id : null;
  } catch (error) {
    console.error('Error finding certificate by paths:', error);
    return null;
  }
}

module.exports = {
  parseNginxConfig,
  extractDirective,
  extractDirectives,
  extractLocations,
  extractStructuredFields,
  findCertificateByPaths,
  generateServerBlock,
  generateStreamBlock,
  generate404Block,
  writeNginxConfig,
  readNginxConfig,
  deleteNginxConfig,
  forceDeleteNginxConfig,
  enableNginxConfig,
  disableNginxConfig,
  sanitizeFilename,
  cleanupBackups,
  cleanupDeletedFiles
};
