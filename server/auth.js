const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { db, logAudit } = require('./db');

// In-memory session storage (use Redis for production with multiple instances)
const sessions = new Map();

// Rate limiting storage
const loginAttempts = new Map();

// Session secret - generated or from env
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

/**
 * Create a new session
 */
function createSession(userId, username) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const session = {
    userId,
    username,
    createdAt: Date.now(),
    lastActivity: Date.now()
  };
  
  sessions.set(sessionId, session);
  return sessionId;
}

/**
 * Verify and retrieve session
 */
function getSession(sessionId) {
  if (!sessionId) return null;
  
  const session = sessions.get(sessionId);
  if (!session) return null;
  
  // Session expires after 24 hours
  const maxAge = 24 * 60 * 60 * 1000;
  if (Date.now() - session.createdAt > maxAge) {
    sessions.delete(sessionId);
    return null;
  }
  
  // Auto-logout after 2 hours of inactivity
  const inactivityLimit = 2 * 60 * 60 * 1000;
  if (Date.now() - session.lastActivity > inactivityLimit) {
    sessions.delete(sessionId);
    return null;
  }
  
  // Update last activity
  session.lastActivity = Date.now();
  return session;
}

/**
 * Destroy a session
 */
function destroySession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * Parse cookies from request
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.split('=');
    if (name && rest.length) {
      cookies[name.trim()] = decodeURIComponent(rest.join('=').trim());
    }
  });
  
  return cookies;
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
  createSession,
  getSession,
  destroySession,
  parseCookies,
  checkRateLimit,
  resetRateLimit,
  authenticate,
  changePassword,
  authMiddleware,
  setSessionCookie,
  clearSessionCookie
};
