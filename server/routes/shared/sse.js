/**
 * Server-Sent Events (SSE) manager for real-time event streaming
 * Provides unified management of SSE connections across different event types
 */

/**
 * SSE Manager class for handling multiple SSE clients
 */
class SSEManager {
  constructor() {
    this.clients = new Map();
    this.keepAliveInterval = 30000; // 30 seconds
  }

  /**
   * Setup SSE connection for a client
   *
   * @param {IncomingMessage} req - HTTP request object
   * @param {ServerResponse} res - HTTP response object
   * @param {Object} user - Authenticated user object
   * @param {Object} options - Connection options (filters, etc.)
   * @returns {string} Unique client ID
   */
  addClient(req, res, user, options = {}) {
    // Setup SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable nginx buffering
    });

    // Send initial connection message
    res.write(': connected\n\n');

    // Generate unique client ID
    const clientId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Setup keep-alive ping
    const keepAliveTimer = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch (error) {
        clearInterval(keepAliveTimer);
        this.removeClient(clientId);
      }
    }, this.keepAliveInterval);

    // Store client connection
    this.clients.set(clientId, {
      res,
      user,
      keepAliveTimer,
      options
    });

    // Cleanup on disconnect
    req.on('close', () => {
      this.removeClient(clientId);
      console.log(`SSE client ${clientId} disconnected`);
    });

    console.log(`SSE client ${clientId} connected (user: ${user.username})`);

    return clientId;
  }

  /**
   * Remove a client connection
   *
   * @param {string} clientId - Unique client ID
   */
  removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      clearInterval(client.keepAliveTimer);
      this.clients.delete(clientId);
    }
  }

  /**
   * Broadcast event to all connected clients
   * Optionally filter by event type or other criteria
   *
   * @param {string} eventType - Type of event (e.g., 'waf_event', 'ban_event')
   * @param {Object} data - Event data to broadcast
   * @param {Function} filter - Optional filter function to select clients
   */
  broadcast(eventType, data, filter = null) {
    const message = JSON.stringify({
      type: eventType,
      ...data
    });

    let sentCount = 0;
    let failedCount = 0;

    for (const [clientId, client] of this.clients.entries()) {
      // Apply filter if provided
      if (filter && !filter(client)) {
        continue;
      }

      try {
        client.res.write(`data: ${message}\n\n`);
        sentCount++;
      } catch (error) {
        console.error(`Failed to send event to SSE client ${clientId}:`, error.message);
        this.removeClient(clientId);
        failedCount++;
      }
    }

    if (sentCount > 0 || failedCount > 0) {
      console.log(`Broadcast ${eventType}: sent=${sentCount}, failed=${failedCount}`);
    }
  }

  /**
   * Broadcast WAF event to all connected clients
   *
   * @param {Object} event - WAF event data
   */
  broadcastWAFEvent(event) {
    this.broadcast('waf_event', { event });
  }

  /**
   * Broadcast ban event to all connected clients
   *
   * @param {string} eventType - Ban event type (ban_created, ban_removed, ban_updated)
   * @param {Object} data - Ban event data
   */
  broadcastBanEvent(eventType, data) {
    this.broadcast('ban_event', { eventType, data });
  }

  /**
   * Get count of connected clients
   *
   * @returns {number} Number of connected clients
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * Get all client IDs
   *
   * @returns {string[]} Array of client IDs
   */
  getClientIds() {
    return Array.from(this.clients.keys());
  }

  /**
   * Disconnect all clients
   */
  disconnectAll() {
    for (const clientId of this.clients.keys()) {
      this.removeClient(clientId);
    }
    console.log('All SSE clients disconnected');
  }
}

// Create singleton instance
const sseManager = new SSEManager();

// Export both the instance (default) and convenience functions (named exports)
module.exports = {
  // Default export - the full manager instance
  default: sseManager,

  // Direct access to manager
  sseManager,

  // Convenience functions that don't override instance methods
  broadcastWAFEvent: (event) => sseManager.broadcastWAFEvent(event),
  broadcastBanEvent: (eventType, data) => sseManager.broadcastBanEvent(eventType, data),

  // Pass through other useful methods
  addClient: (...args) => sseManager.addClient(...args),
  removeClient: (...args) => sseManager.removeClient(...args),
  broadcast: (...args) => sseManager.broadcast(...args),
  getClientCount: () => sseManager.getClientCount(),
  getClientIds: () => sseManager.getClientIds(),
  disconnectAll: () => sseManager.disconnectAll()
};
