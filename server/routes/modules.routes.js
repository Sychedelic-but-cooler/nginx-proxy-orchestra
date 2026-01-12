/**
 * Modules routes
 * Manages configuration modules (reusable nginx config snippets)
 */

const { db, logAudit } = require('../db');
const { parseBody, sendJSON, getClientIP } = require('./shared/utils');

/**
 * Handle module-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleModuleRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/modules' && method === 'GET') {
    return handleGetModules(req, res);
  }

  if (pathname === '/api/modules' && method === 'POST') {
    return handleCreateModule(req, res);
  }

  if (pathname.match(/^\/api\/modules\/\d+$/) && method === 'PUT') {
    return handleUpdateModule(req, res, parsedUrl);
  }

  if (pathname.match(/^\/api\/modules\/\d+$/) && method === 'DELETE') {
    return handleDeleteModule(req, res, parsedUrl);
  }

  if (pathname === '/api/modules/snippets' && method === 'GET') {
    return handleGetModuleSnippets(req, res);
  }

  if (pathname === '/api/modules/migrate-compression' && method === 'POST') {
    return handleMigrateCompressionModules(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get all modules
 * Returns list of all configuration modules
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetModules(req, res) {
  const modules = db.prepare('SELECT * FROM modules ORDER BY name ASC').all();
  sendJSON(res, modules);
}

/**
 * Create module
 * Creates a new configuration module
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleCreateModule(req, res) {
  const body = await parseBody(req);
  const { name, description, content, tag } = body;

  if (!name || !content) {
    return sendJSON(res, { error: 'Name and content required' }, 400);
  }

  try {
    const result = db.prepare('INSERT INTO modules (name, description, content, tag) VALUES (?, ?, ?, ?)').run(name, description || null, content, tag || 'General');
    logAudit(req.user.userId, 'create', 'module', result.lastInsertRowid, JSON.stringify({ name }), getClientIP(req));
    sendJSON(res, { success: true, id: result.lastInsertRowid }, 201);
  } catch (error) {
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Update module
 * Updates an existing configuration module
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with ID parameter
 */
async function handleUpdateModule(req, res, parsedUrl) {
  const id = parseInt(parsedUrl.pathname.split('/')[3]);
  const body = await parseBody(req);
  const { name, description, content, tag } = body;

  const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(id);
  if (!module) {
    return sendJSON(res, { error: 'Module not found' }, 404);
  }

  try {
    db.prepare('UPDATE modules SET name = ?, description = ?, content = ?, tag = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(name || module.name, description !== undefined ? description : module.description, content || module.content, tag !== undefined ? tag : module.tag, id);

    logAudit(req.user.userId, 'update', 'module', id, JSON.stringify({ name: name || module.name, changes: body }), getClientIP(req));
    sendJSON(res, { success: true });
  } catch (error) {
    sendJSON(res, { error: error.message }, 500);
  }
}

/**
 * Delete module
 * Deletes a configuration module
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with ID parameter
 */
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

/**
 * Get module snippets
 * Returns modules grouped by level (server, location, redirect)
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetModuleSnippets(req, res) {
  // Get all modules except Gzip Compression (always enabled)
  const modules = db.prepare(`
    SELECT id, name, description, content, level, tag
    FROM modules
    WHERE name != 'Gzip Compression'
    ORDER BY tag, name
  `).all();

  // Group by tag
  const grouped = {};
  for (const module of modules) {
    const moduleTag = module.tag || 'General';
    if (!grouped[moduleTag]) {
      grouped[moduleTag] = [];
    }
    grouped[moduleTag].push(module);
  }

  sendJSON(res, grouped);
}

/**
 * Migrate compression modules
 * Adds or updates compression-related modules (Gzip, Brotli, HTTP/3)
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
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

module.exports = handleModuleRoutes;
