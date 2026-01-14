/**
 * Simple hash-based router for SPA-like experience
 */
class Router {
  constructor() {
    this.routes = {};
    this.currentRoute = null;
    this.previousRoute = null;
    this.cleanupCallbacks = {};
    
    window.addEventListener('hashchange', () => this.handleRoute());
    window.addEventListener('load', () => this.handleRoute());
  }

  /**
   * Register a route handler
   */
  register(path, handler) {
    this.routes[path] = handler;
  }

  /**
   * Register a cleanup callback for a specific route
   * This will be called when navigating away from the route
   */
  registerCleanup(path, cleanupFn) {
    this.cleanupCallbacks[path] = cleanupFn;
  }

  /**
   * Navigate to a route
   */
  navigate(path) {
    window.location.hash = path;
  }

  /**
   * Handle route change
   */
  handleRoute() {
    // Call cleanup for previous route if exists
    if (this.previousRoute && this.cleanupCallbacks[this.previousRoute]) {
      try {
        this.cleanupCallbacks[this.previousRoute]();
      } catch (error) {
        console.error(`Cleanup error for ${this.previousRoute}:`, error);
      }
    }

    let path = window.location.hash.slice(1) || '/dashboard/server';

    // Normalize path (ensure it starts with /)
    if (!path.startsWith('/')) {
      path = '/' + path;
    }

    // Try to find exact match first
    let handler = this.routes[path];

    // If no exact match, try single-segment route with params
    if (!handler) {
      const [route, ...params] = path.split('/').filter(Boolean);
      const routePath = '/' + route;
      handler = this.routes[routePath];

      if (handler) {
        this.previousRoute = this.currentRoute;
        this.currentRoute = routePath;
        handler(params);
        return;
      }
    }

    // If exact match found, use it
    if (handler) {
      this.previousRoute = this.currentRoute;
      this.currentRoute = path;
      handler();
    } else {
      // Fall back to 404
      const notFoundHandler = this.routes['/404'];
      if (notFoundHandler) {
        this.previousRoute = this.currentRoute;
        this.currentRoute = '/404';
        notFoundHandler();
      }
    }
  }

  /**
   * Get current route
   */
  getCurrentRoute() {
    return this.currentRoute;
  }
}

export default new Router();
