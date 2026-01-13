import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess } from '../app.js';

export async function renderSessions(container) {
  showLoading();

  try {
    const sessions = await api.getSessions();

    container.innerHTML = `
      <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
        <strong>ℹ️ Active Sessions:</strong> Manage your active login sessions across different devices and browsers.
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Your Active Sessions</h2>
          <button class="btn btn-danger" id="revokeAllBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Revoke All Other Sessions
          </button>
        </div>

        ${sessions.sessions.length === 0 ? `
          <div class="empty-state">
            <h2>No Active Sessions</h2>
            <p>You don't have any active sessions.</p>
          </div>
        ` : `
          <div class="sessions-list">
            ${sessions.sessions.map(session => renderSessionCard(session)).join('')}
          </div>
        `}
      </div>

      <div class="info-banner" style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; margin-top: 20px; border-radius: 4px;">
        <strong>ℹ️ Session Information:</strong>
        <ul style="margin: 8px 0 0 20px; padding: 0;">
          <li><strong>User Sessions:</strong> Login tokens that last 24 hours and persist across browser tabs.</li>
          <li><strong>SSE Sessions:</strong> Short-lived (1 hour) tokens used for real-time event streaming.</li>
          <li><strong>Revocation:</strong> Revoking a session will immediately log out that device/browser.</li>
          <li><strong>Security:</strong> If you see sessions you don't recognize, revoke them immediately and change your password.</li>
        </ul>
      </div>
    `;

    setupSessionHandlers(container);

  } catch (error) {
    showError(error.message);
    container.innerHTML = '<div class="empty-state"><h2>Failed to load sessions</h2></div>';
  } finally {
    hideLoading();
  }
}

function renderSessionCard(session) {
  const createdDate = new Date(session.created_at);
  const expiresDate = new Date(session.expires_at);
  const lastUsedDate = session.last_used_at ? new Date(session.last_used_at) : null;
  
  const isExpiringSoon = (expiresDate - new Date()) < 3600000; // Less than 1 hour
  const isCurrent = session.isCurrent;
  
  // Parse user agent for display
  const browser = parseUserAgent(session.user_agent);
  
  return `
    <div class="session-card ${isCurrent ? 'session-current' : ''}" data-session-id="${session.token_id}">
      <div class="session-icon">
        ${getDeviceIcon(session.user_agent)}
      </div>
      
      <div class="session-info">
        <div class="session-header">
          <h3>
            ${browser.name} on ${browser.os}
            ${isCurrent ? '<span class="session-badge session-badge-current">Current Session</span>' : ''}
            ${session.token_type === 'sse' ? '<span class="session-badge session-badge-sse">SSE</span>' : '<span class="session-badge session-badge-user">User</span>'}
          </h3>
          ${!isCurrent ? `
            <button class="btn btn-sm btn-danger revoke-session-btn" data-session-id="${session.token_id}">
              Revoke
            </button>
          ` : ''}
        </div>
        
        <div class="session-details">
          <div class="session-detail">
            <span class="session-detail-label">IP Address:</span>
            <span class="session-detail-value">${session.ip_address || 'Unknown'}</span>
          </div>
          <div class="session-detail">
            <span class="session-detail-label">Created:</span>
            <span class="session-detail-value">${formatDateTime(createdDate)}</span>
          </div>
          <div class="session-detail">
            <span class="session-detail-label">Expires:</span>
            <span class="session-detail-value ${isExpiringSoon ? 'text-warning' : ''}">${formatDateTime(expiresDate)}</span>
          </div>
          ${lastUsedDate ? `
            <div class="session-detail">
              <span class="session-detail-label">Last Used:</span>
              <span class="session-detail-value">${formatRelativeTime(lastUsedDate)}</span>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function getDeviceIcon(userAgent) {
  if (!userAgent) return getDefaultIcon();
  
  const ua = userAgent.toLowerCase();
  
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
    return `
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
        <line x1="12" y1="18" x2="12.01" y2="18"></line>
      </svg>
    `;
  }
  
  if (ua.includes('tablet') || ua.includes('ipad')) {
    return `
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
        <line x1="12" y1="18" x2="12.01" y2="18"></line>
      </svg>
    `;
  }
  
  return getDefaultIcon();
}

function getDefaultIcon() {
  return `
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
      <line x1="8" y1="21" x2="16" y2="21"></line>
      <line x1="12" y1="17" x2="12" y2="21"></line>
    </svg>
  `;
}

function parseUserAgent(userAgent) {
  if (!userAgent) {
    return { name: 'Unknown Browser', os: 'Unknown OS' };
  }

  let browser = 'Unknown Browser';
  let os = 'Unknown OS';

  // Detect browser
  if (userAgent.includes('Firefox/')) {
    browser = 'Firefox';
  } else if (userAgent.includes('Edg/')) {
    browser = 'Edge';
  } else if (userAgent.includes('Chrome/')) {
    browser = 'Chrome';
  } else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome')) {
    browser = 'Safari';
  } else if (userAgent.includes('Opera/') || userAgent.includes('OPR/')) {
    browser = 'Opera';
  }

  // Detect OS
  if (userAgent.includes('Windows')) {
    os = 'Windows';
  } else if (userAgent.includes('Mac OS X')) {
    os = 'macOS';
  } else if (userAgent.includes('Linux')) {
    os = 'Linux';
  } else if (userAgent.includes('Android')) {
    os = 'Android';
  } else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    os = 'iOS';
  }

  return { name: browser, os };
}

function formatDateTime(date) {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatRelativeTime(date) {
  const now = new Date();
  const diff = now - date;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
}

function setupSessionHandlers(container) {
  // Revoke single session
  document.querySelectorAll('.revoke-session-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const sessionId = e.target.closest('.revoke-session-btn').dataset.sessionId;
      
      if (!confirm('Are you sure you want to revoke this session? This device/browser will be logged out immediately.')) {
        return;
      }
      
      try {
        showLoading();
        await api.revokeSession(sessionId);
        showSuccess('Session revoked successfully');
        
        // Refresh the sessions list
        await renderSessions(container);
      } catch (error) {
        showError(error.message);
      } finally {
        hideLoading();
      }
    });
  });
  
  // Revoke all other sessions
  const revokeAllBtn = document.getElementById('revokeAllBtn');
  if (revokeAllBtn) {
    revokeAllBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to revoke all other sessions? All other devices/browsers will be logged out immediately.')) {
        return;
      }
      
      try {
        showLoading();
        const result = await api.revokeAllSessions();
        showSuccess(result.message || `Revoked ${result.revokedCount} session(s)`);
        
        // Refresh the sessions list
        await renderSessions(container);
      } catch (error) {
        showError(error.message);
      } finally {
        hideLoading();
      }
    });
  }
}
