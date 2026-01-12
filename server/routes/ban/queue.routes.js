/**
 * Ban queue routes
 * Manages ban queue status and operations
 */

const { sendJSON } = require('../shared/utils');
const { getBanQueue } = require('../../utils/ban-queue');

/**
 * Handle queue routes
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 * @param {URL} parsedUrl - Parsed URL object
 */
async function handleQueueRoutes(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;
  const method = req.method;

  if (pathname === '/api/ban/queue/status' && method === 'GET') {
    return handleGetQueueStatus(req, res);
  }

  sendJSON(res, { error: 'Not Found' }, 404);
}

/**
 * Get queue status
 * Returns current status of ban queue
 *
 * @param {IncomingMessage} req - HTTP request object
 * @param {ServerResponse} res - HTTP response object
 */
function handleGetQueueStatus(req, res) {
  try {
    const banQueue = getBanQueue();
    const status = banQueue.getStatus();

    sendJSON(res, {
      queue: status,
      rate_limit: '1 request per 5 seconds per integration'
    });
  } catch (error) {
    console.error('Get queue status error:', error);
    sendJSON(res, { error: error.message }, 500);
  }
}

module.exports = handleQueueRoutes;
