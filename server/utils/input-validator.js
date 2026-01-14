/**
 * Input Validation Utility
 * 
 * Provides secure validation for user inputs to prevent injection attacks.
 * All validators throw errors with descriptive messages if validation fails.
 */

const ipaddr = require('ipaddr.js');

/**
 * Validate IP address (IPv4 or IPv6)
 * Uses ipaddr.js library for robust parsing
 * 
 * @param {string} ip - IP address to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.allowCIDR - Allow CIDR notation (default: false)
 * @returns {string} - Validated IP address (trimmed)
 * @throws {Error} - If IP is invalid
 */
function validateIP(ip, options = {}) {
  const { allowCIDR = false } = options;

  if (typeof ip !== 'string') {
    throw new Error('IP address must be a string');
  }

  // Trim whitespace
  const trimmedIP = ip.trim();

  if (!trimmedIP) {
    throw new Error('IP address cannot be empty');
  }

  // Check for CIDR notation
  const hasCIDR = trimmedIP.includes('/');

  if (hasCIDR && !allowCIDR) {
    throw new Error('CIDR notation not allowed in this context');
  }

  try {
    if (hasCIDR) {
      // Parse CIDR range
      const [addr, prefix] = trimmedIP.split('/');
      
      // Validate IP part
      ipaddr.parse(addr);
      
      // Validate prefix length
      const prefixNum = parseInt(prefix, 10);
      const isIPv6 = addr.includes(':');
      const maxPrefix = isIPv6 ? 128 : 32;
      
      if (isNaN(prefixNum) || prefixNum < 0 || prefixNum > maxPrefix) {
        throw new Error(`Invalid CIDR prefix: ${prefix}`);
      }
    } else {
      // Parse single IP
      ipaddr.parse(trimmedIP);
    }

    // Additional security: Check for suspicious patterns
    // This catches edge cases where ipaddr.js might not catch malicious input
    if (/[;&|`$()<>{}[\]\\]/.test(trimmedIP)) {
      throw new Error('IP address contains invalid characters');
    }

    return trimmedIP;
  } catch (error) {
    throw new Error(`Invalid IP address: ${error.message}`);
  }
}

/**
 * Validate multiple IP addresses (comma or space separated)
 * 
 * @param {string} ips - IP addresses to validate (comma or space separated)
 * @param {Object} options - Validation options (passed to validateIP)
 * @returns {string[]} - Array of validated IP addresses
 * @throws {Error} - If any IP is invalid
 */
function validateIPs(ips, options = {}) {
  if (typeof ips !== 'string') {
    throw new Error('IPs must be a string');
  }

  const trimmed = ips.trim();
  if (!trimmed) {
    return [];
  }

  // Split by comma or space
  const ipArray = trimmed.split(/[,\s]+/).filter(ip => ip.trim());
  
  // Validate each IP
  return ipArray.map(ip => validateIP(ip, options));
}

/**
 * Validate domain name
 * Validates according to RFC 1123 with additional security checks
 * 
 * @param {string} domain - Domain name to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.allowWildcard - Allow wildcard domains (*.example.com)
 * @param {boolean} options.allowUnderscore - Allow underscores (for some DNS records)
 * @returns {string} - Validated domain name (trimmed, lowercase)
 * @throws {Error} - If domain is invalid
 */
function validateDomain(domain, options = {}) {
  const { allowWildcard = false, allowUnderscore = false } = options;

  if (typeof domain !== 'string') {
    throw new Error('Domain must be a string');
  }

  // Trim and lowercase
  let trimmedDomain = domain.trim().toLowerCase();

  if (!trimmedDomain) {
    throw new Error('Domain cannot be empty');
  }

  // Check length limits (RFC 1035)
  if (trimmedDomain.length > 253) {
    throw new Error('Domain name too long (max 253 characters)');
  }

  // Handle wildcard
  let isWildcard = false;
  if (trimmedDomain.startsWith('*.')) {
    if (!allowWildcard) {
      throw new Error('Wildcard domains not allowed in this context');
    }
    isWildcard = true;
    trimmedDomain = trimmedDomain.substring(2); // Remove *. for validation
  }

  // Security: Block command injection attempts
  if (/[;&|`$()<>{}[\]\\'"!]/.test(trimmedDomain)) {
    throw new Error('Domain contains invalid characters');
  }

  // Domain validation regex
  // Allows: alphanumeric, hyphens, dots
  // Optionally: underscores
  const underscorePattern = allowUnderscore ? '_' : '';
  const domainRegex = new RegExp(
    `^([a-z0-9${underscorePattern}]([a-z0-9${underscorePattern}-]{0,61}[a-z0-9${underscorePattern}])?\\.)+[a-z]{2,}$`
  );

  if (!domainRegex.test(trimmedDomain)) {
    throw new Error('Invalid domain format');
  }

  // Check individual label lengths (max 63 characters per label)
  const labels = trimmedDomain.split('.');
  for (const label of labels) {
    if (label.length > 63) {
      throw new Error('Domain label too long (max 63 characters per label)');
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      throw new Error('Domain labels cannot start or end with hyphen');
    }
  }

  // Return with wildcard prefix if it was present
  return isWildcard ? `*.${trimmedDomain}` : trimmedDomain;
}

/**
 * Validate email address
 * Basic but secure email validation
 * 
 * @param {string} email - Email address to validate
 * @returns {string} - Validated email (trimmed, lowercase)
 * @throws {Error} - If email is invalid
 */
function validateEmail(email) {
  if (typeof email !== 'string') {
    throw new Error('Email must be a string');
  }

  const trimmedEmail = email.trim().toLowerCase();

  if (!trimmedEmail) {
    throw new Error('Email cannot be empty');
  }

  // Security: Block command injection attempts
  if (/[;&|`$()<>{}[\]\\!]/.test(trimmedEmail)) {
    throw new Error('Email contains invalid characters');
  }

  // Basic email regex (intentionally simple for security)
  // More permissive than RFC 5322 but prevents injection
  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

  if (!emailRegex.test(trimmedEmail)) {
    throw new Error('Invalid email format');
  }

  if (trimmedEmail.length > 254) {
    throw new Error('Email too long (max 254 characters)');
  }

  return trimmedEmail;
}

/**
 * Validate multiple domains (comma or space separated)
 * 
 * @param {string} domains - Domains to validate (comma or space separated)
 * @param {Object} options - Validation options (passed to validateDomain)
 * @returns {string[]} - Array of validated domains
 * @throws {Error} - If any domain is invalid
 */
function validateDomains(domains, options = {}) {
  if (typeof domains !== 'string') {
    throw new Error('Domains must be a string');
  }

  const trimmed = domains.trim();
  if (!trimmed) {
    return [];
  }

  // Split by comma or space
  const domainArray = trimmed.split(/[,\s]+/).filter(d => d.trim());
  
  // Validate each domain
  return domainArray.map(domain => validateDomain(domain, options));
}

/**
 * Validate port number
 * 
 * @param {number|string} port - Port number to validate
 * @param {Object} options - Validation options
 * @param {number} options.min - Minimum port (default: 1)
 * @param {number} options.max - Maximum port (default: 65535)
 * @returns {number} - Validated port number
 * @throws {Error} - If port is invalid
 */
function validatePort(port, options = {}) {
  const { min = 1, max = 65535 } = options;

  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

  if (isNaN(portNum) || !Number.isInteger(portNum)) {
    throw new Error('Port must be an integer');
  }

  if (portNum < min || portNum > max) {
    throw new Error(`Port must be between ${min} and ${max}`);
  }

  return portNum;
}

/**
 * Validate duration in seconds
 * 
 * @param {number|string} duration - Duration in seconds
 * @param {Object} options - Validation options
 * @param {number} options.min - Minimum duration in seconds (default: 1)
 * @param {number} options.max - Maximum duration in seconds (default: 31536000 = 1 year)
 * @returns {number} - Validated duration in seconds
 * @throws {Error} - If duration is invalid
 */
function validateDuration(duration, options = {}) {
  const { min = 1, max = 31536000 } = options;

  const durationNum = typeof duration === 'string' ? parseInt(duration, 10) : duration;

  if (isNaN(durationNum) || !Number.isInteger(durationNum)) {
    throw new Error('Duration must be an integer');
  }

  if (durationNum < min || durationNum > max) {
    throw new Error(`Duration must be between ${min} and ${max} seconds`);
  }

  return durationNum;
}

/**
 * Sanitize shell command argument
 * Removes or escapes dangerous characters for shell commands
 * 
 * IMPORTANT: This should be used as defense-in-depth ONLY.
 * Prefer using parameterized commands or avoiding shell execution.
 * 
 * @param {string} input - String to sanitize
 * @param {Object} options - Sanitization options
 * @param {string} options.allowedChars - Additional allowed characters regex pattern
 * @returns {string} - Sanitized string
 * @throws {Error} - If input contains dangerous characters
 */
function sanitizeShellArg(input, options = {}) {
  const { allowedChars = '' } = options;

  if (typeof input !== 'string') {
    throw new Error('Shell argument must be a string');
  }

  const trimmed = input.trim();

  if (!trimmed) {
    return '';
  }

  // Dangerous shell metacharacters
  const dangerousChars = /[;&|`$()<>{}[\]\\'"!\n\r\t]/;

  // Allow only alphanumeric, space, hyphen, underscore, dot, and specified additional chars
  const allowedPattern = new RegExp(`^[a-zA-Z0-9 ._-${allowedChars}]+$`);

  if (dangerousChars.test(trimmed) || !allowedPattern.test(trimmed)) {
    throw new Error('Input contains dangerous characters for shell execution');
  }

  return trimmed;
}

/**
 * Sanitize comment/reason for firewall rules
 * More permissive than sanitizeShellArg but still safe
 * 
 * @param {string} comment - Comment to sanitize
 * @param {number} maxLength - Maximum length (default: 255)
 * @returns {string} - Sanitized comment
 */
function sanitizeComment(comment, maxLength = 255) {
  if (typeof comment !== 'string') {
    return '';
  }

  // Remove dangerous characters but allow spaces and common punctuation
  let sanitized = comment
    .trim()
    .replace(/[;&|`$()<>{}[\]\\'"!\n\r\t]/g, '') // Remove shell metacharacters
    .replace(/[^\x20-\x7E]/g, '') // Remove non-printable ASCII
    .substring(0, maxLength);

  return sanitized;
}

/**
 * Validate alphanumeric identifier (for ipset names, etc.)
 * Only allows letters, numbers, underscores, and hyphens
 * 
 * @param {string} identifier - Identifier to validate
 * @param {Object} options - Validation options
 * @param {number} options.minLength - Minimum length (default: 1)
 * @param {number} options.maxLength - Maximum length (default: 64)
 * @returns {string} - Validated identifier
 * @throws {Error} - If identifier is invalid
 */
function validateIdentifier(identifier, options = {}) {
  const { minLength = 1, maxLength = 64 } = options;

  if (typeof identifier !== 'string') {
    throw new Error('Identifier must be a string');
  }

  const trimmed = identifier.trim();

  if (trimmed.length < minLength) {
    throw new Error(`Identifier too short (min ${minLength} characters)`);
  }

  if (trimmed.length > maxLength) {
    throw new Error(`Identifier too long (max ${maxLength} characters)`);
  }

  // Only alphanumeric, underscore, and hyphen
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error('Identifier can only contain letters, numbers, underscores, and hyphens');
  }

  // Must start with letter or number
  if (!/^[a-zA-Z0-9]/.test(trimmed)) {
    throw new Error('Identifier must start with a letter or number');
  }

  return trimmed;
}

/**
 * Validate nginx configuration
 * 
 * @param {string} config - Nginx configuration snippet
 * @param {Object} options - Validation options
 * @param {number} options.maxLength - Maximum length in characters (default: 50000)
 * @param {boolean} options.allowServerBlocks - Allow server blocks in config (default: false)
 * @returns {string} - Validated config
 * @throws {Error} - If config contains dangerous patterns
 */
function validateNginxConfig(config, options = {}) {
  const { maxLength = 50000, allowServerBlocks = false } = options;

  if (typeof config !== 'string') {
    throw new Error('Nginx config must be a string');
  }

  // Allow empty config
  if (!config || !config.trim()) {
    return '';
  }

  const trimmed = config.trim();

  // Check length
  if (trimmed.length > maxLength) {
    throw new Error(`Nginx config too long (max ${maxLength} characters)`);
  }

  // SECURITY: Check for command execution attempts
  // Nginx config doesn't support command execution, but check anyway
  const dangerousPatterns = [
    /\$\(/g,                    // Command substitution $(...)
    /`[^`]*`/g,                 // Backtick command execution
    /\bexec\s+/gi,              // exec directive (not standard nginx)
    /\beval\s+/gi,              // eval (not standard nginx)
    /\bsystem\s*\(/gi,          // system calls
    /<\?php/gi,                 // PHP code
    /<script/gi                 // JavaScript (shouldn't be in nginx config)
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(trimmed)) {
      throw new Error(`Nginx config contains potentially dangerous pattern: ${pattern.source}`);
    }
  }

  // SECURITY: Check for server blocks in advanced_config
  // Server blocks should not be in advanced_config as they will be nested incorrectly
  // Advanced config is inserted into location or server blocks, not at top level
  // However, for full custom configs (text editor mode), server blocks are allowed
  if (!allowServerBlocks && /^\s*server\s*\{/m.test(trimmed)) {
    throw new Error('Nginx config contains server blocks. Use the proxy wizard instead of advanced config for complete server definitions.');
  }

  // Check for reasonable nginx directive structure
  // Should contain typical nginx keywords or be comments
  const hasNginxDirectives = /^\s*(#|location|proxy_|set|return|rewrite|if|add_header|include)/m.test(trimmed);
  const isAllComments = trimmed.split('\n').every(line => {
    const l = line.trim();
    return !l || l.startsWith('#');
  });

  if (!hasNginxDirectives && !isAllComments && trimmed.length > 20) {
    console.warn('Warning: Nginx config may not contain valid nginx directives');
    // Don't throw error, just warn - let nginx -t handle final validation
  }

  return trimmed;
}

module.exports = {
  validateIP,
  validateIPs,
  validateDomain,
  validateDomains,
  validateEmail,
  validatePort,
  validateDuration,
  validateIdentifier,
  validateNginxConfig,
  sanitizeShellArg,
  sanitizeComment
};
