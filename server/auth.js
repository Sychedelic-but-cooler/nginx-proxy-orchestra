const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db, logAudit, getSetting, setSetting } = require('./db');

// Rate limiting storage
const loginAttempts = new Map();

// JWT configuration
const JWT_EXPIRY_USER = '24h'; // 24 hours for user sessions
const JWT_EXPIRY_SSE = '1h'; // 1 hour for SSE connections
const JWT_ROTATION_DAYS = 7; // Rotate secret every 7 days

// JWT secret - managed with rotation
let JWT_SECRET = null;

/**
 * Initialize or rotate JWT secret
 * Returns true if secret was rotated, false otherwise
 */
function initializeJWTSecret() {
  const now = Date.now();
  const storedSecret = getSetting('jwt_secret');
  const lastRotation = getSetting('last_jwt_rotation');

  let needsRotation = false;
  let isFirstTime = false;

  if (!storedSecret) {
    // First time setup
    needsRotation = true;
    isFirstTime = true;
  } else if (lastRotation) {
    // Check if rotation is needed
    const rotationDate = new Date(lastRotation).getTime();
    const daysSinceRotation = (now - rotationDate) / (1000 * 60 * 60 * 24);

    if (daysSinceRotation >= JWT_ROTATION_DAYS) {
      needsRotation = true;
    }
  } else {
    // Has secret but no rotation date (migration case)
    needsRotation = true;
  }

  if (needsRotation) {
    // Generate new secret
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    setSetting('jwt_secret', JWT_SECRET);
    setSetting('last_jwt_rotation', new Date().toISOString());

    if (isFirstTime) {
      console.log('JWT secret initialized');
    } else {
      console.log(`JWT secret rotated (users will need to log in again)`);
    }

    return true;
  } else {
    // Use existing secret
    JWT_SECRET = storedSecret;

    if (lastRotation) {
      const rotationDate = new Date(lastRotation);
      const daysUntilRotation = JWT_ROTATION_DAYS - Math.floor((now - rotationDate.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`JWT secret loaded (rotates in ${daysUntilRotation} days)`);
    }

    return false;
  }
}

// Initialize secret on startup
initializeJWTSecret();

// Check for rotation daily
setInterval(() => {
  initializeJWTSecret();
}, 24 * 60 * 60 * 1000); // Check every 24 hours

/**
 * Generate a JWT token
 * 
 * @param {number} userId - User ID
 * @param {string} username - Username
 * @param {Object} options - Token options
 * @param {string} options.type - Token type: 'user' (default) or 'sse'
 * @param {string} options.userAgent - User agent string (for session tracking)
 * @param {string} options.ipAddress - Client IP address (for session tracking)
 * @returns {string} JWT token
 */
function generateToken(userId, username, options = {}) {
  const { type = 'user', userAgent = null, ipAddress = null } = options;
  const expiresIn = type === 'sse' ? JWT_EXPIRY_SSE : JWT_EXPIRY_USER;
  const jti = crypto.randomBytes(16).toString('hex'); // Unique token ID for revocation
  
  const token = jwt.sign(
    { 
      userId, 
      username,
      type,
      jti
    },
    JWT_SECRET,
    { expiresIn }
  );

  // Store token in database for revocation tracking
  const expiresAt = new Date(Date.now() + (type === 'sse' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000));
  
  try {
    db.prepare(`
      INSERT INTO sessions (user_id, token_id, token_type, user_agent, ip_address, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, jti, type, userAgent, ipAddress, expiresAt.toISOString());
  } catch (error) {
    console.error('Failed to store session:', error);
    // Don't fail token generation if session storage fails
  }

  return token;
}

/**
 * Verify and decode JWT token
 * Also checks if token has been revoked
 * 
 * @param {string} token - JWT token to verify
 * @returns {Object|null} Decoded token data or null if invalid/revoked
 */
function verifyToken(token) {
  if (!token) return null;
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if token has been revoked
    const session = db.prepare(`
      SELECT revoked_at FROM sessions 
      WHERE token_id = ? AND revoked_at IS NULL
    `).get(decoded.jti);
    
    if (!session) {
      // Token was revoked or doesn't exist in database
      return null;
    }
    
    return {
      userId: decoded.userId,
      username: decoded.username,
      type: decoded.type || 'user',
      jti: decoded.jti
    };
  } catch (error) {
    // Token invalid or expired
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
function extractToken(authHeader) {
  if (!authHeader) return null;
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  
  return parts[1];
}

/**
 * Check rate limiting for login attempts
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip) || [];
  
  // Clean up old attempts (older than 15 minutes)
  const recentAttempts = attempts.filter(timestamp => now - timestamp < 15 * 60 * 1000);
  
  // Allow max 5 attempts per 15 minutes
  if (recentAttempts.length >= 5) {
    return {
      allowed: false,
      retryAfter: Math.ceil((recentAttempts[0] + 15 * 60 * 1000 - now) / 1000)
    };
  }
  
  recentAttempts.push(now);
  loginAttempts.set(ip, recentAttempts);
  
  return { allowed: true };
}

/**
 * Reset rate limit for IP (on successful login)
 */
function resetRateLimit(ip) {
  loginAttempts.delete(ip);
}

/**
 * Hash a password
 */
async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

/**
 * Verify password against hash
 */
async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

/**
 * Revoke a specific session by token ID
 * 
 * @param {string} tokenId - Token ID (jti) to revoke
 * @param {number} revokedBy - User ID who revoked the token
 * @returns {boolean} True if revoked successfully
 */
function revokeSession(tokenId, revokedBy = null) {
  try {
    const result = db.prepare(`
      UPDATE sessions 
      SET revoked_at = CURRENT_TIMESTAMP, revoked_by = ?
      WHERE token_id = ? AND revoked_at IS NULL
    `).run(revokedBy, tokenId);
    
    return result.changes > 0;
  } catch (error) {
    console.error('Failed to revoke session:', error);
    return false;
  }
}

/**
 * Revoke all sessions for a specific user
 * 
 * @param {number} userId - User ID whose sessions to revoke
 * @param {number} revokedBy - User ID who revoked the sessions
 * @param {string} exceptTokenId - Optional token ID to exclude from revocation
 * @returns {number} Number of sessions revoked
 */
function revokeAllUserSessions(userId, revokedBy = null, exceptTokenId = null) {
  try {
    let query = `
      UPDATE sessions 
      SET revoked_at = CURRENT_TIMESTAMP, revoked_by = ?
      WHERE user_id = ? AND revoked_at IS NULL
    `;
    
    const params = [revokedBy, userId];
    
    if (exceptTokenId) {
      query += ' AND token_id != ?';
      params.push(exceptTokenId);
    }
    
    const result = db.prepare(query).run(...params);
    return result.changes;
  } catch (error) {
    console.error('Failed to revoke user sessions:', error);
    return 0;
  }
}

/**
 * Get all active sessions for a user
 * 
 * @param {number} userId - User ID
 * @returns {Array} Array of active sessions
 */
function getUserSessions(userId) {
  try {
    return db.prepare(`
      SELECT token_id, token_type, user_agent, ip_address, created_at, expires_at, last_used_at
      FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC
    `).all(userId);
  } catch (error) {
    console.error('Failed to get user sessions:', error);
    return [];
  }
}

/**
 * Get all active sessions (admin function)
 * 
 * @returns {Array} Array of all active sessions with user info
 */
function getAllSessions() {
  try {
    return db.prepare(`
      SELECT 
        s.token_id, s.user_id, u.username, s.token_type, 
        s.user_agent, s.ip_address, s.created_at, s.expires_at, s.last_used_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
      ORDER BY s.created_at DESC
    `).all();
  } catch (error) {
    console.error('Failed to get all sessions:', error);
    return [];
  }
}

/**
 * Update last used timestamp for a session
 * 
 * @param {string} tokenId - Token ID (jti)
 */
function updateSessionActivity(tokenId) {
  try {
    db.prepare(`
      UPDATE sessions 
      SET last_used_at = CURRENT_TIMESTAMP
      WHERE token_id = ?
    `).run(tokenId);
  } catch (error) {
    // Silent fail - don't disrupt request flow
  }
}

/**
 * Clean up expired and revoked sessions (maintenance task)
 * Removes sessions older than 30 days
 * 
 * @returns {number} Number of sessions cleaned up
 */
function cleanupExpiredSessions() {
  try {
    const result = db.prepare(`
      DELETE FROM sessions
      WHERE (expires_at < CURRENT_TIMESTAMP OR revoked_at IS NOT NULL)
      AND created_at < datetime('now', '-30 days')
    `).run();
    
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} expired/revoked sessions`);
    }
    
    return result.changes;
  } catch (error) {
    console.error('Failed to clean up sessions:', error);
    return 0;
  }
}

// Run session cleanup daily
setInterval(() => {
  cleanupExpiredSessions();
}, 24 * 60 * 60 * 1000); // Every 24 hours

// Run initial cleanup on startup
setTimeout(() => {
  cleanupExpiredSessions();
}, 5000); // 5 seconds after startup

module.exports = {
  generateToken,
  verifyToken,
  extractToken,
  checkRateLimit,
  resetRateLimit,
  verifyPassword,
  hashPassword,
  initializeJWTSecret,
  revokeSession,
  revokeAllUserSessions,
  getUserSessions,
  getAllSessions,
  updateSessionActivity,
  cleanupExpiredSessions
};
