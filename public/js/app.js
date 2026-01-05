import router from './router.js';
import state from './state.js';
import api from './api.js';
import { renderDashboard } from './components/dashboard.js';
import { renderProxies } from './components/proxy-list.js';
import { renderCertificates } from './components/ssl-manager.js';
import { renderModules } from './components/module-manager.js';
import { renderAuditLog } from './components/audit-log.js';

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
          <button class="modal-close" onclick="document.getElementById('changePasswordModal').remove()">&times;</button>
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
              <small style="color: var(--text-secondary);">Minimum 8 characters</small>
            </div>
            <div class="form-group">
              <label>Confirm New Password</label>
              <input type="password" id="confirmPassword" required autocomplete="new-password">
            </div>
            <div id="passwordError" style="color: var(--danger-color); margin-bottom: 15px; display: none;"></div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="document.getElementById('changePasswordModal').remove()">Cancel</button>
              <button type="submit" class="btn btn-primary" id="savePasswordBtn">Change Password</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('modalContainer').innerHTML = modalHTML;
  
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
console.log('Nginx Proxy Orchestra initialized');
