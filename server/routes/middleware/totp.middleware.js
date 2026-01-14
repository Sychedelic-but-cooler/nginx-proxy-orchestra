/**
 * TOTP verification middleware
 * Requires TOTP code for security-critical operations if 2FA is enabled
 */

const { db } = require('../../db');
const { parseBody, sendJSON } = require('../shared/utils');
const handleTOTPRoutes = require('../totp.routes');
const { decrypt, authenticator } = handleTOTPRoutes;

/**
 * Verify TOTP code from request body if user has 2FA enabled
 * 
 * @param {IncomingMessage} req - HTTP request object with req.user
 * @param {ServerResponse} res - HTTP response object
 * @returns {Promise<boolean>} - true if verification passed or 2FA not enabled, false otherwise
 */
async function verifyTOTPIfEnabled(req, res) {
  try {
    const userId = req.user.userId;
    
    // Check if user has 2FA enabled
    const user = db.prepare('SELECT totp_enabled, totp_secret FROM users WHERE id = ?').get(userId);
    
    // If 2FA is not enabled, allow the operation
    if (!user || !user.totp_enabled) {
      return true;
    }
    
    // 2FA is enabled - require TOTP code
    // Parse body if not already parsed
    if (!req.body) {
      req.body = await parseBody(req);
    }
    
    const { totpCode } = req.body;
    
    if (!totpCode) {
      sendJSON(res, 403, { 
        error: 'TOTP verification required',
        requires2FA: true,
        message: 'You have 2FA enabled. Please provide your authenticator code to perform this security-critical operation.'
      });
      return false;
    }
    
    // Verify the TOTP code
    if (!/^\d{6}$/.test(totpCode)) {
      sendJSON(res, 400, { 
        error: 'Invalid TOTP code format',
        requires2FA: true,
        message: 'TOTP code must be 6 digits'
      });
      return false;
    }
    
    const secret = decrypt(user.totp_secret);
    const isValid = authenticator.verify({ token: totpCode, secret });
    
    if (!isValid) {
      sendJSON(res, 401, { 
        error: 'Invalid TOTP code',
        requires2FA: true,
        message: 'The authenticator code you provided is incorrect'
      });
      return false;
    }
    
    // TOTP code is valid
    return true;
    
  } catch (error) {
    console.error('TOTP verification error:', error);
    sendJSON(res, 500, { error: 'TOTP verification failed' });
    return false;
  }
}

/**
 * Middleware wrapper to require TOTP verification for route handlers
 * Usage: wrap your handler function with this middleware
 * 
 * @param {Function} handler - Original handler function
 * @returns {Function} - Wrapped handler with TOTP verification
 */
function requireTOTPIfEnabled(handler) {
  return async function(req, res, ...args) {
    const verified = await verifyTOTPIfEnabled(req, res);
    if (!verified) {
      // Response already sent by verifyTOTPIfEnabled
      return;
    }
    
    // TOTP verification passed (or not required), proceed with original handler
    return handler(req, res, ...args);
  };
}

module.exports = {
  verifyTOTPIfEnabled,
  requireTOTPIfEnabled
};
