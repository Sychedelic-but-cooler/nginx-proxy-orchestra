/**
 * Authentication routes
 * Handles user login, logout, and password management
 */

const crypto = require('crypto');
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
const handleTOTPRoutes = require('./totp.routes');
const { decrypt, authenticator } = handleTOTPRoutes;
const { verifyTOTPIfEnabled } = require('./middleware/totp.middleware');

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

  if (pathname === '/api/login/totp' && method === 'POST') {
    return handleTOTPLogin(req, res);
  }

  if (pathname === '/api/login/recovery' && method === 'POST') {
    return handleRecoveryLogin(req, res);
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
    // Increment failed login attempts
    if (user) {
      const currentAttempts = user.failed_login_attempts || 0;
      db.prepare(`
        UPDATE users 
        SET failed_login_attempts = ?, last_failed_login = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(currentAttempts + 1, user.id);
    }
    
    return sendJSON(res, { 
      error: 'Invalid credentials',
      // Return failed attempt count for showing recovery option
      failedAttempts: user ? (user.failed_login_attempts || 0) + 1 : 0
    }, 401);
  }

  // Check if 2FA is enabled
  if (user.totp_enabled) {
    // Generate temporary token for TOTP verification (valid for 5 minutes)
    const tempToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    
    // Store temp token in database
    db.prepare(`
      INSERT INTO sessions (user_id, token_id, token_type, user_agent, ip_address, expires_at)
      VALUES (?, ?, 'temp_totp', ?, ?, ?)
    `).run(user.id, tempToken, req.headers['user-agent'] || null, ip, expiresAt);
    
    return sendJSON(res, {
      success: true,
      requiresTOTP: true,
      tempToken,
      message: 'Enter your 2FA code'
    });
  }

  // No 2FA - proceed with normal login
  // Reset failed login attempts on successful login
  db.prepare('UPDATE users SET failed_login_attempts = 0 WHERE id = ?').run(user.id);
  
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
  const { currentPassword, newPassword, totpCode } = body;

  if (!currentPassword || !newPassword) {
    return sendJSON(res, { error: 'Current and new password required' }, 400);
  }

  if (newPassword.length < 8) {
    return sendJSON(res, { error: 'New password must be at least 8 characters' }, 400);
  }

  try {
    // Get current user from database (including 2FA status)
    const user = db.prepare('SELECT password, totp_enabled, totp_secret FROM users WHERE id = ?').get(req.user.userId);

    if (!user) {
      return sendJSON(res, { error: 'User not found' }, 404);
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.password);
    if (!isValid) {
      return sendJSON(res, { error: 'Current password is incorrect' }, 400);
    }

    // Verify TOTP if 2FA is enabled
    if (user.totp_enabled) {
      if (!totpCode) {
        return sendJSON(res, 403, { 
          error: 'TOTP verification required',
          requires2FA: true,
          message: 'You have 2FA enabled. Please provide your authenticator code to change your password.'
        });
      }

      if (!/^\d{6}$/.test(totpCode)) {
        return sendJSON(res, 400, { 
          error: 'Invalid TOTP code format',
          requires2FA: true,
          message: 'TOTP code must be 6 digits'
        });
      }

      const secret = decrypt(user.totp_secret);
      const isTOTPValid = authenticator.verify({ token: totpCode, secret });

      if (!isTOTPValid) {
        return sendJSON(res, 401, { 
          error: 'Invalid TOTP code',
          requires2FA: true,
          message: 'The authenticator code you provided is incorrect'
        });
      }
    }

    // Hash new password and update
    const newHash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, req.user.userId);

    // Revoke all other sessions except current one (force re-login on other devices)
    const currentTokenId = req.user.jti;
    const revokedCount = revokeAllUserSessions(req.user.userId, req.user.userId, currentTokenId);
    
    logAudit(req.user.userId, 'change_password', 'user', req.user.userId, 
      `Password changed${user.totp_enabled ? ' (2FA verified)' : ''}, ${revokedCount} other sessions revoked`, getClientIP(req));
    
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

/**
 * Handle TOTP verification during login
 * Verifies the TOTP code and issues a full JWT token
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleTOTPLogin(req, res) {
  const ip = getClientIP(req);
  const body = await parseBody(req);
  const { tempToken, code } = body;

  if (!tempToken || !code) {
    return sendJSON(res, { error: 'Temp token and TOTP code required' }, 400);
  }

  if (!/^\d{6}$/.test(code)) {
    return sendJSON(res, { error: 'Invalid code format. Must be 6 digits.' }, 400);
  }

  // Get temp session from database
  const tempSession = db.prepare(`
    SELECT user_id, expires_at 
    FROM sessions 
    WHERE token_id = ? AND token_type = 'temp_totp' AND revoked_at IS NULL
  `).get(tempToken);

  if (!tempSession) {
    return sendJSON(res, { error: 'Invalid or expired temp token' }, 401);
  }

  // Check if temp token is expired
  const expiresAt = new Date(tempSession.expires_at).getTime();
  if (Date.now() > expiresAt) {
    // Revoke expired temp token
    db.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_id = ?').run(tempToken);
    return sendJSON(res, { error: 'Temp token expired. Please log in again.' }, 401);
  }

  // Get user's TOTP secret
  const user = db.prepare(`
    SELECT id, username, role, totp_secret, failed_login_attempts 
    FROM users 
    WHERE id = ?
  `).get(tempSession.user_id);

  if (!user || !user.totp_secret) {
    return sendJSON(res, { error: 'User not found or 2FA not configured' }, 401);
  }

  // Verify TOTP code
  const secret = decrypt(user.totp_secret);
  const isValid = authenticator.verify({ token: code, secret });

  if (!isValid) {
    // Increment failed login attempts
    const currentAttempts = user.failed_login_attempts || 0;
    db.prepare(`
      UPDATE users 
      SET failed_login_attempts = ?, last_failed_login = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(currentAttempts + 1, user.id);
    
    logAudit(user.id, 'totp_login_failed', 'user', user.id, 'Invalid TOTP code', ip);
    
    return sendJSON(res, { 
      error: 'Invalid 2FA code',
      failedAttempts: currentAttempts + 1
    }, 401);
  }

  // TOTP verified - revoke temp token and issue real JWT
  db.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_id = ?').run(tempToken);
  
  // Reset failed login attempts
  db.prepare('UPDATE users SET failed_login_attempts = 0 WHERE id = ?').run(user.id);

  // Generate JWT token with session tracking
  const userAgent = req.headers['user-agent'] || null;
  const token = generateToken(user.id, user.username, {
    type: 'user',
    userAgent,
    ipAddress: ip
  });

  logAudit(user.id, 'login', 'user', user.id, '2FA verified', ip);

  // Auto-whitelist admin IPs for safety
  try {
    const { autoWhitelistAdmin } = require('../utils/ip-utils');
    autoWhitelistAdmin(ip, user.id);
  } catch (error) {
    console.error('Failed to auto-whitelist admin IP:', error.message);
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
 * Handle recovery key login
 * Allows user to login with recovery key after failed attempts
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleRecoveryLogin(req, res) {
  const ip = getClientIP(req);
  const body = await parseBody(req);
  const { username, recoveryKey } = body;

  if (!username || !recoveryKey) {
    return sendJSON(res, { error: 'Username and recovery key required' }, 400);
  }

  // Validate recovery key format (128 hex characters)
  if (!/^[0-9a-f]{128}$/i.test(recoveryKey)) {
    return sendJSON(res, { error: 'Invalid recovery key format' }, 400);
  }

  // Get user from database
  const user = db.prepare(`
    SELECT id, username, role, recovery_key, totp_enabled, failed_login_attempts 
    FROM users 
    WHERE username = ?
  `).get(username);

  if (!user || !user.recovery_key || !user.totp_enabled) {
    return sendJSON(res, { error: 'Invalid recovery key or 2FA not enabled' }, 401);
  }

  // Decrypt and verify recovery key
  try {
    const storedRecoveryKey = decrypt(user.recovery_key);
    
    if (recoveryKey !== storedRecoveryKey) {
      logAudit(user.id, 'recovery_login_failed', 'user', user.id, 'Invalid recovery key', ip);
      return sendJSON(res, { error: 'Invalid recovery key' }, 401);
    }
  } catch (error) {
    console.error('Recovery key decryption error:', error);
    return sendJSON(res, { error: 'Invalid recovery key' }, 401);
  }

  // Recovery key verified - reset failed login attempts and generate token
  db.prepare('UPDATE users SET failed_login_attempts = 0 WHERE id = ?').run(user.id);

  const userAgent = req.headers['user-agent'] || null;
  const token = generateToken(user.id, user.username, {
    type: 'user',
    userAgent,
    ipAddress: ip
  });

  logAudit(user.id, 'login', 'user', user.id, 'Recovery key used', ip);

  // Auto-whitelist admin IPs for safety
  try {
    const { autoWhitelistAdmin } = require('../utils/ip-utils');
    autoWhitelistAdmin(ip, user.id);
  } catch (error) {
    console.error('Failed to auto-whitelist admin IP:', error.message);
  }

  sendJSON(res, {
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    },
    message: 'Logged in with recovery key. Consider disabling and re-enabling 2FA to get a new recovery key.'
  });
}

module.exports = handleAuthRoutes;
