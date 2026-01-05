require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { handleAPI } = require('./routes/api');

const PORT = process.env.PORT || 3000;
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
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
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
});

// Start server
server.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('           🎵 Nginx Proxy Orchestra Started 🎵            ');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  🌐 Server running at: http://localhost:${PORT}`);
  console.log(`  📁 Public directory: ${PUBLIC_DIR}`);
  console.log(`  🗄️  Database: ${process.env.DB_PATH || './data/database.sqlite'}`);
  console.log(`  🔧 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
