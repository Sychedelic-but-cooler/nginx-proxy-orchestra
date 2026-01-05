import router from './router.js';
import state from './state.js';
import api from './api.js';
import { renderDashboard } from './components/dashboard.js';
import { renderProxies } from './components/proxy-list.js';
import { renderCertificates } from './components/ssl-manager.js';
import { renderModules } from './components/module-manager.js';
import { renderAuditLog } from './components/audit-log.js';

// Main content container
const mainContent = document.getElementById('mainContent');
const headerTitle = document.getElementById('headerTitle');
const headerActions = document.getElementById('headerActions');

// Navigation items
const navItems = document.querySelectorAll('.nav-item');

/**
 * Update active nav item
 */
function updateNavigation(routeName) {
  navItems.forEach(item => {
    if (item.dataset.route === routeName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

/**
 * Show loading overlay
 */
export function showLoading() {
  document.getElementById('loadingOverlay').style.display = 'flex';
}

/**
 * Hide loading overlay
 */
export function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

/**
 * Show error message
 */
export function showError(message) {
  alert(`Error: ${message}`);
}

/**
 * Show success message
 */
export function showSuccess(message) {
  // Simple success notification
  const notification = document.createElement('div');
  notification.className = 'notification success';
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

/**
 * Set page title and actions
 */
export function setHeader(title, actions = '') {
  headerTitle.textContent = title;
  headerActions.innerHTML = actions;
}

// Register routes
router.register('/dashboard', async () => {
  updateNavigation('dashboard');
  setHeader('Dashboard');
  await renderDashboard(mainContent);
});

router.register('/proxies', async () => {
  updateNavigation('proxies');
  setHeader('Proxy Hosts', '<button id="addProxyBtn" class="btn btn-primary">+ Add Proxy</button>');
  await renderProxies(mainContent);
});

router.register('/certificates', async () => {
  updateNavigation('certificates');
  setHeader('SSL Certificates', '<button id="addCertBtn" class="btn btn-primary">+ Add Certificate</button>');
  await renderCertificates(mainContent);
});

router.register('/modules', async () => {
  updateNavigation('modules');
  setHeader('Modules', '<button id="addModuleBtn" class="btn btn-primary">+ Add Module</button>');
  await renderModules(mainContent);
});

router.register('/audit', async () => {
  updateNavigation('audit');
  setHeader('Audit Log');
  await renderAuditLog(mainContent);
});

router.register('/404', () => {
  mainContent.innerHTML = '<div class="empty-state"><h2>404 - Page Not Found</h2></div>';
});

// Logout handler
document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (confirm('Are you sure you want to logout?')) {
    try {
      await api.logout();
      window.location.href = '/';
    } catch (error) {
      console.error('Logout error:', error);
    }
  }
});

// Initialize app
console.log('Nginx Proxy Orchestra initialized');
