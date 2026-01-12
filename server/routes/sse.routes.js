/**
 * Server-Sent Events (SSE) routes
 * Provides real-time event streaming for WAF and ban events
 */

const { verifyToken, extractToken } = require('../auth');
const { addClient } = require('./shared/sse');

/**
 * Handle SSE streaming routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
function handleSSERoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/waf/events/stream' && method === 'GET') {
    return handleWAFEventsStream(req, res, parsedUrl);
  }

  if (pathname === '/api/ban/events/stream' && method === 'GET') {
    return handleBanEventsStream(req, res, parsedUrl);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

/**
 * Handle WAF events SSE stream
 * Provides real-time streaming of WAF events
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
function handleWAFEventsStream(req, res, parsedUrl) {
  // Verify authentication - check both Authorization header and query parameter
  // EventSource doesn't support custom headers, so we accept token via query param
  const authHeader = req.headers.authorization;
  let token = extractToken(authHeader);

  // If no token in header, check query parameter
  if (!token) {
    token = parsedUrl.searchParams.get('token');
  }

  console.log('[SSE WAF] Token received:', token ? 'Yes (length: ' + token.length + ')' : 'No');

  const user = verifyToken(token);

  console.log('[SSE WAF] User verified:', user ? 'Yes (user: ' + user.username + ')' : 'No');

  if (!user) {
    console.log('[SSE WAF] Authentication failed - sending 401');
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Unauthorized');
    return;
  }

  // Add client to SSE manager
  const clientId = addClient(req, res, user, { eventType: 'waf' });
  console.log(`[SSE WAF] Client ${clientId} connected (user: ${user.username})`);
}

/**
 * Handle ban events SSE stream
 * Provides real-time streaming of ban events
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
function handleBanEventsStream(req, res, parsedUrl) {
  // Verify authentication - check both Authorization header and query parameter
  // EventSource doesn't support custom headers, so we accept token via query param
  const authHeader = req.headers.authorization;
  let token = extractToken(authHeader);

  // If no token in header, check query parameter
  if (!token) {
    token = parsedUrl.searchParams.get('token');
  }

  console.log('[SSE Ban] Token received:', token ? 'Yes (length: ' + token.length + ')' : 'No');

  const user = verifyToken(token);

  console.log('[SSE Ban] User verified:', user ? 'Yes (user: ' + user.username + ')' : 'No');

  if (!user) {
    console.log('[SSE Ban] Authentication failed - sending 401');
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Unauthorized');
    return;
  }

  // Add client to SSE manager
  const clientId = sseManager.addClient(req, res, user, { eventType: 'ban' });
  console.log(`[SSE Ban] Client ${clientId} connected (user: ${user.username})`);
}

module.exports = handleSSERoutes;
