import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess } from '../app.js';

export async function renderSettings(container) {
  showLoading();

  try {
    const [settings, certificates] = await Promise.all([
      api.getSettings(),
      api.getCertificates()
    ]);

    container.innerHTML = `
      <div class="card">
        <h2>System Settings</h2>
        <form id="settingsForm">
          <div class="form-group">
            <label for="defaultBehavior">Default Server Behavior</label>
            <p class="form-help">Choose what happens when someone accesses a disabled or non-existent proxy host</p>
            <select id="defaultBehavior" class="form-control" required>
              <option value="drop" ${settings.default_server_behavior === 'drop' ? 'selected' : ''}>Drop Connection (444)</option>
              <option value="404" ${settings.default_server_behavior === '404' ? 'selected' : ''}>Return 404 Not Found</option>
              <option value="custom" ${settings.default_server_behavior === 'custom' ? 'selected' : ''}>Redirect to Custom URL</option>
            </select>
          </div>

          <div class="form-group" id="customUrlGroup" style="display: ${settings.default_server_behavior === 'custom' ? 'block' : 'none'};">
            <label for="customUrl">Custom Redirect URL</label>
            <p class="form-help">Enter the full URL where users should be redirected (e.g., https://example.com/unavailable)</p>
            <input
              type="url"
              id="customUrl"
              class="form-control"
              placeholder="https://example.com/unavailable"
              value="${settings.default_server_custom_url || ''}"
            >
          </div>

          <div class="info-banner" style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
            <strong>ℹ️ About Default Server Behavior:</strong>
            <ul style="margin: 8px 0 0 20px; padding: 0;">
              <li><strong>Drop Connection (444):</strong> Nginx closes the connection immediately without sending a response. Most secure option.</li>
              <li><strong>Return 404:</strong> Returns a standard 404 Not Found error to the browser. Clear indication that the host doesn't exist.</li>
              <li><strong>Redirect to Custom URL:</strong> Redirects users to a custom page where you can explain the situation or show branding.</li>
            </ul>
          </div>

          <hr style="margin: 30px 0; border: none; border-top: 1px solid var(--border-color);">

          <h3 style="margin-bottom: 16px;">Admin Interface Certificate</h3>

          <div class="form-group">
            <label for="adminCert">TLS Certificate for Admin Interface</label>
            <p class="form-help">Select a certificate to use for the admin interface HTTPS. Leave unselected to use the self-signed certificate.</p>
            ${certificates.length === 0 ? `
              <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 12px; border-radius: 4px;">
                <strong>ℹ️ No certificates available.</strong> Upload a certificate on the <a href="#/certificates" style="color: var(--primary-color); text-decoration: underline;">TLS Certificates</a> tab first.
              </div>
            ` : ''}
            <select id="adminCert" class="form-control">
              <option value="">Self-Signed Certificate (Default)</option>
              ${certificates.map(cert => `
                <option value="${cert.id}" ${settings.admin_cert_id == cert.id ? 'selected' : ''}>
                  ${cert.name} - ${cert.domain_names}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="info-banner" style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
            <strong>⚠️ Important:</strong> Changing the admin interface certificate requires a server restart to take effect. You will need to manually restart the Node.js server after saving.
          </div>

          <button type="submit" class="btn btn-primary">Save Settings</button>
        </form>
      </div>
    `;

    // Event listeners
    const form = document.getElementById('settingsForm');
    const behaviorSelect = document.getElementById('defaultBehavior');
    const customUrlGroup = document.getElementById('customUrlGroup');
    const customUrlInput = document.getElementById('customUrl');
    const adminCertSelect = document.getElementById('adminCert');

    // Show/hide custom URL field based on selection
    behaviorSelect.addEventListener('change', () => {
      if (behaviorSelect.value === 'custom') {
        customUrlGroup.style.display = 'block';
        customUrlInput.required = true;
      } else {
        customUrlGroup.style.display = 'none';
        customUrlInput.required = false;
      }
    });

    // Form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const behavior = behaviorSelect.value;
      const customUrl = customUrlInput.value.trim();
      const adminCertId = adminCertSelect.value;

      // Validate custom URL if behavior is custom
      if (behavior === 'custom' && !customUrl) {
        showError('Please enter a custom URL');
        return;
      }

      showLoading();

      try {
        const result = await api.updateSettings({
          default_server_behavior: behavior,
          default_server_custom_url: customUrl,
          admin_cert_id: adminCertId
        });

        hideLoading();

        // Show different message if restart is required
        if (result.requiresRestart) {
          showSuccess(result.restartMessage);
        } else {
          showSuccess('Settings updated successfully. Nginx has been reloaded.');
        }
      } catch (error) {
        hideLoading();
        showError(error.message);
      }
    });

  } catch (error) {
    showError(error.message);
    container.innerHTML = '<div class="empty-state"><h2>Failed to load settings</h2></div>';
  } finally {
    hideLoading();
  }
}
