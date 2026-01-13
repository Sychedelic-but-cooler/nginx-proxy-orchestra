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

  // Session management endpoints
  async getSessions() {
    return this.request('/api/sessions');
  }

  async getAllSessions() {
    return this.request('/api/sessions/all');
  }

  async revokeSession(tokenId) {
    return this.request(`/api/sessions/${tokenId}`, {
      method: 'DELETE'
    });
  }

  async revokeAllSessions() {
    return this.request('/api/sessions/revoke-all', {
      method: 'POST'
    });
  }

  async generateSSEToken() {
    return this.request('/api/user/sse-token', {
      method: 'POST'
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

  // ============================================================================
  // WAF Methods
  // ============================================================================

  // WAF Profiles
  async getWAFProfiles() {
    return this.request('/api/waf/profiles');
  }

  async createWAFProfile(data) {
    return this.request('/api/waf/profiles', {
      method: 'POST',
      body: data
    });
  }

  async updateWAFProfile(id, data) {
    return this.request(`/api/waf/profiles/${id}`, {
      method: 'PUT',
      body: data
    });
  }

  async deleteWAFProfile(id) {
    return this.request(`/api/waf/profiles/${id}`, {
      method: 'DELETE'
    });
  }

  async getWAFProfileConfig(id) {
    return this.request(`/api/waf/profiles/${id}/config`);
  }

  // WAF Events
  async getWAFEvents(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        params.append(key, value);
      }
    });
    const queryString = params.toString();
    return this.request(`/api/waf/events${queryString ? '?' + queryString : ''}`);
  }

  async getWAFStats(hours = 24) {
    return this.request(`/api/waf/stats?hours=${hours}`);
  }

  // WAF Exclusions
  async getWAFExclusions(profileId = null) {
    const query = profileId ? `?profile_id=${profileId}` : '';
    return this.request(`/api/waf/exclusions${query}`);
  }

  async createWAFExclusion(data) {
    return this.request('/api/waf/exclusions', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async deleteWAFExclusion(id) {
    return this.request(`/api/waf/exclusions/${id}`, {
      method: 'DELETE'
    });
  }

  // Proxy WAF Assignment
  async assignWAFProfile(proxyId, profileId) {
    return this.request(`/api/proxies/${proxyId}/waf`, {
      method: 'POST',
      body: { profile_id: profileId }
    });
  }

  async removeWAFProfile(proxyId) {
    return this.request(`/api/proxies/${proxyId}/waf`, {
      method: 'DELETE'
    });
  }

  // Notification Settings
  async getNotificationSettings() {
    return this.request('/api/settings/notifications');
  }

  async updateNotificationSettings(data) {
    return this.request('/api/settings/notifications', {
      method: 'PUT',
      body: data
    });
  }

  async testNotification() {
    return this.request('/api/notifications/test', {
      method: 'POST'
    });
  }

  // Enhanced Notification Features
  async getWAFMatrix() {
    return this.request('/api/notifications/matrix');
  }

  async updateWAFMatrix(data) {
    return this.request('/api/notifications/matrix', {
      method: 'PUT',
      body: data
    });
  }

  async getNotificationSchedules() {
    return this.request('/api/notifications/schedules');
  }

  async updateNotificationSchedules(data) {
    return this.request('/api/notifications/schedules', {
      method: 'PUT', 
      body: data
    });
  }

  async getNotificationTemplates() {
    return this.request('/api/notifications/templates');
  }

  async getNotificationHistory(limit = 25, offset = 0) {
    return this.request(`/api/notifications/history?limit=${limit}&offset=${offset}`);
  }

  // Credentials Management
  async getCredentials(type = null) {
    const query = type ? `?type=${type}` : '';
    return this.request(`/api/credentials${query}`);
  }

  async createCredential(data) {
    return this.request('/api/credentials', {
      method: 'POST',
      body: data
    });
  }

  async updateCredential(id, data) {
    return this.request(`/api/credentials/${id}`, {
      method: 'PUT',
      body: data
    });
  }

  async deleteCredential(id) {
    return this.request(`/api/credentials/${id}`, {
      method: 'DELETE'
    });
  }

  // Ban System Methods

  // Ban Integrations
  async getBanIntegrations() {
    return this.request('/api/ban/integrations');
  }

  async createBanIntegration(data) {
    return this.request('/api/ban/integrations', {
      method: 'POST',
      body: data
    });
  }

  async updateBanIntegration(id, data) {
    return this.request(`/api/ban/integrations/${id}`, {
      method: 'PUT',
      body: data
    });
  }

  async deleteBanIntegration(id) {
    return this.request(`/api/ban/integrations/${id}`, {
      method: 'DELETE'
    });
  }

  async testBanIntegration(id) {
    return this.request(`/api/ban/integrations/${id}/test`, {
      method: 'POST'
    });
  }

  // IP Bans
  async getBans(limit = 100) {
    return this.request(`/api/ban/bans?limit=${limit}`);
  }

  async createBan(data) {
    return this.request('/api/ban/bans', {
      method: 'POST',
      body: data
    });
  }

  async unban(id) {
    return this.request(`/api/ban/bans/${id}`, {
      method: 'DELETE'
    });
  }

  async makeBanPermanent(id) {
    return this.request(`/api/ban/bans/${id}/permanent`, {
      method: 'PUT'
    });
  }

  async getBanStats() {
    return this.request('/api/ban/bans/stats');
  }

  // IP Whitelist
  async getWhitelist() {
    return this.request('/api/ban/whitelist');
  }

  async addToWhitelist(data) {
    return this.request('/api/ban/whitelist', {
      method: 'POST',
      body: data
    });
  }

  async removeFromWhitelist(id) {
    return this.request(`/api/ban/whitelist/${id}`, {
      method: 'DELETE'
    });
  }

  // Detection Rules
  async getDetectionRules() {
    return this.request('/api/ban/detection-rules');
  }

  async createDetectionRule(data) {
    return this.request('/api/ban/detection-rules', {
      method: 'POST',
      body: data
    });
  }

  async updateDetectionRule(id, data) {
    return this.request(`/api/ban/detection-rules/${id}`, {
      method: 'PUT',
      body: data
    });
  }

  async deleteDetectionRule(id) {
    return this.request(`/api/ban/detection-rules/${id}`, {
      method: 'DELETE'
    });
  }

  async toggleDetectionRule(id) {
    return this.request(`/api/ban/detection-rules/${id}/toggle`, {
      method: 'POST'
    });
  }

  // Queue Status
  async getQueueStatus() {
    return this.request('/api/ban/queue/status');
  }

  // SSE Connection for real-time WAF events
  createWAFEventStream() {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token found');
    }

    // Note: EventSource doesn't support custom headers in browsers
    // Pass the token as a query parameter instead
    const eventSource = new EventSource(`/api/waf/events/stream?token=${encodeURIComponent(token)}`);
    return eventSource;
  }

  // SSE Connection for real-time proxy events
  createProxyEventStream() {
    const token = this.getToken();
    if (!token) {
      throw new Error('No authentication token found');
    }

    // Note: EventSource doesn't support custom headers in browsers
    // Pass the token as a query parameter instead
    const eventSource = new EventSource(`/api/proxy/events/stream?token=${encodeURIComponent(token)}`);
    return eventSource;
  }

  // Bulk proxy operations
  async bulkToggleProxies(ids, enabled) {
    return this.request('/api/proxies/bulk/toggle', {
      method: 'POST',
      body: { ids, enabled }
    });
  }

  async bulkDeleteProxies(ids) {
    return this.request('/api/proxies/bulk/delete', {
      method: 'POST',
      body: { ids }
    });
  }
}

export default new API();
