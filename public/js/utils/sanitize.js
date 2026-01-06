/**
 * HTML Sanitization utility to prevent XSS attacks
 */

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - The string to escape
 * @returns {string} - The escaped string
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) {
    return '';
  }

  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };

  return String(str).replace(/[&<>"'/]/g, (char) => map[char]);
}

/**
 * Sanitize HTML content by escaping all special characters
 * Use this for user-generated content that should be displayed as text
 * @param {string} html - The HTML string to sanitize
 * @returns {string} - The sanitized HTML
 */
export function sanitize(html) {
  return escapeHtml(html);
}

/**
 * Sanitize an object's properties recursively
 * @param {Object} obj - The object to sanitize
 * @returns {Object} - The sanitized object
 */
export function sanitizeObject(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return escapeHtml(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }

  return obj;
}

/**
 * Create a text node from a string (safe alternative to innerHTML)
 * @param {string} text - The text content
 * @returns {Text} - A text node
 */
export function createTextNode(text) {
  return document.createTextNode(text || '');
}

/**
 * Safely set text content of an element
 * @param {HTMLElement} element - The element to update
 * @param {string} text - The text content
 */
export function setTextContent(element, text) {
  element.textContent = text || '';
}
