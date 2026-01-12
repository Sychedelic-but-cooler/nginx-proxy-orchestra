/**
 * Error handling middleware for consistent error responses
 */

const { sendJSON } = require('../shared/utils');

/**
 * Standard error handler wrapper for async route handlers
 * Catches errors and sends appropriate JSON error responses
 *
 * @param {Function} handler - Async route handler function
 * @returns {Function} Wrapped handler with error handling
 */
function asyncHandler(handler) {
  return async (req, res, ...args) => {
    try {
      await handler(req, res, ...args);
    } catch (error) {
      handleError(error, req, res);
    }
  };
}

/**
 * Handle errors with consistent logging and response format
 *
 * @param {Error} error - Error object
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleError(error, req, res) {
  // Log error with context
  console.error(`Error processing ${req.method} ${req.url}:`, error);

  // Determine status code
  let statusCode = 500;
  let message = 'Internal server error';

  if (error.statusCode) {
    statusCode = error.statusCode;
    message = error.message;
  } else if (error.message) {
    // Use error message but sanitize it for production
    message = process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : error.message;
  }

  // Send error response
  sendJSON(res, { error: message }, statusCode);
}

/**
 * Create a custom error with status code
 *
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @returns {Error} Error object with statusCode property
 */
function createError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  asyncHandler,
  handleError,
  createError
};
