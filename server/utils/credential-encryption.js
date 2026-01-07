const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Encryption algorithm
const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32; // 256 bits

/**
 * Get or generate encryption key
 * Stored in .env as CERT_ENCRYPTION_KEY
 * If not found, generates a new one
 */
function getEncryptionKey() {
  let key = process.env.CERT_ENCRYPTION_KEY;

  if (!key) {
    console.warn('CERT_ENCRYPTION_KEY not found in environment, generating new key...');
    console.warn('⚠️  IMPORTANT: Add this to your .env file to persist across restarts:');

    // Generate random key
    key = crypto.randomBytes(KEY_LENGTH).toString('hex');
    console.warn(`CERT_ENCRYPTION_KEY=${key}`);
    console.warn('');
  }

  // Clean the key: trim whitespace and remove quotes
  key = key.trim().replace(/^["']|["']$/g, '');

  // Validate key format (must be hex characters only)
  if (!/^[0-9a-fA-F]+$/.test(key)) {
    throw new Error(`Encryption key must contain only hexadecimal characters (0-9, a-f, A-F). Got: ${key.substring(0, 10)}...`);
  }

  // Ensure key is correct length
  if (key.length !== KEY_LENGTH * 2) { // hex encoding doubles length
    throw new Error(`Encryption key must be exactly ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes). Current length: ${key.length}`);
  }

  return Buffer.from(key, 'hex');
}

/**
 * Encrypt credentials object
 * @param {Object} credentials - Credentials object to encrypt
 * @returns {String} - Encrypted string in format: iv:encrypted
 */
function encryptCredentials(credentials) {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16); // IV length for AES

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(JSON.stringify(credentials), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Return IV + encrypted data (IV needed for decryption)
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('Encryption error:', error.message);
    console.error('Stack:', error.stack);
    throw new Error(`Failed to encrypt credentials: ${error.message}`);
  }
}

/**
 * Decrypt credentials string
 * @param {String} encrypted - Encrypted string in format: iv:encrypted
 * @returns {Object} - Decrypted credentials object
 */
function decryptCredentials(encrypted) {
  try {
    const key = getEncryptionKey();

    // Split IV and encrypted data
    const parts = encrypted.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Decryption error:', error.message);
    throw new Error('Failed to decrypt credentials');
  }
}

/**
 * Generate a new encryption key
 * Used for setup or key rotation
 */
function generateEncryptionKey() {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Check if encryption key is configured and valid
 */
function isEncryptionConfigured() {
  try {
    const key = process.env.CERT_ENCRYPTION_KEY;
    if (!key) return false;

    // Clean and validate
    const cleanKey = key.trim().replace(/^["']|["']$/g, '');
    if (cleanKey.length !== KEY_LENGTH * 2) return false;
    if (!/^[0-9a-fA-F]+$/.test(cleanKey)) return false;

    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  encryptCredentials,
  decryptCredentials,
  generateEncryptionKey,
  isEncryptionConfigured
};
