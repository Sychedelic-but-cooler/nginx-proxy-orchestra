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

router.register('/settings/error-pages', async () => {
  updateNavigation('settings/error-pages');
  setHeader('Custom Error Pages');
  await renderSettings(mainContent, 'error-pages');
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

// Manage 2FA handler
document.getElementById('manage2FABtn').addEventListener('click', () => {
  userDropdown.style.display = 'none';
  show2FAModal();
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
async function showChangePasswordModal() {
  // Check if user has 2FA enabled
  let requires2FA = false;
  try {
    const status = await api.getTOTPStatus();
    requires2FA = status.enabled;
  } catch (error) {
    console.error('Failed to check 2FA status:', error);
  }

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
            ${requires2FA ? `
            <div class="form-group">
              <label>Authenticator Code</label>
              <input type="text" id="totpCode" placeholder="000000" maxlength="6" pattern="[0-9]{6}" 
                     style="text-align: center; font-size: 18px; letter-spacing: 4px;">
              <small>Enter your 6-digit code from your authenticator app</small>
            </div>
            ` : ''}
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
    const totpCode = requires2FA ? document.getElementById('totpCode')?.value : null;
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

    if (requires2FA && (!totpCode || !/^\d{6}$/.test(totpCode))) {
      errorDiv.textContent = 'Please enter a valid 6-digit authenticator code';
      errorDiv.style.display = 'block';
      return;
    }
    
    errorDiv.style.display = 'none';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Changing...';
    
    try {
      // Call the API with updated signature that includes totpCode
      const response = await fetch('/api/user/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api.getToken()}`
        },
        body: JSON.stringify({ 
          currentPassword, 
          newPassword,
          ...(totpCode && { totpCode })
        })
      });

      const data = await response.json();

      if (response.ok) {
        alert('Password changed successfully! Please log in again.');
        api.clearToken();
        window.location.href = '/login.html';
      } else {
        throw new Error(data.error || data.message || 'Failed to change password');
      }
    } catch (error) {
      errorDiv.textContent = error.message || 'Failed to change password';
      errorDiv.style.display = 'block';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Change Password';
    }
  });
}

/**
 * Show 2FA management modal
 */
