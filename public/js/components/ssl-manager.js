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
                <th>Issuer</th>
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
                    <td><small>${cert.issuer || 'N/A'}</small></td>
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
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <h3>Add SSL Certificate</h3>
          <button class="modal-close" onclick="document.getElementById('modalContainer').innerHTML=''">&times;</button>
        </div>
        <div class="modal-body">
          <form id="certificateForm">
            <div class="form-group">
              <label for="certName">Name *</label>
              <input type="text" id="certName" required placeholder="My Certificate">
              <small>A friendly name for this certificate</small>
            </div>

            <div class="form-group">
              <label>Certificate Input Method</label>
              <div class="radio-group">
                <label>
                  <input type="radio" name="inputMethod" value="paste" checked>
                  Paste Content
                </label>
                <label>
                  <input type="radio" name="inputMethod" value="upload">
                  Upload Files
                </label>
              </div>
            </div>

            <!-- Paste Content Method -->
            <div id="pasteMethod">
              <div class="form-group">
                <label for="certContent">Certificate Content * (PEM format)</label>
                <textarea id="certContent" rows="8" placeholder="-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----"></textarea>
                <small>Paste the contents of your .crt or .pem file</small>
              </div>

              <div class="form-group">
                <label for="keyContent">Private Key Content * (PEM format)</label>
                <textarea id="keyContent" rows="8" placeholder="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"></textarea>
                <small>Paste the contents of your .key file</small>
              </div>
            </div>

            <!-- Upload Files Method -->
            <div id="uploadMethod" style="display: none;">
              <div class="form-group">
                <label for="certFile">Certificate File * (.crt, .pem)</label>
                <input type="file" id="certFile" accept=".crt,.pem,.cer">
              </div>

              <div class="form-group">
                <label for="keyFile">Private Key File * (.key, .pem)</label>
                <input type="file" id="keyFile" accept=".key,.pem">
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="document.getElementById('modalContainer').innerHTML=''">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Certificate</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  // Toggle input method
  const pasteMethod = document.getElementById('pasteMethod');
  const uploadMethod = document.getElementById('uploadMethod');
  
  document.querySelectorAll('input[name="inputMethod"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'paste') {
        pasteMethod.style.display = 'block';
        uploadMethod.style.display = 'none';
      } else {
        pasteMethod.style.display = 'none';
        uploadMethod.style.display = 'block';
      }
    });
  });

  // Form submit handler
  document.getElementById('certificateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('certName').value;
    const inputMethod = document.querySelector('input[name="inputMethod"]:checked').value;
    
    let certContent, keyContent;

    try {
      if (inputMethod === 'paste') {
        certContent = document.getElementById('certContent').value.trim();
        keyContent = document.getElementById('keyContent').value.trim();
        
        if (!certContent || !keyContent) {
          throw new Error('Please provide both certificate and key content');
        }
      } else {
        // Read uploaded files
        const certFile = document.getElementById('certFile').files[0];
        const keyFile = document.getElementById('keyFile').files[0];
        
        if (!certFile || !keyFile) {
          throw new Error('Please select both certificate and key files');
        }
        
        certContent = await readFileAsText(certFile);
        keyContent = await readFileAsText(keyFile);
      }

      showLoading();
      await api.createCertificate({ name, cert_content: certContent, key_content: keyContent });
      document.getElementById('modalContainer').innerHTML = '';
      showSuccess('Certificate added successfully');
      await renderCertificates(document.getElementById('mainContent'));
    } catch (error) {
      hideLoading();
      showError(error.message);
    }
  });
}

// Helper function to read file as text
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
