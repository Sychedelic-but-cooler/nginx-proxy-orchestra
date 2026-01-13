import router from './router.js';
import state from './state.js';
import api from './api.js';
import { renderDashboard } from './components/dashboard.js';
import { renderSecurityDashboard } from './components/security-dashboard.js';
import { renderNginxSecurity } from './components/nginx-security.js';
import { renderNginxStatistics } from './components/nginx-statistics.js';
import { renderProxies } from './components/proxy-list.js';
import { renderCertificates } from './components/ssl-manager.js';
import { renderModules } from './components/module-manager.js';
import { renderAuditLog } from './components/audit-log.js';
import { renderAdvancedEditor } from './components/advanced-editor.js';
import { renderSettings } from './components/settings.js';
import { renderSessions } from './components/sessions.js';
import { renderNotificationSettings } from './components/enhanced-notification-settings.js';
import { renderWAFDashboard, cleanupWAFDashboard } from './components/waf-dashboard.js';
import { renderWAFProfiles } from './components/waf-profiles.js';
import { renderWAFEvents } from './components/waf-events.js';
import { renderBannedIPs, cleanupBannedIPs } from './components/banned-ips.js';
import { renderDetectionRules } from './components/detection-rules.js';
import { renderBanIntegrations } from './components/ban-integrations.js';

// Check authentication on app load
if (!api.getToken()) {
  window.location.href = '/login.html';
}

// Decode JWT to get username (simple base64 decode of payload)
function getUsernameFromToken() {
  const token = api.getToken();
  if (!token) return 'User';
  
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return decoded.username || 'User';
  } catch (error) {
    return 'User';
  }
}

// Display username in header
document.getElementById('usernameDisplay').textContent = getUsernameFromToken();

// Theme toggle functionality
const themeToggle = document.getElementById('themeToggle');
const sunIcon = document.getElementById('sunIcon');
const moonIcon = document.getElementById('moonIcon');

// Check for saved theme preference or default to light mode
const currentTheme = localStorage.getItem('theme') || 'light';
if (currentTheme === 'dark') {
  document.body.classList.add('dark-mode');
  sunIcon.style.display = 'none';
  moonIcon.style.display = 'block';
}

themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  
  if (document.body.classList.contains('dark-mode')) {
    localStorage.setItem('theme', 'dark');
    sunIcon.style.display = 'none';
    moonIcon.style.display = 'block';
  } else {
    localStorage.setItem('theme', 'light');
    sunIcon.style.display = 'block';
    moonIcon.style.display = 'none';
  }
});

// Main content container
const mainContent = document.getElementById('mainContent');
const headerTitle = document.getElementById('headerTitle');
const headerActions = document.getElementById('headerActions');

// Navigation items (includes both nav-item and nav-subitem)
const navItems = document.querySelectorAll('.nav-item, .nav-subitem');
const navGroups = document.querySelectorAll('.nav-group');

/**
 * Update active nav item and expand parent groups
 */
function updateNavigation(routeName) {
  navItems.forEach(item => {
    if (item.dataset.route === routeName) {
      item.classList.add('active');

      // If this is a subitem, expand its parent group
      const parentGroup = item.closest('.nav-group');
      if (parentGroup) {
        parentGroup.classList.remove('collapsed');
      }
    } else {
      item.classList.remove('active');
    }
  });
}

/**
 * Setup collapsible navigation groups
 */
