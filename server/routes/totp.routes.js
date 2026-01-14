const crypto = require('crypto');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const { db, logAudit } = require('../db');
const { verifyPassword } = require('../auth');
const { sendJSON, getClientIP, parseBody } = require('./shared/utils');

// Configure TOTP with 30-second time step and 6-digit codes
authenticator.options = {
  step: 30,
  window: 1, // Allow 1 step before/after for clock skew
};

/**
 * Encryption for TOTP secrets and recovery keys
 * Uses AES-256-GCM with the JWT secret as the encryption key
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

function getEncryptionKey() {
  // Derive a consistent encryption key from the JWT secret
  const { getSetting } = require('../db');
  const jwtSecret = getSetting('jwt_secret');
  if (!jwtSecret) {
    throw new Error('JWT secret not initialized');
  }
  // Use PBKDF2 to derive a 256-bit key
  return crypto.pbkdf2Sync(jwtSecret, 'totp-encryption-salt', 100000, 32, 'sha256');
}

function encrypt(text) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedText) {
  const key = getEncryptionKey();
  const parts = encryptedText.split(':');
  
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Generate a cryptographically secure recovery key
 * 128 characters hexadecimal (512 bits of entropy)
 */
function generateRecoveryKey() {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * POST /api/user/totp/setup
 * Generate a new TOTP secret and return QR code data
 * Does not enable 2FA until verified
 */
async function handleSetupTOTP(req, res) {
  try {
    const userId = req.user.userId;
    const username = req.user.username;
    
    // Check if 2FA is already enabled
    const user = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(userId);
    
    if (user.totp_enabled) {
      return sendJSON(res, { success: false, message: '2FA is already enabled. Disable it first to set up a new secret.' }, 400);
    }
    
    // Generate new TOTP secret
    const secret = authenticator.generateSecret();
    
    // Create otpauth URL for QR code
    const appName = 'Nginx Proxy Orchestra';
    const otpauthUrl = authenticator.keyuri(username, appName, secret);
    
    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    
    // Encrypt and store the secret (not yet verified)
    const encryptedSecret = encrypt(secret);
    
    db.prepare(`
      UPDATE users 
      SET totp_secret = ?, totp_verified = 0, totp_enabled = 0 
      WHERE id = ?
    `).run(encryptedSecret, userId);
    
    logAudit(userId, 'totp_setup_initiated', 'user', userId, null, getClientIP(req));
    
    sendJSON(res, {
      success: true,
      secret, // Send plaintext secret for manual entry
      qrCode: qrCodeDataUrl,
      message: 'Scan the QR code with your authenticator app, then verify with a code'
    });
    
  } catch (error) {
    console.error('TOTP setup error:', error);
    sendJSON(res, { success: false, message: 'Failed to setup 2FA' }, 500);
  }
}

/**
 * POST /api/user/totp/verify
 * Verify a TOTP code and enable 2FA
 * Body: { code: string }
 */
async function handleVerifyTOTP(req, res) {
  try {
    const userId = req.user.userId;
    const body = await parseBody(req);
    const { code } = body;
    
    if (!code || !/^\d{6}$/.test(code)) {
      return sendJSON(res, { success: false, message: 'Invalid code format. Must be 6 digits.' }, 400);
    }
    
    // Get user's TOTP secret
    const user = db.prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?').get(userId);
    
    if (!user.totp_secret) {
      return sendJSON(res, { success: false, message: '2FA not set up. Please set up 2FA first.' }, 400);
    }
    
    if (user.totp_enabled) {
      return sendJSON(res, { success: false, message: '2FA is already enabled and verified.' }, 400);
    }
    
    // Decrypt secret and verify code
    const secret = decrypt(user.totp_secret);
    const isValid = authenticator.verify({ token: code, secret });
    
    if (!isValid) {
      logAudit(userId, 'totp_verification_failed', 'user', userId, 'Invalid TOTP code', getClientIP(req), { success: false });
      return sendJSON(res, { success: false, message: 'Invalid verification code. Please try again.' }, 400);
    }
    
    // Generate recovery key
    const recoveryKey = generateRecoveryKey();
    const encryptedRecoveryKey = encrypt(recoveryKey);
    
    // Enable 2FA
    db.prepare(`
      UPDATE users 
      SET totp_verified = 1, totp_enabled = 1, recovery_key = ? 
      WHERE id = ?
    `).run(encryptedRecoveryKey, userId);
    
    logAudit(userId, 'totp_enabled', 'user', userId, null, getClientIP(req));
    
    sendJSON(res, {
      success: true,
      recoveryKey, // Show recovery key ONCE
      message: '2FA enabled successfully! Save your recovery key in a secure location.'
    });
    
  } catch (error) {
    console.error('TOTP verification error:', error);
    sendJSON(res, { success: false, message: 'Failed to verify 2FA code' }, 500);
  }
}

/**
 * POST /api/user/totp/disable
 * Disable 2FA for the account
 * Body: { password: string }
 */
async function handleDisableTOTP(req, res) {
  try {
    const userId = req.user.userId;
    const body = await parseBody(req);
    const { password } = body;
    
    if (!password) {
      return sendJSON(res, { success: false, message: 'Password is required to disable 2FA' }, 400);
    }
    
    // Verify password
    const user = db.prepare('SELECT password, totp_enabled FROM users WHERE id = ?').get(userId);
    
    const isPasswordValid = await verifyPassword(password, user.password);
    if (!isPasswordValid) {
      logAudit(userId, 'totp_disable_failed', 'user', userId, 'Invalid password', getClientIP(req), { success: false });
      return sendJSON(res, { success: false, message: 'Invalid password' }, 401);
    }
    
    if (!user.totp_enabled) {
      return sendJSON(res, { success: false, message: '2FA is not enabled' }, 400);
    }
    
    // Disable 2FA and clear secrets
    db.prepare(`
      UPDATE users 
      SET totp_secret = NULL, totp_verified = 0, totp_enabled = 0, recovery_key = NULL 
      WHERE id = ?
    `).run(userId);
    
    logAudit(userId, 'totp_disabled', 'user', userId, null, getClientIP(req));
    
    sendJSON(res, {
      success: true,
      message: '2FA has been disabled'
    });
    
  } catch (error) {
    console.error('TOTP disable error:', error);
    sendJSON(res, { success: false, message: 'Failed to disable 2FA' }, 500);
  }
}

/**
 * GET /api/user/totp/status
 * Get current 2FA status
 */
async function handleGetTOTPStatus(req, res) {
  try {
    const userId = req.user.userId;
    
    const user = db.prepare('SELECT totp_enabled, totp_verified FROM users WHERE id = ?').get(userId);
    
    sendJSON(res, {
      success: true,
      enabled: !!user.totp_enabled,
      verified: !!user.totp_verified
    });
    
  } catch (error) {
    console.error('TOTP status error:', error);
    sendJSON(res, { success: false, message: 'Failed to get 2FA status' }, 500);
  }
}

/**
 * POST /api/user/totp/regenerate-recovery
 * Regenerate recovery key (requires password)
 * Body: { password: string }
 */
async function handleRegenerateRecoveryKey(req, res) {
  try {
    const userId = req.user.userId;
    const body = await parseBody(req);
    const { password } = body;
    
    if (!password) {
      return sendJSON(res, { success: false, message: 'Password is required' }, 400);
    }
    
    // Verify password
    const user = db.prepare('SELECT password, totp_enabled FROM users WHERE id = ?').get(userId);
    
    const isPasswordValid = await verifyPassword(password, user.password);
    if (!isPasswordValid) {
      logAudit(userId, 'recovery_key_regeneration_failed', 'user', userId, 'Invalid password', getClientIP(req), { success: false });
      return sendJSON(res, { success: false, message: 'Invalid password' }, 401);
    }
    
    if (!user.totp_enabled) {
      return sendJSON(res, { success: false, message: '2FA is not enabled' }, 400);
    }
    
    // Generate new recovery key
    const recoveryKey = generateRecoveryKey();
    const encryptedRecoveryKey = encrypt(recoveryKey);
    
    db.prepare('UPDATE users SET recovery_key = ? WHERE id = ?').run(encryptedRecoveryKey, userId);
    
    logAudit(userId, 'recovery_key_regenerated', 'user', userId, null, getClientIP(req));
    
    sendJSON(res, {
      success: true,
      recoveryKey, // Show new recovery key
      message: 'Recovery key regenerated. Save it in a secure location.'
    });
    
  } catch (error) {
    console.error('Recovery key regeneration error:', error);
    sendJSON(res, { success: false, message: 'Failed to regenerate recovery key' }, 500);
  }
}

/**
 * Handle TOTP-related routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleTOTPRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/user/totp/setup' && method === 'POST') {
    return handleSetupTOTP(req, res);
  }

  if (pathname === '/api/user/totp/verify' && method === 'POST') {
    return handleVerifyTOTP(req, res);
  }

  if (pathname === '/api/user/totp/disable' && method === 'POST') {
    return handleDisableTOTP(req, res);
  }

  if (pathname === '/api/user/totp/status' && method === 'GET') {
    return handleGetTOTPStatus(req, res);
  }

  if (pathname === '/api/user/totp/regenerate-recovery' && method === 'POST') {
    return handleRegenerateRecoveryKey(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

module.exports = handleTOTPRoutes;
module.exports.decrypt = decrypt;
module.exports.authenticator = authenticator;
