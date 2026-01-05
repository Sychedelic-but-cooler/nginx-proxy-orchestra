import api from '../api.js';
import { showLoading, hideLoading, showError } from '../app.js';

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
                <th>Resource Type</th>
                <th>Resource ID</th>
                <th>IP Address</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map(log => `
                <tr>
                  <td>${new Date(log.created_at).toLocaleString()}</td>
                  <td>${log.username || 'System'}</td>
                  <td><span class="badge badge-info">${log.action}</span></td>
                  <td>${log.resource_type}</td>
                  <td>${log.resource_id || '-'}</td>
                  <td>${log.ip_address || '-'}</td>
                  <td>${log.details ? `<code style="font-size: 11px;">${log.details.substring(0, 50)}...</code>` : '-'}</td>
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