function setupNavigationGroups() {
  document.querySelectorAll('.nav-group-header').forEach(header => {
    header.addEventListener('click', () => {
      const group = header.closest('.nav-group');
      group.classList.toggle('collapsed');
    });
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

// Security sub-routes
router.register('/security/tuning', async () => {
  updateNavigation('security/tuning');
  await renderNginxSecurity(mainContent);
});

// Alias for renamed route
router.register('/security/nginx', async () => {
  updateNavigation('security/nginx');
  await renderNginxSecurity(mainContent);
});

router.register('/security/statistics', async () => {
  updateNavigation('security/statistics');
  setHeader('Traffic & Performance');
  await renderNginxStatistics(mainContent);
});

router.register('/security/waf', async () => {
  updateNavigation('waf/dashboard');
  await renderWAFDashboard(mainContent);
});

// WAF sub-routes
router.register('/waf/profiles', async () => {
  updateNavigation('waf/profiles');
  await renderWAFProfiles(mainContent);
});

router.register('/waf/events', async () => {
  updateNavigation('waf/events');
  await renderWAFEvents(mainContent);
});

router.register('/waf/bans', async () => {
  updateNavigation('waf/bans');
  setHeader('Banned IPs', '<button id="addBanBtn" class="btn btn-primary">+ Ban IP</button>');
  await renderBannedIPs(mainContent);
});

router.register('/waf/detection-rules', async () => {
  updateNavigation('waf/detection-rules');
  setHeader('Detection Rules', '<button id="addRuleBtn" class="btn btn-primary">+ Add Rule</button>');
  await renderDetectionRules(mainContent);
});

// Redirect old routes to new tuning dashboard
router.register('/security/nginx', async () => {
  router.navigate('/security/tuning');
});

router.register('/security', async () => {
  router.navigate('/security/tuning');
});

router.register('/proxies', async () => {
  updateNavigation('proxies');
  setHeader('Proxy Hosts', '<button id="addProxyBtn" class="btn btn-primary">+ Add Proxy</button>');
  await renderProxies(mainContent);
});

router.register('/certificates', async () => {
  updateNavigation('certificates');
  setHeader('TLS Certificates', `
    <div style="display: flex; gap: 10px;">
      <button id="addCertBtn" class="btn btn-primary">Upload Certificate</button>
      <button id="orderCertBtn" class="btn btn-primary">Order Certificate</button>
      <button id="apiSecretsBtn" class="btn btn-primary">API Secrets</button>
    </div>
  `);
  await renderCertificates(mainContent);
});

router.register('/modules', async () => {
  updateNavigation('modules');
  setHeader('Modular Configs', '<button id="addModuleBtn" class="btn btn-primary">+ Add Module</button>');
  await renderModules(mainContent);
});

router.register('/audit', async () => {
  updateNavigation('audit');
  setHeader('Audit Logs');
  await renderAuditLog(mainContent);
});

// Settings sub-routes
router.register('/settings/general', async () => {
  updateNavigation('settings/general');
  setHeader('General Settings');
  await renderSettings(mainContent, 'general');
});

router.register('/settings/security', async () => {
  updateNavigation('settings/security');
  setHeader('Security Settings');
  await renderSettings(mainContent, 'security');
});

router.register('/settings/notifications', async () => {
  updateNavigation('settings/notifications');
  await renderNotificationSettings(mainContent);
});

router.register('/settings/sessions', async () => {
  updateNavigation('settings/sessions');
  setHeader('Active Sessions');
  await renderSessions(mainContent);
});

router.register('/settings/integrations', async () => {
  updateNavigation('settings/integrations');
  setHeader('Ban Integrations', '<button id="addIntegrationBtn" class="btn btn-primary">+ Add Integration</button>');
  await renderBanIntegrations(mainContent);
});

// Redirect old /settings route to /settings/general
router.register('/settings', async () => {
  router.navigate('/settings/general');
});

router.register('/advanced', async () => {
  updateNavigation('advanced');
  setHeader('Advanced Config Editor');
  await renderAdvancedEditor(mainContent);
});

router.register('/404', () => {
  mainContent.innerHTML = '<div class="empty-state"><h2>404 - Page Not Found</h2></div>';
});

// User menu dropdown toggle
const userMenuBtn = document.getElementById('userMenuBtn');
const userDropdown = document.getElementById('userDropdown');

userMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isVisible = userDropdown.style.display === 'block';
  userDropdown.style.display = isVisible ? 'none' : 'block';
});

// Close dropdown when clicking outside
document.addEventListener('click', () => {
  userDropdown.style.display = 'none';
});

userDropdown.addEventListener('click', (e) => {
  e.stopPropagation();
});

// Change password handler
document.getElementById('changePasswordBtn').addEventListener('click', () => {
  userDropdown.style.display = 'none';
  showChangePasswordModal();
});

// Sign out handler
document.getElementById('signOutBtn').addEventListener('click', async () => {
  userDropdown.style.display = 'none';
  if (confirm('Are you sure you want to sign out?')) {
    try {
      await api.logout();
      window.location.href = '/login.html';
    } catch (error) {
      console.error('Logout error:', error);
      // Clear token anyway and redirect
      api.clearToken();
      window.location.href = '/login.html';
    }
  }
});

/**
 * Show change password modal
 */
function showChangePasswordModal() {
  const modalHTML = `
    <div class="modal-overlay" id="changePasswordModal">
      <div class="modal">
        <div class="modal-header">
          <h3>Change Password</h3>
          <button class="modal-close" id="closePasswordModal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="changePasswordForm">
            <div class="form-group">
              <label>Current Password</label>
              <input type="password" id="currentPassword" required autocomplete="current-password">
            </div>
            <div class="form-group">
              <label>New Password</label>
              <input type="password" id="newPassword" required autocomplete="new-password" minlength="8">
              <small>Minimum 8 characters</small>
            </div>
            <div class="form-group">
              <label>Confirm New Password</label>
              <input type="password" id="confirmPassword" required autocomplete="new-password">
            </div>
            <div id="passwordError" style="color: var(--danger-color); margin-bottom: 15px; display: none;"></div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="cancelPasswordBtn">Cancel</button>
          <button type="submit" form="changePasswordForm" class="btn btn-primary" id="savePasswordBtn">Change Password</button>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('modalContainer').innerHTML = modalHTML;
  
  // Close button handlers
  document.getElementById('closePasswordModal').addEventListener('click', () => {
    document.getElementById('changePasswordModal').remove();
  });
  
  document.getElementById('cancelPasswordBtn').addEventListener('click', () => {
    document.getElementById('changePasswordModal').remove();
  });
  
  document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorDiv = document.getElementById('passwordError');
    const saveBtn = document.getElementById('savePasswordBtn');
    
    // Validation
    if (newPassword !== confirmPassword) {
      errorDiv.textContent = 'New passwords do not match';
      errorDiv.style.display = 'block';
      return;
    }
    
    if (newPassword.length < 8) {
      errorDiv.textContent = 'Password must be at least 8 characters';
      errorDiv.style.display = 'block';
      return;
    }
    
    errorDiv.style.display = 'none';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Changing...';
    
    try {
      await api.changePassword(currentPassword, newPassword);
      alert('Password changed successfully! Please log in again.');
      api.clearToken();
      window.location.href = '/login.html';
    } catch (error) {
      errorDiv.textContent = error.message || 'Failed to change password';
      errorDiv.style.display = 'block';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Change Password';
    }
  });
}

// Logout handler (kept for backward compatibility)
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to logout?')) {
      try {
        await api.logout();
        window.location.href = '/login.html';
      } catch (error) {
        console.error('Logout error:', error);
        api.clearToken();
        window.location.href = '/login.html';
      }
    }
  });
}

// Initialize app
setupNavigationGroups();
