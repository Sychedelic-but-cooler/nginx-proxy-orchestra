import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess } from '../app.js';

/**
 * Close modal helper function
 */
function closeModal() {
  const modal = document.getElementById('modalContainer');
  if (modal) {
    modal.style.display = 'none';
    modal.innerHTML = '';
  }
}

export async function renderCertificates(container) {
  showLoading();
  
  try {
    const certificates = await api.getCertificates();
    
    if (certificates.length === 0) {
      container.innerHTML = `
        <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
          <strong>Certificate Storage Location:</strong> Certificates are saved to <code style="background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 3px;">data/ssl/</code> directory. Files are named as <code style="background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 3px;">&lt;name&gt;.crt</code> and <code style="background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 3px;">&lt;name&gt;.key</code>
        </div>
        <div class="empty-state">
          <h2>No TLS Certificates</h2>
          <p>Add your first TLS certificate to enable HTTPS</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="info-banner" style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
          <strong>Certificate Storage Location:</strong> Certificates are saved to <code style="background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 3px;">data/ssl/</code> directory. Files are named as <code style="background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 3px;">&lt;name&gt;.crt</code> and <code style="background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 3px;">&lt;name&gt;.key</code>
        </div>
        <div class="card">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Domain(s)</th>
                <th>Issuer</th>
                <th>Expires</th>
                <th>Usage</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${certificates.map(cert => {
                const expiresAt = cert.expires_at ? new Date(cert.expires_at) : null;
                const isExpiringSoon = expiresAt && (expiresAt - Date.now()) < 30 * 24 * 60 * 60 * 1000;
                const isExpired = expiresAt && expiresAt < Date.now();

                // Build usage tooltip content
                let usageTooltip = '';
                if (cert.in_use) {
                  const usageList = [];
                  if (cert.used_by_admin) {
                    usageList.push('• Admin Interface');
                  }
                  if (cert.used_by_proxies && cert.used_by_proxies.length > 0) {
                    cert.used_by_proxies.forEach(proxy => {
                      usageList.push('• ' + proxy.name);
                    });
                  }
                  usageTooltip = usageList.join('&#10;'); // HTML line break entity
                }

                const usageCount = (cert.used_by_admin ? 1 : 0) + (cert.used_by_proxies ? cert.used_by_proxies.length : 0);

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
                    <td>
                      ${cert.in_use ? `
                        <span class="badge badge-success cert-usage-badge" title="${usageTooltip}" style="cursor: help;">
                          In Use (${usageCount})
                        </span>
                      ` : '<span class="badge badge-secondary">Not In Use</span>'}
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

    // Button handlers
    document.getElementById('addCertBtn')?.addEventListener('click', () => showCertificateForm());
    document.getElementById('orderCertBtn')?.addEventListener('click', () => showOrderCertificateModal(container));
    document.getElementById('apiSecretsBtn')?.addEventListener('click', () => showAPISecretsModal());

  } catch (error) {
    showError(error.message);
    container.innerHTML = '<div class="empty-state"><h2>Failed to load certificates</h2></div>';
  } finally {
    hideLoading();
  }
}

async function handleDeleteCertificate(id, container) {
  // Get certificate details first to show in confirmation
  const certificates = await api.getCertificates();
  const cert = certificates.find(c => c.id === id);

  if (!cert) {
    showError('Certificate not found');
    return;
  }

  // Build confirmation message
  let confirmMessage = 'Are you sure you want to delete this certificate?';
  if (cert.in_use) {
    const affectedItems = [];
    if (cert.used_by_admin) {
      affectedItems.push('Admin Interface');
    }
    if (cert.used_by_proxies && cert.used_by_proxies.length > 0) {
      affectedItems.push(`${cert.used_by_proxies.length} proxy host(s)`);
    }
    confirmMessage += `\n\nThis certificate is currently in use by:\n- ${affectedItems.join('\n- ')}\n\nTLS will be automatically disabled on affected proxy hosts.`;
  }

  if (!confirm(confirmMessage)) return;

  showLoading();
  try {
    const result = await api.deleteCertificate(id);
    hideLoading();

    if (result.message) {
      showSuccess(result.message);
    } else {
      showSuccess('Certificate deleted successfully');
    }

    await renderCertificates(container);
  } catch (error) {
    hideLoading();
    showError(error.message);
  }
}

function showCertificateForm() {
  const modal = document.getElementById('modalContainer');
  modal.innerHTML = `
    <div class="modal-overlay" id="certificateModal">
      <div class="modal">
        <div class="modal-header">
          <h3>Add TLS Certificate</h3>
          <button class="modal-close" id="closeCertModal">&times;</button>
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
              <button type="button" class="btn btn-secondary" id="cancelCertBtn">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Certificate</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  modal.style.display = 'flex';

  // Close button handlers
  document.getElementById('closeCertModal').addEventListener('click', closeModal);
  document.getElementById('cancelCertBtn').addEventListener('click', closeModal);

  // Click outside to close
  document.getElementById('certificateModal').addEventListener('click', (e) => {
    if (e.target.id === 'certificateModal') {
      closeModal();
    }
  });

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
      closeModal();
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

// ============================================================================
// DNS Credentials / API Secrets Management
// ============================================================================

async function showAPISecretsModal() {
  const modal = document.getElementById('modalContainer');

  // Fetch existing credentials and providers
  showLoading();
  try {
    const [credentials, providers] = await Promise.all([
      api.getDNSCredentials(),
      api.getDNSProviders()
    ]);
    hideLoading();

    modal.innerHTML = `
      <div class="modal-overlay" id="apiSecretsModal">
        <div class="modal" style="max-width: 800px;">
          <div class="modal-header">
            <h3>DNS API Credentials</h3>
            <button class="modal-close" id="closeAPISecretsModal">&times;</button>
          </div>
          <div class="modal-body">
            <div style="background: #e8f5e9; border-left: 4px solid #4CAF50; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
              <strong>About DNS API Credentials:</strong><br>
              DNS credentials are used for DNS-01 challenges when ordering wildcard certificates (*.domain.com).
              Your API keys are encrypted and stored securely.
            </div>

            <div style="margin-bottom: 20px;">
              <button id="addCredentialBtn" class="btn btn-primary">+ Add Credential</button>
            </div>

            ${credentials.credentials && credentials.credentials.length > 0 ? `
              <table class="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Provider</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${credentials.credentials.map(cred => `
                    <tr>
                      <td><strong>${cred.name}</strong></td>
                      <td>
                        <span class="badge badge-info">
                          ${providers.providers.find(p => p.id === cred.provider)?.name || cred.provider}
                        </span>
                      </td>
                      <td>${new Date(cred.created_at).toLocaleDateString()}</td>
                      <td class="action-buttons">
                        <button class="btn btn-sm btn-danger delete-credential" data-id="${cred.id}" data-name="${cred.name}">Delete</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : `
              <div class="empty-state" style="padding: 40px 20px;">
                <p>No DNS credentials configured yet.</p>
                <p style="color: #666; font-size: 14px;">Add credentials to enable wildcard certificate ordering.</p>
              </div>
            `}
          </div>
        </div>
      </div>
    `;

    modal.style.display = 'flex';

    // Event listeners
    document.getElementById('closeAPISecretsModal').addEventListener('click', closeModal);
    document.getElementById('addCredentialBtn').addEventListener('click', () => showAddCredentialForm(providers.providers));

    document.querySelectorAll('.delete-credential').forEach(btn => {
      btn.addEventListener('click', () => handleDeleteCredential(parseInt(btn.dataset.id), btn.dataset.name));
    });

  } catch (error) {
    hideLoading();
    showError(error.message || 'Failed to load DNS credentials');
  }
}

async function showAddCredentialForm(providers) {
  const modal = document.getElementById('modalContainer');

  modal.innerHTML = `
    <div class="modal-overlay" id="addCredentialModal">
      <div class="modal" style="max-width: 600px;">
        <div class="modal-header">
          <h3>Add DNS Credential</h3>
          <button class="modal-close" id="closeAddCredentialModal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="addCredentialForm">
            <div class="form-group">
              <label for="credentialName">Credential Name *</label>
              <input type="text" id="credentialName" required placeholder="My Cloudflare Account">
              <small>A friendly name for this credential</small>
            </div>

            <div class="form-group">
              <label for="provider">DNS Provider *</label>
              <select id="provider" required>
                <option value="">Select a provider...</option>
                ${providers.map(p => `
                  <option value="${p.id}">${p.name}</option>
                `).join('')}
              </select>
            </div>

            <div id="providerFields"></div>

            <div class="form-actions">
              <button type="button" class="btn btn-secondary" id="cancelAddCredential">Cancel</button>
              <button type="submit" class="btn btn-primary">Add Credential</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  modal.style.display = 'flex';

  const providerSelect = document.getElementById('provider');
  const providerFields = document.getElementById('providerFields');

  // Handle provider selection
  providerSelect.addEventListener('change', () => {
    const selectedProvider = providers.find(p => p.id === providerSelect.value);
    if (selectedProvider) {
      providerFields.innerHTML = `
        <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; margin-bottom: 16px; border-radius: 4px;">
          <strong>Provider Documentation:</strong><br>
          <a href="${selectedProvider.docsUrl}" target="_blank" rel="noopener noreferrer">${selectedProvider.docsUrl}</a>
        </div>
        ${selectedProvider.fields.map(field => `
          <div class="form-group">
            <label for="field_${field.name}">
              ${field.label} ${field.required ? '*' : '(Optional)'}
            </label>
            ${field.type === 'textarea' ? `
              <textarea id="field_${field.name}" ${field.required ? 'required' : ''} rows="6" placeholder="${field.help}"></textarea>
            ` : `
              <input type="${field.type}" id="field_${field.name}" ${field.required ? 'required' : ''} placeholder="${field.help}">
            `}
            <small>${field.help}</small>
          </div>
        `).join('')}
      `;
    } else {
      providerFields.innerHTML = '';
    }
  });

  // Event listeners
  document.getElementById('closeAddCredentialModal').addEventListener('click', closeModal);
  document.getElementById('cancelAddCredential').addEventListener('click', closeModal);

  document.getElementById('addCredentialForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('credentialName').value;
    const providerId = providerSelect.value;
    const selectedProvider = providers.find(p => p.id === providerId);

    if (!selectedProvider) {
      showError('Please select a DNS provider');
      return;
    }

    // Collect credentials
    const credentials = {};
    for (const field of selectedProvider.fields) {
      const input = document.getElementById(`field_${field.name}`);
      if (input && input.value) {
        credentials[field.name] = input.value;
      }
    }

    showLoading();
    try {
      await api.createDNSCredential({
        name,
        provider: providerId,
        credentials
      });
      hideLoading();
      closeModal();
      showSuccess('DNS credential added successfully');
      await showAPISecretsModal();
    } catch (error) {
      hideLoading();
      showError(error.message || 'Failed to add DNS credential');
    }
  });
}

async function handleDeleteCredential(id, name) {
  if (!confirm(`Are you sure you want to delete the DNS credential "${name}"?\n\nThis will prevent auto-renewal of certificates using this credential.`)) {
    return;
  }

  showLoading();
  try {
    await api.deleteDNSCredential(id);
    hideLoading();
    showSuccess('DNS credential deleted successfully');
    await showAPISecretsModal();
  } catch (error) {
    hideLoading();
    showError(error.message || 'Failed to delete DNS credential');
  }
}

// ============================================================================
// Certificate Ordering
// ============================================================================

async function showOrderCertificateModal(container) {
  const modal = document.getElementById('modalContainer');

  // Fetch certbot status and DNS credentials
  showLoading();
  try {
    const [certbotStatus, dnsCredentials] = await Promise.all([
      api.getCertbotStatus(),
      api.getDNSCredentials()
    ]);
    hideLoading();

    // Check if certbot is installed
    if (!certbotStatus.certbot.installed) {
      modal.innerHTML = `
        <div class="modal-overlay" id="certbotStatusModal">
          <div class="modal" style="max-width: 700px;">
            <div class="modal-header">
              <h3>Certbot Not Installed</h3>
              <button class="modal-close" id="closeCertbotModal">&times;</button>
            </div>
            <div class="modal-body">
              <div style="background: #ffebee; border-left: 4px solid #f44336; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
                <strong>Certbot is required to order Let's Encrypt certificates.</strong>
              </div>

              <h4>Installation Instructions (Rocky Linux 9):</h4>
              <pre style="background: #263238; color: #aed581; padding: 16px; border-radius: 4px; overflow-x: auto;">${certbotStatus.instructions.commands.join('\n')}</pre>

              <p style="margin-top: 20px;">
                <strong>More information:</strong><br>
                <a href="${certbotStatus.instructions.instructions.match(/https:\/\/[^\s]+/)[0]}" target="_blank" rel="noopener noreferrer">
                  Certbot Installation Guide
                </a>
              </p>
            </div>
          </div>
        </div>
      `;
      modal.style.display = 'flex';
      document.getElementById('closeCertbotModal').addEventListener('click', closeModal);
      return;
    }

    // Check encryption configuration
    if (!certbotStatus.encryption.configured) {
      modal.innerHTML = `
        <div class="modal-overlay" id="encryptionWarningModal">
          <div class="modal" style="max-width: 700px;">
            <div class="modal-header">
              <h3>Encryption Not Configured</h3>
              <button class="modal-close" id="closeEncryptionModal">&times;</button>
            </div>
            <div class="modal-body">
              <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
                <strong>${certbotStatus.encryption.warning}</strong>
              </div>

              <p>To secure DNS credentials, you must set the <code>CERT_ENCRYPTION_KEY</code> environment variable in your <code>.env</code> file.</p>

              <h4>Generate a key and add to .env:</h4>
              <pre style="background: #263238; color: #aed581; padding: 16px; border-radius: 4px; overflow-x: auto;">
# Generate a random 256-bit key
openssl rand -hex 32

# Add to .env file:
CERT_ENCRYPTION_KEY=your_generated_key_here</pre>

              <p style="margin-top: 16px;"><strong>Note:</strong> HTTP-01 challenges will still work, but DNS-01 challenges require encryption.</p>

              <div class="form-actions" style="margin-top: 20px;">
                <button id="continueWithoutEncryption" class="btn btn-primary">Continue with HTTP-01 Only</button>
              </div>
            </div>
          </div>
        </div>
      `;
      modal.style.display = 'flex';
      document.getElementById('closeEncryptionModal').addEventListener('click', closeModal);
      document.getElementById('continueWithoutEncryption').addEventListener('click', () => {
        showOrderCertificateForm(container, dnsCredentials.credentials || [], false);
      });
      return;
    }

    // Show order form
    showOrderCertificateForm(container, dnsCredentials.credentials || [], true);

  } catch (error) {
    hideLoading();
    showError(error.message || 'Failed to load certificate ordering options');
  }
}

function showOrderCertificateForm(container, dnsCredentials, encryptionConfigured) {
  const modal = document.getElementById('modalContainer');

  modal.innerHTML = `
    <div class="modal-overlay" id="orderCertModal">
      <div class="modal" style="max-width: 700px;">
        <div class="modal-header">
          <h3>Order Let's Encrypt Certificate</h3>
          <button class="modal-close" id="closeOrderModal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="orderCertForm">
            <div class="form-group">
              <label for="orderEmail">Contact Email *</label>
              <input type="email" id="orderEmail" required placeholder="admin@example.com">
              <small>Used for important notifications from Let's Encrypt</small>
            </div>

            <div class="form-group">
              <label for="orderDomains">Domain(s) *</label>
              <textarea id="orderDomains" rows="3" required placeholder="example.com
www.example.com
*.example.com"></textarea>
              <small>One domain per line. Wildcard domains (*.example.com) require DNS-01 challenge.</small>
            </div>

            <div class="form-group">
              <label for="challengeType">Challenge Type *</label>
              <select id="challengeType" required>
                <option value="http-01">HTTP-01 (for specific domains)</option>
                ${encryptionConfigured ? '<option value="dns-01">DNS-01 (for wildcards)</option>' : ''}
              </select>
              <small id="challengeHelp">HTTP-01: Validates via web server. Best for specific domains.</small>
            </div>

            <div id="dnsOptions" style="display: none;">
              ${dnsCredentials.length > 0 ? `
                <div class="form-group">
                  <label for="dnsCredential">DNS Credential *</label>
                  <select id="dnsCredential">
                    <option value="">Select credential...</option>
                    ${dnsCredentials.map(cred => `
                      <option value="${cred.id}">${cred.name} (${cred.provider})</option>
                    `).join('')}
                  </select>
                </div>

                <div class="form-group">
                  <label for="propagationSeconds">DNS Propagation Delay (seconds)</label>
                  <input type="number" id="propagationSeconds" value="10" min="10" max="120">
                  <small>Time to wait for DNS records to propagate (10-120 seconds)</small>
                </div>
              ` : `
                <div style="background: #ffebee; border-left: 4px solid #f44336; padding: 12px 16px; margin-bottom: 16px; border-radius: 4px;">
                  <strong>No DNS credentials configured.</strong><br>
                  Please add DNS credentials using the "API Secrets" button before using DNS-01 challenge.
                </div>
              `}
            </div>

            <div class="form-group">
              <label>
                <input type="checkbox" id="dryRun">
                Test mode (dry-run using staging server)
              </label>
              <small style="display: block; margin-top: 4px;">Validates configuration without issuing a real certificate</small>
            </div>

            <div class="form-group">
              <label>
                <input type="checkbox" id="autoRenew" checked>
                Enable automatic renewal (recommended)
              </label>
              <small style="display: block; margin-top: 4px;">Certificates will be renewed 30 days before expiry</small>
            </div>

            <div class="form-actions">
              <button type="button" class="btn btn-secondary" id="cancelOrder">Cancel</button>
              <button type="submit" class="btn btn-primary">Order Certificate</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  modal.style.display = 'flex';

  const challengeType = document.getElementById('challengeType');
  const dnsOptions = document.getElementById('dnsOptions');
  const challengeHelp = document.getElementById('challengeHelp');
  const orderDomains = document.getElementById('orderDomains');

  // Handle challenge type change
  challengeType.addEventListener('change', () => {
    if (challengeType.value === 'dns-01') {
      dnsOptions.style.display = 'block';
      challengeHelp.textContent = 'DNS-01: Validates via DNS records. Required for wildcard domains.';
    } else {
      dnsOptions.style.display = 'none';
      challengeHelp.textContent = 'HTTP-01: Validates via web server. Best for specific domains.';
    }
  });

  // Auto-detect wildcard domains
  orderDomains.addEventListener('input', () => {
    const domains = orderDomains.value.split('\n').map(d => d.trim()).filter(d => d);
    const hasWildcard = domains.some(d => d.startsWith('*'));

    if (hasWildcard && challengeType.value === 'http-01' && encryptionConfigured) {
      challengeType.value = 'dns-01';
      challengeType.dispatchEvent(new Event('change'));
    }
  });

  // Event listeners
  document.getElementById('closeOrderModal').addEventListener('click', closeModal);
  document.getElementById('cancelOrder').addEventListener('click', closeModal);

  document.getElementById('orderCertForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('orderEmail').value;
    const domainsText = orderDomains.value;
    const challengeTypeValue = challengeType.value;
    const autoRenew = document.getElementById('autoRenew').checked;
    const dryRun = document.getElementById('dryRun').checked;

    const domains = domainsText.split('\n').map(d => d.trim()).filter(d => d);

    if (domains.length === 0) {
      showError('Please enter at least one domain');
      return;
    }

    const orderData = {
      email,
      domains,
      challengeType: challengeTypeValue,
      autoRenew,
      dryRun
    };

    if (challengeTypeValue === 'dns-01') {
      const dnsCredentialId = document.getElementById('dnsCredential')?.value;
      if (!dnsCredentialId) {
        showError('Please select a DNS credential for DNS-01 challenge');
        return;
      }
      orderData.dnsCredentialId = parseInt(dnsCredentialId);
      orderData.propagationSeconds = parseInt(document.getElementById('propagationSeconds').value);
    }

    showLoading();
    try {
      const result = await api.orderCertificate(orderData);
      hideLoading();
      closeModal();
      if (dryRun) {
        showSuccess(`Certificate test successful for ${domains[0]}! Ready to order for real.`);
      } else {
        showSuccess(`Certificate ordered successfully for ${domains[0]}!`);
      }
      await renderCertificates(container);
    } catch (error) {
      hideLoading();
      showError(error.message || 'Failed to order certificate');
    }
  });
}
