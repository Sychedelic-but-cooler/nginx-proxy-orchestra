const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db, logAudit } = require('./db');

// Rate limiting storage
const loginAttempts = new Map();

// JWT secret - generated or from env
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY = '3d'; // 3 days

if (!process.env.JWT_SECRET) {
  console.warn('WARNING: Using auto-generated JWT_SECRET. Set JWT_SECRET in .env for production.');
}

/**
 * Generate a JWT token
 */
function generateToken(userId, username) {
  return jwt.sign(
    { userId, username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Verify and decode JWT token
 */
function verifyToken(token) {
  if (!token) return null;
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return {
      userId: decoded.userId,
      username: decoded.username
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

module.exports = {
  generateToken,
  verifyToken,
  extractToken,
  checkRateLimit,
  resetRateLimit,
  verifyPassword,
  hashPassword
};
