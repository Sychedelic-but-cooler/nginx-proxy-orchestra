const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
 * Generate nginx server block configuration
 */
function generateServerBlock(proxyHost, modules = []) {
  const domains = proxyHost.domain_names.split(',').map(d => d.trim()).join(' ');
  const upstreamUrl = `${proxyHost.forward_scheme}://${proxyHost.forward_host}:${proxyHost.forward_port}`;
  
  let config = `# Proxy: ${proxyHost.name}\n`;
  config += `server {\n`;
  
  // Listen directives
  if (proxyHost.ssl_enabled) {
    config += `    listen 443 ssl http2;\n`;
    config += `    listen [::]:443 ssl http2;\n`;
  } else {
    config += `    listen 80;\n`;
    config += `    listen [::]:80;\n`;
  }
  
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
  
  // Include modules
  for (const module of modules) {
    config += `    # Module: ${module.name}\n`;
    module.content.split('\n').forEach(line => {
      if (line.trim()) {
        config += `    ${line.trim()}\n`;
      }
    });
    config += `\n`;
  }
  
  // Location block
  config += `    location / {\n`;
  config += `        proxy_pass ${upstreamUrl};\n`;
  config += `        proxy_set_header Host $host;\n`;
  config += `        proxy_set_header X-Real-IP $remote_addr;\n`;
  config += `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n`;
  config += `        proxy_set_header X-Forwarded-Proto $scheme;\n`;
  
  // Advanced config
  if (proxyHost.advanced_config) {
    config += `\n`;
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
  
  let config = `# Stream: ${proxyHost.name}\n`;
  config += `upstream ${upstreamName} {\n`;
  config += `    server ${proxyHost.forward_host}:${proxyHost.forward_port};\n`;
  config += `}\n\n`;
  
  config += `server {\n`;
  config += `    listen ${proxyHost.forward_port};\n`;
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
    config += `    listen 443 ssl http2;\n`;
    config += `    listen [::]:443 ssl http2;\n`;
  }
  
  config += `\n`;
  config += `    server_name ${domains};\n`;
  config += `\n`;
  config += `    return 404;\n`;
  config += `}\n`;
  
  return config;
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

module.exports = {
  parseNginxConfig,
  extractDirective,
  extractDirectives,
  extractLocations,
  generateServerBlock,
  generateStreamBlock,
  generate404Block,
  writeNginxConfig,
  readNginxConfig,
  deleteNginxConfig,
  enableNginxConfig,
  disableNginxConfig,
  sanitizeFilename
};
