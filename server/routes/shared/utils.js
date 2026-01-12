/**
 * Shared utility functions for route handlers
 */

/**
 * Parse JSON request body with size limits
 * @param {IncomingMessage} req - HTTP request object
 * @returns {Promise<Object>} Parsed JSON object
 * @throws {Error} If body exceeds size limit or JSON is invalid
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    const maxSize = 1024 * 1024; // 1MB limit

    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        // Handle empty body
        if (!body || body.trim() === '') {
          resolve({});
          return;
        }

        // Try to parse JSON
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (error) {
        console.error('JSON Parse Error:', error.message);
        console.error('Body received:', body.substring(0, 200));
        reject(new Error('Invalid JSON: ' + error.message));
      }
    });

    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });
  });
}

/**
 * Send JSON response with appropriate headers
 * @param {ServerResponse} res - HTTP response object
 * @param {Object} data - Data to send as JSON
 * @param {number} status - HTTP status code (default: 200)
 */
function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Extract client IP address from request
 * Handles X-Forwarded-For header for proxied requests
 * @param {IncomingMessage} req - HTTP request object
 * @returns {string} Client IP address
 */
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] ||
         req.socket.remoteAddress;
}

module.exports = {
  parseBody,
  sendJSON,
  getClientIP
};