async function show2FAModal() {
  // First, get the current 2FA status
  let status;
  try {
    status = await api.getTOTPStatus();
  } catch (error) {
    alert('Failed to load 2FA status: ' + error.message);
    return;
  }

  const is2FAEnabled = status.enabled;

  const modalHTML = `
    <div class="modal-overlay" id="twoFAModal">
      <div class="modal modal-wide">
        <div class="modal-header">
          <h3>Two-Factor Authentication (2FA)</h3>
          <button class="modal-close" id="close2FAModal">&times;</button>
        </div>
        <div class="modal-body">
          <div id="twoFAContent">
            ${is2FAEnabled ? getEnabledContent() : getDisabledContent()}
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('modalContainer').innerHTML = modalHTML;
  
  // Close button handler
  document.getElementById('close2FAModal').addEventListener('click', () => {
    document.getElementById('twoFAModal').remove();
  });

  // Set up event listeners based on state
  if (is2FAEnabled) {
    setup2FAEnabledListeners();
  } else {
    setup2FADisabledListeners();
  }
}

function getDisabledContent() {
  return `
    <div class="info-box">
      <p><strong>Two-factor authentication is not enabled.</strong></p>
      <p>Add an extra layer of security to your account by requiring a code from your authenticator app when logging in.</p>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-primary" id="enable2FABtn">Enable 2FA</button>
      <button type="button" class="btn btn-secondary" id="cancel2FABtn">Cancel</button>
    </div>
  `;
}

function getEnabledContent() {
  return `
    <div class="info-box info-box-success">
      <p><strong>Two-factor authentication is enabled.</strong></p>
      <p>Your account is protected with 2FA. You'll need to enter a code from your authenticator app when logging in.</p>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-warning" id="regenerateRecoveryBtn">Regenerate Recovery Key</button>
      <button type="button" class="btn btn-danger" id="disable2FABtn">Disable 2FA</button>
      <button type="button" class="btn btn-secondary" id="cancel2FABtn">Cancel</button>
    </div>
  `;
}

function setup2FADisabledListeners() {
  document.getElementById('cancel2FABtn').addEventListener('click', () => {
    document.getElementById('twoFAModal').remove();
  });

  document.getElementById('enable2FABtn').addEventListener('click', async () => {
    // Show setup flow
    const content = document.getElementById('twoFAContent');
    content.innerHTML = `
      <div class="loading-message">Setting up 2FA...</div>
    `;

    try {
      const response = await api.setupTOTP();
      
      content.innerHTML = `
        <div class="totp-setup">
          <h4>Step 1: Scan QR Code</h4>
          <p>Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.):</p>
          <div style="text-align: center; margin: 20px 0;">
            <img src="${response.qrCode}" alt="QR Code" style="max-width: 300px;">
          </div>
          <p><strong>Or enter this code manually:</strong></p>
          <div style="background: #f5f5f5; padding: 15px; border-radius: 4px; margin: 15px 0; font-family: monospace; word-break: break-all;">
            ${response.secret}
          </div>
          
          <h4>Step 2: Verify Code</h4>
          <p>Enter the 6-digit code from your authenticator app to verify:</p>
          <div class="form-group">
            <input type="text" id="verificationCode" placeholder="000000" maxlength="6" pattern="[0-9]{6}" 
                   style="text-align: center; font-size: 24px; letter-spacing: 8px;">
          </div>
          <div id="verifyError" style="color: var(--danger-color); margin: 10px 0; display: none;"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" id="verify2FABtn">Verify and Enable</button>
          <button type="button" class="btn btn-secondary" id="cancelSetup2FABtn">Cancel</button>
        </div>
      `;

      document.getElementById('cancelSetup2FABtn').addEventListener('click', () => {
        document.getElementById('twoFAModal').remove();
      });

      document.getElementById('verify2FABtn').addEventListener('click', async () => {
        const code = document.getElementById('verificationCode').value;
        const errorDiv = document.getElementById('verifyError');
        const verifyBtn = document.getElementById('verify2FABtn');

        if (!/^\d{6}$/.test(code)) {
          errorDiv.textContent = 'Please enter a valid 6-digit code';
          errorDiv.style.display = 'block';
          return;
        }

        errorDiv.style.display = 'none';
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying...';

        try {
          const verifyResponse = await api.verifyTOTP(code);
          
          // Show recovery key
          content.innerHTML = `
            <div class="info-box info-box-success">
              <h4>2FA Enabled Successfully!</h4>
              <p><strong>IMPORTANT: Save your recovery key</strong></p>
              <p>If you lose access to your authenticator app, you can use this recovery key to log in:</p>
              <div style="background: #fff3cd; padding: 20px; border-radius: 4px; margin: 15px 0; border: 2px solid #ffc107;">
                <div style="font-family: monospace; font-size: 14px; word-break: break-all; line-height: 1.8;">
                  ${verifyResponse.recoveryKey}
                </div>
              </div>
              <p style="color: #d73a49; font-weight: bold;">Store this recovery key in a safe place. You won't be able to see it again!</p>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-primary" id="done2FABtn">Done</button>
            </div>
          `;

          document.getElementById('done2FABtn').addEventListener('click', () => {
            document.getElementById('twoFAModal').remove();
          });
        } catch (error) {
          errorDiv.textContent = error.message || 'Verification failed';
          errorDiv.style.display = 'block';
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify and Enable';
        }
      });
    } catch (error) {
      content.innerHTML = `
        <div class="error-box">
          <p><strong>Error:</strong> ${error.message || 'Failed to setup 2FA'}</p>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="closeError2FABtn">Close</button>
        </div>
      `;
      
      document.getElementById('closeError2FABtn').addEventListener('click', () => {
        document.getElementById('twoFAModal').remove();
      });
    }
  });
}

function setup2FAEnabledListeners() {
  document.getElementById('cancel2FABtn').addEventListener('click', () => {
    document.getElementById('twoFAModal').remove();
  });

  document.getElementById('regenerateRecoveryBtn').addEventListener('click', async () => {
    const password = prompt('Enter your password to regenerate recovery key:');
    if (!password) return;

    try {
      const response = await api.regenerateRecoveryKey(password);
      
      const content = document.getElementById('twoFAContent');
      content.innerHTML = `
        <div class="info-box info-box-success">
          <h4>New Recovery Key Generated</h4>
          <p><strong>IMPORTANT: Save your new recovery key</strong></p>
          <div style="background: #fff3cd; padding: 20px; border-radius: 4px; margin: 15px 0; border: 2px solid #ffc107;">
            <div style="font-family: monospace; font-size: 14px; word-break: break-all; line-height: 1.8;">
              ${response.recoveryKey}
            </div>
          </div>
          <p style="color: #d73a49; font-weight: bold;">Store this recovery key in a safe place. Your old recovery key is no longer valid!</p>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" id="done2FABtn">Done</button>
        </div>
      `;

      document.getElementById('done2FABtn').addEventListener('click', () => {
        document.getElementById('twoFAModal').remove();
      });
    } catch (error) {
      alert('Failed to regenerate recovery key: ' + error.message);
    }
  });

  document.getElementById('disable2FABtn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to disable 2FA? Your account will be less secure.')) {
      return;
    }

    const password = prompt('Enter your password to disable 2FA:');
    if (!password) return;

    try {
      await api.disableTOTP(password);
      alert('2FA has been disabled');
      document.getElementById('twoFAModal').remove();
    } catch (error) {
      alert('Failed to disable 2FA: ' + error.message);
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
