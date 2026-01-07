/**
 * Simple hash-based router for SPA-like experience
 */
class Router {
  constructor() {
    this.routes = {};
    this.currentRoute = null;
    
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
   * Navigate to a route
   */
  navigate(path) {
    window.location.hash = path;
  }

  /**
   * Handle route change
   */
  handleRoute() {
    let path = window.location.hash.slice(1) || '/dashboard';

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
        this.currentRoute = routePath;
        handler(params);
        return;
      }
    }

    // If exact match found, use it
    if (handler) {
      this.currentRoute = path;
      handler();
    } else {
      // Fall back to 404
      const notFoundHandler = this.routes['/404'];
      if (notFoundHandler) {
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
