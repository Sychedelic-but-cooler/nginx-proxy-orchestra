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
 * Authenticate user credentials
 */
function authenticate(username, password) {
  const user = db.prepare('SELECT id, username, password, role FROM users WHERE username = ?').get(username);
  
  if (!user) return null;
  
  const isValid = bcrypt.compareSync(password, user.password);
  if (!isValid) return null;
  
  // Update last login
  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  
  return {
    id: user.id,
    username: user.username,
    role: user.role
  };
}

/**
 * Change user password
 */
function changePassword(userId, currentPassword, newPassword) {
  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(userId);
  
  if (!user) {
    throw new Error('User not found');
  }
  
  const isValid = bcrypt.compareSync(currentPassword, user.password);
  if (!isValid) {
    throw new Error('Current password is incorrect');
  }
  
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, userId);
}

/**
 * Authentication middleware
 */
function authMiddleware(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.session;
  
  const session = getSession(sessionId);
  if (!session) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  
  req.user = session;
  next();
}

/**
 * Set session cookie
 */
function setSessionCookie(res, sessionId) {
  const isProduction = process.env.NODE_ENV === 'production';
  const maxAge = 24 * 60 * 60; // 24 hours in seconds
  
  const cookie = [
    `session=${sessionId}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    'Path=/'
  ];
  
  if (isProduction) {
    cookie.push('Secure'); // Only send over HTTPS in production
  }
  
  res.setHeader('Set-Cookie', cookie.join('; '));
}

/**
 * Clear session cookie
 */
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Max-Age=0; Path=/');
}

module.exports = {
  generateToken,
  verifyToken,
  extractToken,
  checkRateLimit,
  verifyPassword,
  hashPassword
};
