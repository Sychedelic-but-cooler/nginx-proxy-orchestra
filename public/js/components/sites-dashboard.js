import api from '../api.js';
import { showLoading, hideLoading, showError, setHeader } from '../app.js';

export async function renderSitesDashboard(container) {
    setHeader('Sites Dashboard');
    showLoading();
    
    try {
        // Fetch sites data (proxies)
        const sites = await api.getProxies();
        
        // Count sites by status
        const enabledSites = sites.filter(s => s.enabled).length;
        const disabledSites = sites.filter(s => !s.enabled).length;
        const totalSites = sites.length;
        
        container.innerHTML = `
            <div class="sites-dashboard">
                <!-- Summary Cards -->
                <div class="dashboard-grid">
                    <div class="dashboard-card">
                        <div class="card-icon">🌐</div>
                        <div class="card-content">
                            <h3>Total Sites</h3>
                            <div class="card-value">${totalSites}</div>
                            <div class="card-label">Configured proxy sites</div>
                        </div>
                    </div>
                    
                    <div class="dashboard-card success">
                        <div class="card-icon">✓</div>
                        <div class="card-content">
                            <h3>Enabled</h3>
                            <div class="card-value">${enabledSites}</div>
                            <div class="card-label">Active sites</div>
                        </div>
                    </div>
                    
                    <div class="dashboard-card ${disabledSites > 0 ? 'warning' : ''}">
                        <div class="card-icon">○</div>
                        <div class="card-content">
                            <h3>Disabled</h3>
                            <div class="card-value">${disabledSites}</div>
                            <div class="card-label">Inactive sites</div>
                        </div>
                    </div>
                </div>

                ${sites.length === 0 ? `
                    <div class="info-box">
                        <div class="info-icon">ℹ</div>
                        <div class="info-content">
                            <h4>No Sites Configured</h4>
                            <p>You haven't configured any proxy sites yet. Get started by adding your first site.</p>
                            <button class="btn btn-primary" id="add-first-site">
                                <span class="icon">+</span> Add Your First Site
                            </button>
                        </div>
                    </div>
                ` : `
                    <!-- Sites List -->
                    <div class="dashboard-section">
                        <div class="section-header">
                            <h2>Recent Sites</h2>
                            <button class="btn btn-primary" id="view-all-sites">
                                View All Sites →
                            </button>
                        </div>
                        
                        <div class="sites-list">
                            ${renderSitesList(sites.slice(0, 5))}
                        </div>
                    </div>

                    <!-- Quick Actions -->
                    <div class="dashboard-section">
                        <div class="section-header">
                            <h2>Quick Actions</h2>
                        </div>
                        <div class="quick-actions-grid">
                            <button class="action-card" id="add-new-site">
                                <span class="action-icon">+</span>
                                <span class="action-label">Add New Site</span>
                            </button>
                            <button class="action-card" id="manage-certificates">
                                <span class="action-icon">🔒</span>
                                <span class="action-label">Manage SSL Certificates</span>
                            </button>
                            <button class="action-card" id="test-nginx-config">
                                <span class="action-icon">✓</span>
                                <span class="action-label">Test Nginx Config</span>
                            </button>
                            <button class="action-card" id="reload-nginx">
                                <span class="action-icon">↻</span>
                                <span class="action-label">Reload Nginx</span>
                            </button>
                        </div>
                    </div>
                `}
            </div>
        `;
        
        setupSitesDashboardHandlers();
    } catch (error) {
        showError(error.message || 'Failed to load sites dashboard');
    } finally {
        hideLoading();
    }
}

function renderSitesList(sites) {
    if (!sites || sites.length === 0) {
        return '<p class="empty-state">No sites to display</p>';
    }
    
    return sites.map(site => `
        <div class="site-item ${site.enabled ? 'enabled' : 'disabled'}">
            <div class="site-status">
                <span class="status-indicator ${site.enabled ? 'status-success' : 'status-warning'}"></span>
            </div>
            <div class="site-info">
                <div class="site-name">${escapeHtml(site.server_name)}</div>
                <div class="site-meta">
                    <span class="site-upstream">${escapeHtml(site.upstream_url)}</span>
                    ${site.ssl_enabled ? '<span class="badge badge-success">SSL</span>' : ''}
                    ${site.waf_enabled ? '<span class="badge badge-primary">WAF</span>' : ''}
                </div>
            </div>
            <div class="site-actions">
                <button class="btn btn-sm btn-secondary view-site-btn" data-site-id="${site.id}">
                    View
                </button>
            </div>
        </div>
    `).join('');
}

function setupSitesDashboardHandlers() {
    // Navigate to sites page
    const viewAllBtn = document.getElementById('view-all-sites');
    if (viewAllBtn) {
        viewAllBtn.addEventListener('click', () => {
            window.location.hash = '#/sites';
        });
    }
    
    // Add first site
    const addFirstSiteBtn = document.getElementById('add-first-site');
    if (addFirstSiteBtn) {
        addFirstSiteBtn.addEventListener('click', () => {
            window.location.hash = '#/sites';
        });
    }
    
    // Add new site
    const addNewSiteBtn = document.getElementById('add-new-site');
    if (addNewSiteBtn) {
        addNewSiteBtn.addEventListener('click', () => {
            window.location.hash = '#/sites';
        });
    }
    
    // Manage certificates
    const manageCertsBtn = document.getElementById('manage-certificates');
    if (manageCertsBtn) {
        manageCertsBtn.addEventListener('click', () => {
            window.location.hash = '#/certificates';
        });
    }
    
    // Test nginx config
    const testConfigBtn = document.getElementById('test-nginx-config');
    if (testConfigBtn) {
        testConfigBtn.addEventListener('click', async () => {
            try {
                showLoading();
                const result = await api.testNginxConfig();
                if (result.success) {
                    alert('✓ Nginx configuration test successful');
                } else {
                    alert(`✗ Configuration test failed:\n${result.output}`);
                }
            } catch (error) {
                showError(error.message || 'Failed to test configuration');
            } finally {
                hideLoading();
            }
        });
    }
    
    // Reload nginx
    const reloadBtn = document.getElementById('reload-nginx');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', async () => {
            if (!confirm('Reload Nginx? This will apply any configuration changes.')) {
                return;
            }
            try {
                showLoading();
                const result = await api.reloadNginx();
                if (result.success) {
                    alert('✓ Nginx reloaded successfully');
                } else {
                    alert(`✗ Failed to reload Nginx:\n${result.message}`);
                }
            } catch (error) {
                showError(error.message || 'Failed to reload Nginx');
            } finally {
                hideLoading();
            }
        });
    }
    
    // View individual site
    document.querySelectorAll('.view-site-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const siteId = e.currentTarget.getAttribute('data-site-id');
            window.location.hash = `#/sites`;
        });
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
