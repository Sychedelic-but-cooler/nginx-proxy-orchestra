require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');
const { handleAPI } = require('./routes/api');
const { initializeDefaultServer } = require('./utils/default-server');
const { ensureAdminCert, getActiveCertPaths } = require('./utils/admin-cert');
const { initializeACMEWebroot } = require('./utils/acme-setup');
const { db } = require('./db');

// Initialize ACME webroot for Let's Encrypt challenges
initializeACMEWebroot();

// Initialize default catch-all server configuration
initializeDefaultServer();

// Ensure admin certificate exists (generate self-signed if needed)
ensureAdminCert();

const HTTPS_PORT = process.env.PORT || 81;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

/**
 * Serve static files
 */
function serveStatic(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Security headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    if (ext === '.html') {
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
    }

    res.writeHead(200);
    res.end(data);
  });
}

/**
 * Main request handler
 */
function requestHandler(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Log requests in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`${req.method} ${pathname}`);
  }

  // API routes
  if (pathname.startsWith('/api/')) {
    return handleAPI(req, res, parsedUrl);
  }

  // Static file routes
  let filePath;

  if (pathname === '/') {
    filePath = path.join(PUBLIC_DIR, 'login.html');
  } else if (pathname === '/app') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  } else {
    // Remove any directory traversal attempts
    const safePath = pathname.replace(/^(\.)+/, '');
    filePath = path.join(PUBLIC_DIR, safePath);
  }

  // Prevent directory traversal
  const resolvedPath = path.resolve(filePath);
  const resolvedPublicDir = path.resolve(PUBLIC_DIR);

  if (!resolvedPath.startsWith(resolvedPublicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  // Check if file exists
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // For SPA routing, serve index.html for unknown routes (except API)
      if (!pathname.startsWith('/api/') && !path.extname(pathname)) {
        filePath = path.join(PUBLIC_DIR, 'index.html');
        return serveStatic(req, res, filePath);
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    serveStatic(req, res, filePath);
  });
}

// Get admin certificate paths
const certPaths = getActiveCertPaths(db);

// HTTPS server (main application)
const httpsOptions = {
  key: fs.readFileSync(certPaths.key),
  cert: fs.readFileSync(certPaths.cert)
};

const server = https.createServer(httpsOptions, requestHandler);

// Start server
server.listen(HTTPS_PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('           🎵 Nginx Proxy Orchestra Started 🎵            ');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  🔒 HTTPS server running at: https://localhost:${HTTPS_PORT}`);
  console.log(`  📁 Public directory: ${PUBLIC_DIR}`);
  console.log(`  🗄️  Database: ${process.env.DB_PATH || './data/database.sqlite'}`);
  console.log(`  🔧 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log('');
  if (!certPaths.isCustom) {
    console.log('  ⚠️  Using self-signed certificate (browser will show warning)');
    console.log('     Configure a trusted certificate in Settings');
  } else {
    console.log('  ✅ Using custom TLS certificate');
  }
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
});

// Graceful shutdown
let isShuttingDown = false;

function shutdown(signal) {
  // If already shutting down, force exit on second signal
  if (isShuttingDown) {
    console.log('\n⚠️  Force shutting down...');
    process.exit(1);
  }

  isShuttingDown = true;
  console.log('\nShutting down gracefully...');

  // Set a timeout to force exit if graceful shutdown takes too long
  const forceExitTimeout = setTimeout(() => {
    console.log('Server did not close in time, forcing exit...');
    process.exit(1);
  }, 5000); // 5 second timeout

  server.close(() => {
    clearTimeout(forceExitTimeout);
    console.log('HTTPS server closed');

    // Close database connection
    try {
      db.close();
      console.log('Database connection closed');
    } catch (err) {
      console.error('Error closing database:', err.message);
    }

    process.exit(0);
  });

  // Force close any existing connections
  server.closeAllConnections?.();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
