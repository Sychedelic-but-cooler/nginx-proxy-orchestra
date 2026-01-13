/**
 * Session management routes
 * Handles viewing and revoking user sessions
 */

const { parseBody, sendJSON, getClientIP } = require('./shared/utils');
const { logAudit } = require('../db');
const {
  getUserSessions,
  getAllSessions,
  revokeSession,
  revokeAllUserSessions
} = require('../auth');

/**
 * Handle session management routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleSessionRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/sessions' && method === 'GET') {
    return handleGetSessions(req, res);
  }

  if (pathname === '/api/sessions/all' && method === 'GET') {
    return handleGetAllSessions(req, res);
  }

  if (pathname.match(/^\/api\/sessions\/[^/]+$/) && method === 'DELETE') {
    return handleRevokeSession(req, res, parsedUrl);
  }

  if (pathname === '/api/sessions/revoke-all' && method === 'POST') {
    return handleRevokeAllSessions(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get current user's sessions
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetSessions(req, res) {
  if (!req.user) {
    return sendJSON(res, { error: 'Unauthorized' }, 401);
  }

  try {
    const sessions = getUserSessions(req.user.userId);
    
    // Mark current session
    const sessionsWithCurrent = sessions.map(session => ({
      ...session,
      isCurrent: session.token_id === req.user.jti
    }));

    sendJSON(res, { sessions: sessionsWithCurrent });
  } catch (error) {
    console.error('Get sessions error:', error);
    sendJSON(res, { error: 'Failed to retrieve sessions' }, 500);
  }
}

/**
 * Get all sessions (admin only)
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetAllSessions(req, res) {
  if (!req.user) {
    return sendJSON(res, { error: 'Unauthorized' }, 401);
  }

  try {
    const sessions = getAllSessions();
    sendJSON(res, { sessions });
  } catch (error) {
    console.error('Get all sessions error:', error);
    sendJSON(res, { error: 'Failed to retrieve sessions' }, 500);
  }
}

/**
 * Revoke a specific session
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
function handleRevokeSession(req, res, parsedUrl) {
  if (!req.user) {
    return sendJSON(res, { error: 'Unauthorized' }, 401);
  }

  const tokenId = parsedUrl.pathname.split('/').pop();

  if (!tokenId) {
    return sendJSON(res, { error: 'Token ID required' }, 400);
  }

  try {
    // Check if user owns this session or is admin
    const sessions = getUserSessions(req.user.userId);
    const sessionExists = sessions.some(s => s.token_id === tokenId);

    if (!sessionExists) {
      return sendJSON(res, { error: 'Session not found or access denied' }, 404);
    }

    // Prevent revoking current session via this endpoint
    if (tokenId === req.user.jti) {
      return sendJSON(res, { 
        error: 'Cannot revoke current session. Use logout instead.' 
      }, 400);
    }

    const success = revokeSession(tokenId, req.user.userId);

    if (success) {
      logAudit(req.user.userId, 'revoke_session', 'session', null, 
        `Revoked session ${tokenId}`, getClientIP(req));
      sendJSON(res, { success: true });
    } else {
      sendJSON(res, { error: 'Failed to revoke session' }, 500);
    }
  } catch (error) {
    console.error('Revoke session error:', error);
    sendJSON(res, { error: 'Failed to revoke session' }, 500);
  }
}

/**
 * Revoke all sessions except current
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
async function handleRevokeAllSessions(req, res) {
  if (!req.user) {
    return sendJSON(res, { error: 'Unauthorized' }, 401);
  }

  try {
    const count = revokeAllUserSessions(
      req.user.userId, 
      req.user.userId, 
      req.user.jti // Keep current session
    );

    logAudit(req.user.userId, 'revoke_all_sessions', 'session', null, 
      `Revoked ${count} sessions`, getClientIP(req));

    sendJSON(res, { 
      success: true, 
      revokedCount: count,
      message: `Successfully revoked ${count} session(s)`
    });
  } catch (error) {
    console.error('Revoke all sessions error:', error);
    sendJSON(res, { error: 'Failed to revoke sessions' }, 500);
  }
}

module.exports = handleSessionRoutes;
