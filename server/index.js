require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');
const { handleAPI } = require('./routes/index');
const { initializeDefaultServer } = require('./utils/default-server');
const { ensureAdminCert, getActiveCertPaths } = require('./utils/admin-cert');
const { initializeACMEWebroot } = require('./utils/acme-setup');
const { db, getSetting } = require('./db');
const { getWAFLogParser } = require('./utils/waf-log-parser');
const { initializeCache: initializeSystemMetricsCache } = require('./utils/system-metrics');
const { startMetricsCollection } = require('./utils/metrics-logger');
const { initializeHealthChecks } = require('./utils/health-check-service');

// Initialize ACME webroot for Let's Encrypt challenges
initializeACMEWebroot();

// Initialize default catch-all server configuration
initializeDefaultServer();

// Ensure admin certificate exists (generate self-signed if needed)
ensureAdminCert();

// Initialize system metrics cache
initializeSystemMetricsCache();

// Start metrics collection service
startMetricsCollection();

// Initialize upstream health check service
initializeHealthChecks();

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
  '.woff2': 'font/woff2',
  '.md': 'text/plain'
};

// Serve static files
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
    
    if (ext === '.html') { // Define CSP, all files are internal except jsdelivr (Chart.js)
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://cdn.jsdelivr.net;");
    }

    res.writeHead(200);
    res.end(data);
  });
}

// Main request handler
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

  // Special route for README.md (serve from project root)
  if (pathname === '/README.md') {
    const readmePath = path.join(__dirname, '..', 'README.md');
    return fs.readFile(readmePath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.writeHead(200);
      res.end(data);
    });
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
  console.log('               Nginx Proxy Orchestra Started               ');
  console.log('');
  console.log(`     HTTPS server running at: https://localhost:${HTTPS_PORT}`);
  console.log(`     Public directory: ${PUBLIC_DIR}`);
  console.log(`      Database: ${process.env.DB_PATH || './data/database.sqlite'}`);
  console.log(`     Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log('');
  if (!certPaths.isCustom) {
    console.log('  ⚠️  Using self-signed certificate (browser will show warning)');
    console.log('     Configure a trusted certificate in Settings');
  } else {
    console.log('     Using custom TLS certificate');
  }

  // Load nginx module information at startup
  const { loadModuleInfo } = require('./utils/nginx-ops');
  loadModuleInfo();

  // Start statistics cache service
  const { startCacheRefresh } = require('./utils/stats-cache-service');
  startCacheRefresh();

  // Initialize WAF events database and start batcher
  const { initializeWAFDatabase, batcher, startCleanupJob: startWAFCleanup } = require('./waf-db');
  initializeWAFDatabase();
  batcher.start();
  startWAFCleanup();

  // Start WAF log parser daemon
  const wafLogParser = getWAFLogParser();

  // Configure WAF log parser to broadcast events via SSE
  const { broadcastWAFEvent } = require('./routes/shared/sse');
  wafLogParser.setBroadcastFunction(broadcastWAFEvent);

  wafLogParser.start().catch(err => {
    console.error('Failed to start WAF log parser:', err.message);
  });

  // Start enhanced notification scheduler
  const { initializeNotificationScheduler } = require('./utils/notification-scheduler');
  initializeNotificationScheduler();

  // Start ban system services
  const wafEnabled = getSetting('waf_enabled');
  if (wafEnabled === '1') {
    try {
      const { startDetectionEngine, startCleanupJob } = require('./utils/detection-engine');
      const { getBanQueue } = require('./utils/ban-queue');
      const { getBanSyncService } = require('./utils/ban-sync-service');

      // Start detection engine (polls WAF events every 5 seconds)
      startDetectionEngine();
      startCleanupJob();
      console.log('Detection engine started');

      // Start ban queue processor (processes every 5 seconds)
      const banQueue = getBanQueue();
      banQueue.start();
      console.log('Ban queue processor started');

      // Start ban synchronization service (syncs every 60 seconds)
      const banSyncService = getBanSyncService();
      banSyncService.start();
      console.log('Ban synchronization service started');

      console.log('Ban system services started');
    } catch (error) {
      console.error('Failed to start ban system:', error.message);
    }
  }
});

// Graceful shutdown
let isShuttingDown = false;

function shutdown(signal) {
  // If already shutting down, force exit on second signal
  if (isShuttingDown) {
    console.log('\nForce shutting down...');
    process.exit(1);
  }

  isShuttingDown = true;
  console.log('\nShutting down gracefully...');

  // Set a timeout to force exit if graceful shutdown takes too long
  const forceExitTimeout = setTimeout(() => {
    console.log('Server did not close in time, forcing exit...');
    process.exit(1);
  }, 5000); // 5 second timeout

  server.close(async () => {
    clearTimeout(forceExitTimeout);
    console.log('HTTPS server closed');

    // Stop statistics cache service
    try {
      const { stopCacheRefresh } = require('./utils/stats-cache-service');
      stopCacheRefresh();
    } catch (err) {
      console.error('Error stopping stats cache:', err.message);
    }

    // Stop WAF event batcher
    try {
      const { batcher } = require('./waf-db');
      batcher.stop();
      console.log('✓ WAF event batcher flushed and stopped');
    } catch (err) {
      console.error('Error stopping WAF batcher:', err.message);
    }

    // Stop WAF log parser
    try {
      const wafLogParser = getWAFLogParser();
      await wafLogParser.stop();
    } catch (err) {
      console.error('Error stopping WAF log parser:', err.message);
    }

    // Stop ban system services
    try {
      const { stopDetectionEngine } = require('./utils/detection-engine');
      const { getBanQueue } = require('./utils/ban-queue');
      const { getBanSyncService } = require('./utils/ban-sync-service');

      stopDetectionEngine();
      const banQueue = getBanQueue();
      banQueue.stop();
      const banSyncService = getBanSyncService();
      banSyncService.stop();
      console.log('✓ Ban system stopped');
    } catch (err) {
      console.error('Error stopping ban system:', err.message);
    }

    // Stop health check service
    try {
      const { cleanup } = require('./utils/health-check-service');
      cleanup();
      console.log('✓ Health check service stopped');
    } catch (err) {
      console.error('Error stopping health check service:', err.message);
    }

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
