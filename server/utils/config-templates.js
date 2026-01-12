/**
 * Config Templates Utility
 *
 * Generates nginx configuration templates for new proxies
 * Templates include all required features (gzip, ACME challenge, security)
 * with placeholder values and helpful comments
 */

const ACME_WEBROOT = '/var/www/certbot';

/**
 * Generate a reverse proxy template
 */
function generateReverseProxyTemplate(name, options = {}) {
  const proxyName = name || 'New Proxy';

  let config = `# Proxy: ${proxyName}\n`;
  config += `# Edit the values below to match your requirements\n\n`;

  // Force HTTPS redirect if SSL enabled
  if (options.ssl_enabled) {
    config += `# HTTP to HTTPS redirect\n`;
    config += `server {\n`;
    config += `    listen 80;\n`;
    config += `    listen [::]:80;\n`;
    config += `    server_name example.com www.example.com;  # Change to your domain(s)\n`;
    config += `\n`;
    config += `    # ACME challenge for Let's Encrypt\n`;
    config += `    location /.well-known/acme-challenge/ {\n`;
    config += `        root ${ACME_WEBROOT};\n`;
    config += `        allow all;\n`;
    config += `    }\n`;
    config += `\n`;
    config += `    location / {\n`;
    config += `        return 301 https://$server_name$request_uri;\n`;
    config += `    }\n`;
    config += `}\n\n`;
  }

  // Main server block
  config += `# Main server block\n`;
  config += `server {\n`;

  // Listen directives
  if (options.ssl_enabled) {
    config += `    listen 443 ssl;\n`;
    config += `    listen [::]:443 ssl;\n`;
  } else {
    config += `    listen 80;\n`;
    config += `    listen [::]:80;\n`;
  }

  config += `\n`;
  config += `    server_name example.com www.example.com;  # Change to your domain(s)\n`;
  config += `\n`;

  // SSL configuration
  if (options.ssl_enabled) {
    config += `    # SSL Certificate (these paths will be filled in automatically after selecting a certificate)\n`;
    config += `    ssl_certificate {{SSL_CERT_PATH}};\n`;
    config += `    ssl_certificate_key {{SSL_KEY_PATH}};\n`;
    config += `    ssl_protocols TLSv1.2 TLSv1.3;\n`;
    config += `    ssl_ciphers HIGH:!aNULL:!MD5;\n`;
    config += `    ssl_prefer_server_ciphers on;\n`;
    config += `\n`;
  }

  // ModSecurity placeholder
  if (options.waf_enabled) {
    config += `    # ModSecurity WAF (will be configured based on selected profile)\n`;
    config += `    modsecurity on;\n`;
    config += `    modsecurity_rules_file /etc/nginx/modsec/main.conf;\n`;
    config += `\n`;
  }

  // ACME challenge location
  config += `    # ACME challenge for Let's Encrypt\n`;
  config += `    location /.well-known/acme-challenge/ {\n`;
  config += `        root ${ACME_WEBROOT};\n`;
  config += `        allow all;\n`;
  config += `    }\n`;
  config += `\n`;

  // Main location block
  config += `    location / {\n`;
  config += `        # Backend proxy configuration\n`;
  config += `        proxy_pass http://localhost:8080;  # Change to your backend host:port\n`;
  config += `        proxy_set_header Host $host;\n`;
  config += `        proxy_set_header X-Proxy-Target $server_name;\n`;
  config += `        proxy_set_header X-Real-IP $remote_addr;\n`;
  config += `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n`;
  config += `        proxy_set_header X-Forwarded-Proto $scheme;\n`;
  config += `\n`;

  // Information disclosure protection
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

  // Gzip compression (always enabled)
  config += `        # Gzip Compression (always enabled)\n`;
  config += `        gzip on;\n`;
  config += `        gzip_vary on;\n`;
  config += `        gzip_proxied any;\n`;
  config += `        gzip_comp_level 6;\n`;
  config += `        gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;\n`;
  config += `\n`;

  config += `        # Add your custom directives here\n`;
  config += `    }\n`;
  config += `}\n`;

  return config;
}

/**
 * Generate a stream (TCP/UDP) proxy template
 */
function generateStreamProxyTemplate(name, options = {}) {
  const proxyName = name || 'New Stream';
  const safeName = proxyName.replace(/[^a-zA-Z0-9]/g, '_');
  const protocol = options.protocol || 'tcp';

  let config = `# Stream: ${proxyName} (${protocol.toUpperCase()})\n`;
  config += `# TCP/UDP port forwarding configuration\n\n`;

  config += `upstream stream_${safeName} {\n`;
  config += `    server localhost:3306;  # Change to your backend host:port\n`;
  config += `}\n\n`;

  config += `server {\n`;
  config += `    listen 3306${protocol === 'udp' ? ' udp' : ''};  # Change to your listening port\n`;

  if (protocol === 'tcp') {
    config += `    listen [::]:3306;\n`;
  }

  config += `    proxy_pass stream_${safeName};\n`;
  config += `\n`;
  config += `    # Optional TCP-specific directives:\n`;
  config += `    # proxy_connect_timeout 1s;\n`;
  config += `    # proxy_timeout 3m;\n`;
  config += `    # proxy_buffer_size 16k;\n`;
  config += `}\n`;

  return config;
}

/**
 * Generate a 404 host template
 */
function generate404Template(name, options = {}) {
  const proxyName = name || 'New 404 Host';

  let config = `# 404 Host: ${proxyName}\n`;
  config += `# Returns 404 for specified domains\n\n`;

  config += `server {\n`;
  config += `    listen 80;\n`;
  config += `    listen [::]:80;\n`;

  if (options.ssl_enabled) {
    config += `    listen 443 ssl;\n`;
    config += `    listen [::]:443 ssl;\n`;
    config += `\n`;
    config += `    # SSL Certificate (these paths will be filled in automatically)\n`;
    config += `    ssl_certificate {{SSL_CERT_PATH}};\n`;
    config += `    ssl_certificate_key {{SSL_KEY_PATH}};\n`;
    config += `    ssl_protocols TLSv1.2 TLSv1.3;\n`;
  }

  config += `\n`;
  config += `    server_name example.com www.example.com;  # Change to your domain(s)\n`;
  config += `\n`;

  // ACME challenge location
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
 * Get template for proxy type
 */
function getTemplateForType(type, name, options = {}) {
  switch (type) {
    case 'reverse':
      return generateReverseProxyTemplate(name, options);
    case 'stream':
      return generateStreamProxyTemplate(name, options);
    case '404':
      return generate404Template(name, options);
    default:
      throw new Error(`Unknown proxy type: ${type}`);
  }
}

module.exports = {
  generateReverseProxyTemplate,
  generateStreamProxyTemplate,
  generate404Template,
  getTemplateForType
};
