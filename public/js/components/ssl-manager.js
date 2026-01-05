import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess } from '../app.js';

export async function renderCertificates(container) {
  showLoading();
  
  try {
    const certificates = await api.getCertificates();
    
    if (certificates.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <h2>No SSL Certificates</h2>
          <p>Add your first SSL certificate to enable HTTPS</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="card">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Domain(s)</th>
                <th>Certificate Path</th>
                <th>Expires</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${certificates.map(cert => {
                const expiresAt = cert.expires_at ? new Date(cert.expires_at) : null;
                const isExpiringSoon = expiresAt && (expiresAt - Date.now()) < 30 * 24 * 60 * 60 * 1000;
                const isExpired = expiresAt && expiresAt < Date.now();
                
                return `
                  <tr>
                    <td><strong>${cert.name}</strong></td>
                    <td>${cert.domain_names}</td>
                    <td><code>${cert.cert_path}</code></td>
                    <td>
                      ${expiresAt ? `
                        <span class="badge ${isExpired ? 'badge-danger' : isExpiringSoon ? 'badge-warning' : 'badge-success'}">
                          ${expiresAt.toLocaleDateString()}
                        </span>
                      ` : '<span class="badge badge-info">N/A</span>'}
                    </td>
                    <td>${new Date(cert.created_at).toLocaleDateString()}</td>
                    <td class="action-buttons">
                      <button class="btn btn-sm btn-danger delete-cert" data-id="${cert.id}">Delete</button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;

      // Event listeners
      document.querySelectorAll('.delete-cert').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteCertificate(parseInt(btn.dataset.id), container));
      });
    }

    // Add certificate button handler
    document.getElementById('addCertBtn')?.addEventListener('click', () => showCertificateForm());

  } catch (error) {
    showError(error.message);
    container.innerHTML = '<div class="empty-state"><h2>Failed to load certificates</h2></div>';
  } finally {
    hideLoading();
  }
}

async function handleDeleteCertificate(id, container) {
  if (!confirm('Are you sure you want to delete this certificate?')) return;
  
  showLoading();
  try {
    await api.deleteCertificate(id);
    showSuccess('Certificate deleted successfully');
    await renderCertificates(container);
  } catch (error) {
    hideLoading();
    showError(error.message);
  }
}

function showCertificateForm() {
  const modal = document.getElementById('modalContainer');
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Add SSL Certificate</h3>
        </div>
        <form id="certificateForm">
          <div class="form-group">
            <label for="certName">Name *</label>
            <input type="text" id="certName" required placeholder="My Certificate">
          </div>

          <div class="form-group">
            <label for="certDomains">Domain Names * (comma-separated)</label>
            <input type="text" id="certDomains" required placeholder="example.com, *.example.com">
          </div>

          <div class="form-group">
            <label for="certPath">Certificate Path *</label>
            <input type="text" id="certPath" required placeholder="/etc/ssl/certs/example.com.crt">
            <small>Full path to the SSL certificate file</small>
          </div>

          <div class="form-group">
            <label for="keyPath">Key Path *</label>
            <input type="text" id="keyPath" required placeholder="/etc/ssl/private/example.com.key">
            <small>Full path to the private key file</small>
          </div>

          <div class="form-group">
            <label for="expiresAt">Expiration Date (optional)</label>
            <input type="date" id="expiresAt">
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Form submit handler
  document.getElementById('certificateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const data = {
      name: document.getElementById('certName').value,
      domain_names: document.getElementById('certDomains').value,
      cert_path: document.getElementById('certPath').value,
      key_path: document.getElementById('keyPath').value,
      expires_at: document.getElementById('expiresAt').value || null
    };

    showLoading();
    try {
      await api.createCertificate(data);
      showSuccess('Certificate added successfully');
      modal.innerHTML = '';
      await renderCertificates(document.getElementById('mainContent'));
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  });

  // Cancel button
  document.getElementById('cancelBtn').addEventListener('click', () => {
    modal.innerHTML = '';
  });
}
