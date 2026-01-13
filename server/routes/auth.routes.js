/**
 * Authentication routes
 * Handles user login, logout, and password management
 */

const { db, logAudit } = require('../db');
const { parseBody, sendJSON, getClientIP } = require('./shared/utils');
const {
  generateToken,
  checkRateLimit,
  verifyPassword,
  hashPassword,
  revokeSession,
  revokeAllUserSessions
} = require('../auth');

/**
 * Handle authentication-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleAuthRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/login' && method === 'POST') {
    return handleLogin(req, res);
  }

  if (pathname === '/api/logout' && method === 'POST') {
    return handleLogout(req, res);
  }

  if (pathname === '/api/user/password' && method === 'POST') {
    return handleChangePassword(req, res);
  }

  if (pathname === '/api/user/sse-token' && method === 'POST') {
    return handleGenerateSSEToken(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Handle user login
 * Validates credentials and returns JWT token
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleLogin(req, res) {
  const ip = getClientIP(req);
  const rateLimit = checkRateLimit(ip);

  if (!rateLimit.allowed) {
    return sendJSON(res, {
      error: `Too many login attempts. Try again in ${rateLimit.retryAfter} seconds.`
    }, 429);
  }

  const body = await parseBody(req);
  const { username, password } = body;

  if (!username || !password) {
    return sendJSON(res, { error: 'Username and password required' }, 400);
  }

  // Get user from database
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !(await verifyPassword(password, user.password))) {
    return sendJSON(res, { error: 'Invalid credentials' }, 401);
  }

  // Generate JWT token with session tracking
  const userAgent = req.headers['user-agent'] || null;
  const token = generateToken(user.id, user.username, {
    type: 'user',
    userAgent,
    ipAddress: ip
  });

  logAudit(user.id, 'login', 'user', user.id, null, ip);

  // Auto-whitelist admin IPs for safety
  try {
    const { autoWhitelistAdmin } = require('../utils/ip-utils');
    autoWhitelistAdmin(ip, user.id);
  } catch (error) {
    console.error('Failed to auto-whitelist admin IP:', error.message);
    // Don't block login if whitelist fails
  }

  sendJSON(res, {
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  });
}

/**
 * Handle user logout
 * Revokes the current session token
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleLogout(req, res) {
  // Revoke the current session
  if (req.user && req.user.jti) {
    revokeSession(req.user.jti, req.user.userId);
    logAudit(req.user.userId, 'logout', 'user', req.user.userId, null, getClientIP(req));
  }

  sendJSON(res, { success: true });
}

/**
 * Handle password change
 * Validates current password and updates to new password
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleChangePassword(req, res) {
  const body = await parseBody(req);
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return sendJSON(res, { error: 'Current and new password required' }, 400);
  }

  if (newPassword.length < 8) {
    return sendJSON(res, { error: 'New password must be at least 8 characters' }, 400);
  }

  try {
    // Get current user from database
    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.userId);

    if (!user) {
      return sendJSON(res, { error: 'User not found' }, 404);
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.password);
    if (!isValid) {
      return sendJSON(res, { error: 'Current password is incorrect' }, 400);
    }

    // Hash new password and update
    const newHash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, req.user.userId);

    // Revoke all other sessions except current one (force re-login on other devices)
    const currentTokenId = req.user.jti;
    const revokedCount = revokeAllUserSessions(req.user.userId, req.user.userId, currentTokenId);
    
    logAudit(req.user.userId, 'change_password', 'user', req.user.userId, 
      `Password changed, ${revokedCount} other sessions revoked`, getClientIP(req));
    
    sendJSON(res, { 
      success: true,
      message: revokedCount > 0 
        ? `Password changed successfully. ${revokedCount} other session(s) have been logged out.`
        : 'Password changed successfully.'
    });
  } catch (error) {
    console.error('Change password error:', error);
    sendJSON(res, { error: error.message || 'Failed to change password' }, 500);
  }
}

/**
 * Generate SSE token
 * Creates a short-lived token for Server-Sent Events connections
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGenerateSSEToken(req, res) {
  if (!req.user) {
    return sendJSON(res, { error: 'Unauthorized' }, 401);
  }

  const ip = getClientIP(req);
  const userAgent = req.headers['user-agent'] || null;
  
  // Generate short-lived SSE token (1 hour)
  const sseToken = generateToken(req.user.userId, req.user.username, {
    type: 'sse',
    userAgent,
    ipAddress: ip
  });

  logAudit(req.user.userId, 'generate_sse_token', 'session', null, null, ip);

  sendJSON(res, {
    success: true,
    token: sseToken,
    expiresIn: 3600 // 1 hour in seconds
  });
}

module.exports = handleAuthRoutes;
