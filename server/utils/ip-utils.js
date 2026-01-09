/**
 * IP Utilities
 *
 * Provides IP whitelisting, CIDR support, and admin auto-whitelist
 */

const { db } = require('../db');
const ipaddr = require('ipaddr.js');

/**
 * Check if IP is whitelisted (with CIDR support)
 */
function isWhitelisted(ip) {
  try {
    const addr = ipaddr.process(ip);

    const whitelist = db.prepare(`
      SELECT ip_address, ip_range, type, priority, reason
      FROM ip_whitelist
      ORDER BY priority ASC
    `).all();

    for (const entry of whitelist) {
      // Direct IP match
      if (entry.ip_address === ip) {
        console.log(`✓ IP ${ip} whitelisted: ${entry.type} - ${entry.reason}`);
        return true;
      }

      // CIDR range match
      if (entry.ip_range) {
        try {
          const [rangeAddr, rangeBits] = entry.ip_range.split('/');
          const range = ipaddr.process(rangeAddr);
          const parsedRange = [range, parseInt(rangeBits, 10)];

          if (addr.kind() === range.kind() && addr.match(parsedRange)) {
            console.log(`✓ IP ${ip} whitelisted: ${entry.type} - Range ${entry.ip_range} - ${entry.reason}`);
            return true;
          }
        } catch (err) {
          console.warn(`Invalid CIDR range in whitelist: ${entry.ip_range}`);
        }
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking whitelist:', error);
    // Fail-safe: don't block if we can't check
    return false;
  }
}

/**
 * Auto-whitelist admin's IP on first successful login
 */
function autoWhitelistAdmin(ip, userId) {
  try {
    // Check if user is admin
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
    if (!user || !user.is_admin) return;

    // Check if already whitelisted
    if (isWhitelisted(ip)) {
      console.log(`IP ${ip} already whitelisted, skipping auto-whitelist`);
      return;
    }

    // Check if this exact entry already exists
    const existing = db.prepare(
      'SELECT id FROM ip_whitelist WHERE ip_address = ? AND type = ?'
    ).get(ip, 'admin_auto');

    if (existing) {
      console.log(`Admin IP ${ip} already has auto-whitelist entry`);
      return;
    }

    // Add to whitelist
    db.prepare(`
      INSERT INTO ip_whitelist (ip_address, type, reason, added_by, priority)
      VALUES (?, 'admin_auto', 'Admin login auto-whitelist', ?, 50)
    `).run(ip, userId);

    console.log(`✓ Auto-whitelisted admin IP: ${ip}`);
  } catch (error) {
    console.error('Failed to auto-whitelist admin:', error);
  }
}

/**
 * Check if IP is private/RFC1918
 */
function isPrivateIP(ip) {
  try {
    const addr = ipaddr.process(ip);

    if (addr.kind() === 'ipv4') {
      // Check RFC1918 private ranges
      const privateRanges = [
        [ipaddr.parse('10.0.0.0'), 8],
        [ipaddr.parse('172.16.0.0'), 12],
        [ipaddr.parse('192.168.0.0'), 16],
        [ipaddr.parse('127.0.0.0'), 8]  // Localhost
      ];

      for (const range of privateRanges) {
        if (addr.match(range)) {
          return true;
        }
      }
    } else if (addr.kind() === 'ipv6') {
      // Check IPv6 private ranges
      if (addr.range() === 'loopback' || addr.range() === 'linkLocal' ||
          addr.range() === 'uniqueLocal') {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking if IP is private:', error);
    return false;
  }
}

/**
 * Validate IP address format
 */
function isValidIP(ip) {
  try {
    ipaddr.process(ip);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Validate CIDR notation
 */
function isValidCIDR(cidr) {
  try {
    const [addr, bits] = cidr.split('/');
    if (!addr || !bits) return false;

    ipaddr.process(addr);
    const numBits = parseInt(bits, 10);

    // Check valid bit ranges
    const parsedAddr = ipaddr.parse(addr);
    const maxBits = parsedAddr.kind() === 'ipv4' ? 32 : 128;

    return numBits >= 0 && numBits <= maxBits;
  } catch (error) {
    return false;
  }
}

/**
 * Get IP info (type, range, etc.)
 */
function getIPInfo(ip) {
  try {
    const addr = ipaddr.process(ip);

    return {
      ip,
      version: addr.kind() === 'ipv4' ? 4 : 6,
      isPrivate: isPrivateIP(ip),
      range: addr.range ? addr.range() : 'unknown'
    };
  } catch (error) {
    return {
      ip,
      error: 'Invalid IP address'
    };
  }
}

module.exports = {
  isWhitelisted,
  autoWhitelistAdmin,
  isPrivateIP,
  isValidIP,
  isValidCIDR,
  getIPInfo
};
