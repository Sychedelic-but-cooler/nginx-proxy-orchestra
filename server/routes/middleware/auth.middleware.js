/**
 * Authentication middleware for protected routes
 */

const { verifyToken, extractToken } = require('../../auth');
const { sendJSON } = require('../shared/utils');

/**
 * Middleware to require authentication for protected routes
 * Extracts JWT token from Authorization header and verifies it
 * Attaches user information to req.user if valid
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {Function} next - Callback to invoke if authentication succeeds
 * @returns {void}
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = extractToken(authHeader);
  const user = verifyToken(token);

  if (!user) {
    return sendJSON(res, { error: 'Unauthorized' }, 401);
  }

  // Attach user info to request for downstream handlers
  req.user = user;

  next();
}

/**
 * Flexible authentication for routes that support multiple auth methods
 * Supports both Authorization header and query parameter token (for EventSource/SSE)
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object with query parameters
 * @returns {Object} Authentication result with { authenticated: boolean, user: Object }
 */
function requireAuthFlexible(req, res, parsedUrl) {
  const authHeader = req.headers.authorization;
  let token = extractToken(authHeader);

  // If no token in header, check query parameter
  // EventSource doesn't support custom headers, so we accept token via query param
  if (!token) {
    token = parsedUrl.searchParams.get('token');
  }

  const user = verifyToken(token);

  if (!user) {
    sendJSON(res, { error: 'Unauthorized' }, 401);
    return { authenticated: false, user: null };
  }

  // Return authentication result
  return { authenticated: true, user };
}

module.exports = {
  requireAuth,
  requireAuthFlexible
};
