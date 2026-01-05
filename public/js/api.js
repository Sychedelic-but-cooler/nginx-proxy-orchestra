/**
 * API client wrapper
 */
class API {
  constructor(baseURL = '') {
    this.baseURL = baseURL;
  }

  /**
   * Make a fetch request
   */
  async request(endpoint, options = {}) {
    const url = this.baseURL + endpoint;
    
    const defaultOptions = {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const config = { ...defaultOptions, ...options };

    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // Auth endpoints
  async login(username, password) {
    return this.request('/api/login', {
      method: 'POST',
      body: { username, password }
    });
  }

  async logout() {
    return this.request('/api/logout', { method: 'POST' });
  }

  async changePassword(currentPassword, newPassword) {
    return this.request('/api/user/password', {
      method: 'POST',
      body: { currentPassword, newPassword }
    });
  }

  // Dashboard endpoints
  async getDashboardStats() {
    return this.request('/api/dashboard/stats');
  }

  // Proxy endpoints
  async getProxies() {
    return this.request('/api/proxies');
  }

  async getProxy(id) {
    return this.request(`/api/proxies/${id}`);
  }

  async createProxy(data) {
    return this.request('/api/proxies', {
      method: 'POST',
      body: data
    });
  }

  async updateProxy(id, data) {
    return this.request(`/api/proxies/${id}`, {
      method: 'PUT',
      body: data
    });
  }

  async deleteProxy(id) {
    return this.request(`/api/proxies/${id}`, {
      method: 'DELETE'
    });
  }

  async toggleProxy(id) {
    return this.request(`/api/proxies/${id}/toggle`, {
      method: 'POST'
    });
  }

  // Module endpoints
  async getModules() {
    return this.request('/api/modules');
  }

  async createModule(data) {
    return this.request('/api/modules', {
      method: 'POST',
      body: data
    });
  }

  async updateModule(id, data) {
    return this.request(`/api/modules/${id}`, {
      method: 'PUT',
      body: data
    });
  }

  async deleteModule(id) {
    return this.request(`/api/modules/${id}`, {
      method: 'DELETE'
    });
  }

  // SSL certificate endpoints
  async getCertificates() {
    return this.request('/api/certificates');
  }

  async createCertificate(data) {
    return this.request('/api/certificates', {
      method: 'POST',
      body: data
    });
  }

  async deleteCertificate(id) {
    return this.request(`/api/certificates/${id}`, {
      method: 'DELETE'
    });
  }

  // Nginx operations
  async testNginx() {
    return this.request('/api/nginx/test', { method: 'POST' });
  }

  async reloadNginx() {
    return this.request('/api/nginx/reload', { method: 'POST' });
  }

  async getNginxStatus() {
    return this.request('/api/nginx/status');
  }

  // Audit log
  async getAuditLog() {
    return this.request('/api/audit-log');
  }
}

export default new API();
