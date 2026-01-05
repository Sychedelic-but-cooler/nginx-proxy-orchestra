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
    
    // Extract route and parameters
    const [route, ...params] = path.split('/').filter(Boolean);
    const routePath = '/' + route;

    const handler = this.routes[routePath] || this.routes['/404'];
    
    if (handler) {
      this.currentRoute = routePath;
      handler(params);
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
