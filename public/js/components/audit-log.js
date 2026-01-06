import api from '../api.js';
import { showLoading, hideLoading, showError } from '../app.js';

/**
 * Format audit log details for display
 */
function formatDetails(log) {
  if (!log.details) {
    return '-';
  }

  try {
    const details = JSON.parse(log.details);

    // Extract resource name if available
    const resourceName = details.name || '';

    // Format based on action and resource type
    if (log.action === 'create') {
      return `<strong>${resourceName}</strong>`;
    } else if (log.action === 'update') {
      return `<strong>${resourceName}</strong>`;
    } else if (log.action === 'delete') {
      return `<strong>${resourceName}</strong> (deleted)`;
    } else if (log.action === 'enable') {
      return `<strong>${resourceName}</strong> (enabled)`;
    } else if (log.action === 'disable') {
      return `<strong>${resourceName}</strong> (disabled)`;
    } else {
      return resourceName || '-';
    }
  } catch (e) {
    // If not JSON or parsing fails, show raw details (truncated)
    return `<code style="font-size: 11px;">${log.details.substring(0, 50)}...</code>`;
  }
}

/**
 * Get badge class based on action
 */
function getActionBadgeClass(action) {
  const actionLower = action.toLowerCase();
  if (actionLower === 'create') return 'badge-success';
  if (actionLower === 'delete') return 'badge-danger';
  if (actionLower === 'update') return 'badge-warning';
  if (actionLower === 'enable') return 'badge-success';
  if (actionLower === 'disable') return 'badge-secondary';
  if (actionLower === 'login' || actionLower === 'logout') return 'badge-primary';
  return 'badge-info';
}

/**
 * Format action description
 */
function formatActionDescription(log) {
  const resourceType = log.resource_type;
  const action = log.action;
  let resourceName = '';

  try {
    const details = JSON.parse(log.details || '{}');
    resourceName = details.name || '';
  } catch (e) {
    // Ignore parsing errors
  }

  // Build human-readable description
  const actionVerb = action.charAt(0).toUpperCase() + action.slice(1);
  const resourceLabel = resourceType === 'proxy' ? 'host' : resourceType;

  if (resourceName) {
    return `${actionVerb} ${resourceLabel}: <strong>${resourceName}</strong>`;
  } else {
    return `${actionVerb} ${resourceLabel}`;
  }
}

export async function renderAuditLog(container) {
  showLoading();

  try {
    const logs = await api.getAuditLog();

    if (logs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h2>No Audit Log Entries</h2>
          <p>Activity will appear here as you use the system</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="card">
          <table class="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Description</th>
                <th>IP Address</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map(log => `
                <tr>
                  <td style="white-space: nowrap;">${new Date(log.created_at).toLocaleString()}</td>
                  <td><strong>${log.username || 'System'}</strong></td>
                  <td><span class="badge ${getActionBadgeClass(log.action)}">${log.action}</span></td>
                  <td>${formatActionDescription(log)}</td>
                  <td>${log.ip_address || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

  } catch (error) {
    showError(error.message);
    container.innerHTML = '<div class="empty-state"><h2>Failed to load audit log</h2></div>';
  } finally {
    hideLoading();
  }
}
