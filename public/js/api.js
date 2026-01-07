/**
 * API client wrapper
 */
class API {
  constructor(baseURL = '') {
    this.baseURL = baseURL;
  }

  /**
   * Get JWT token from localStorage
   */
  getToken() {
    return localStorage.getItem('auth_token');
  }

  /**
   * Set JWT token in localStorage
   */
  setToken(token) {
    localStorage.setItem('auth_token', token);
  }

  /**
   * Clear JWT token from localStorage
   */
  clearToken() {
    localStorage.removeItem('auth_token');
  }

  /**
   * Make a fetch request
   */
  async request(endpoint, options = {}) {
    const url = this.baseURL + endpoint;
    
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json'
      }
    };

    // Add JWT token to headers if available
    const token = this.getToken();
    if (token) {
      defaultOptions.headers['Authorization'] = `Bearer ${token}`;
    }

    const config = { ...defaultOptions, ...options };

    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        // If 401 Unauthorized, clear token and redirect to login
        if (response.status === 401) {
          this.clearToken();
          window.location.href = '/login.html';
        }
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
    const response = await this.request('/api/login', {
      method: 'POST',
      body: { username, password }
    });
    
    // Store the token if login successful
    if (response.token) {
      this.setToken(response.token);
    }
    
    return response;
  }

  async logout() {
    const response = await this.request('/api/logout', { method: 'POST' });
    this.clearToken();
    return response;
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

  async getStatistics(range = '24h') {
    return this.request(`/api/statistics?range=${range}`);
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

  // TLS certificate endpoints
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

  // Settings
  async getSettings() {
    return this.request('/api/settings');
  }

  async updateSettings(data) {
    return this.request('/api/settings', {
      method: 'PUT',
      body: data
    });
  }

  // Security Rules
  async getSecurityRules(type = null) {
    const query = type ? `?type=${type}` : '';
    return this.request(`/api/security/rules${query}`);
  }

  async createSecurityRule(data) {
    return this.request('/api/security/rules', {
      method: 'POST',
      body: data
    });
  }

  async updateSecurityRule(id, data) {
    return this.request(`/api/security/rules/${id}`, {
      method: 'PUT',
      body: data
    });
  }

  async deleteSecurityRule(id) {
    return this.request(`/api/security/rules/${id}`, {
      method: 'DELETE'
    });
  }

  async bulkImportSecurityRules(data) {
    return this.request('/api/security/rules/bulk', {
      method: 'POST',
      body: data
    });
  }

  // Rate Limits
  async getRateLimits(proxyId = null) {
    const query = proxyId ? `?proxy_id=${proxyId}` : '';
    return this.request(`/api/security/rate-limits${query}`);
  }

  async createRateLimit(data) {
    return this.request('/api/security/rate-limits', {
      method: 'POST',
      body: data
    });
  }

  async updateRateLimit(id, data) {
    return this.request(`/api/security/rate-limits/${id}`, {
      method: 'PUT',
      body: data
    });
  }

  async deleteRateLimit(id) {
    return this.request(`/api/security/rate-limits/${id}`, {
      method: 'DELETE'
    });
  }

  // Security Settings
  async getSecuritySettings() {
    return this.request('/api/security/settings');
  }

  async updateSecuritySettings(data) {
    return this.request('/api/security/settings', {
      method: 'PUT',
      body: data
    });
  }

  // Security Statistics
  async getSecurityStats(range = '24h') {
    return this.request(`/api/security/stats?range=${range}`);
  }

  async getRecentBlocks(limit = 50) {
    return this.request(`/api/security/recent-blocks?limit=${limit}`);
  }

  // Nginx Tuning & Statistics
  async getNginxTuningStats(hours = 24, excludePrivate = true) {
    return this.request(`/api/nginx/tuning-stats?hours=${hours}&excludePrivate=${excludePrivate}`);
  }

  async getNginxStatistics(hours = 24) {
    return this.request(`/api/nginx/statistics?hours=${hours}`);
  }

  // DNS Providers
  async getDNSProviders() {
    return this.request('/api/dns-providers');
  }

  // DNS Credentials
  async getDNSCredentials() {
    return this.request('/api/dns-credentials');
  }

  async createDNSCredential(data) {
    return this.request('/api/dns-credentials', {
      method: 'POST',
      body: data
    });
  }

  async updateDNSCredential(id, data) {
    return this.request(`/api/dns-credentials/${id}`, {
      method: 'PUT',
      body: data
    });
  }

  async deleteDNSCredential(id) {
    return this.request(`/api/dns-credentials/${id}`, {
      method: 'DELETE'
    });
  }

  // Certificate Ordering
  async orderCertificate(data) {
    return this.request('/api/certificates/order', {
      method: 'POST',
      body: data
    });
  }

  async getCertbotStatus() {
    return this.request('/api/certbot/status');
  }
}

export default new API();
