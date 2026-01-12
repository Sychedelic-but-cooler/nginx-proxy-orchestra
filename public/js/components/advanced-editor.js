import api from '../api.js';
import { showLoading, hideLoading, showError, showSuccess } from '../app.js';

export async function renderAdvancedEditor(container) {
  container.innerHTML = `
    <div class="card" style="max-width: 1200px; margin: 0 auto;">
      <div class="card-header">
        <h3 class="card-title">Advanced Nginx Config Editor</h3>
        <p style="color: var(--text-secondary); margin-top: 8px; font-size: 14px;">
          <strong>Note:</strong> You must test the configuration before saving. The save button will only appear after a successful test.
        </p>
      </div>
      <div class="card-body">
        <div class="form-group">
          <label for="configName">Configuration Name *</label>
          <input
            type="text"
            id="configName"
            placeholder="My Custom Config"
            required
          >
          <small>A friendly name for this configuration</small>
        </div>

        <div class="form-group">
          <label for="configFilename">Filename *</label>
          <input
            type="text"
            id="configFilename"
            placeholder="my-custom-config"
            required
          >
          <small>Will be saved as filename.conf in nginx (special characters will be sanitized)</small>
        </div>

        <div class="form-group">
          <label for="configEditor">Nginx Configuration *</label>
          <textarea
            id="configEditor"
            style="min-height: 400px; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.5;"
            placeholder="# Enter your nginx configuration here
# Example:

server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://backend:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}"
          ></textarea>
          <small>Enter your raw nginx configuration. This can include server blocks, upstreams, or any valid nginx directives.</small>
        </div>

        <!-- Test Results -->
        <div id="testResults" style="display: none; margin-bottom: 20px;"></div>

        <!-- Action Buttons -->
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button type="button" class="btn btn-secondary" id="clearBtn">
            Clear
          </button>
          <button type="button" class="btn btn-warning" id="testBtn">
            Test Configuration
          </button>
          <button
            type="button"
            class="btn btn-primary"
            id="saveBtn"
            style="display: none;"
            disabled
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>

    <!-- Examples Section -->
    <div class="card" style="max-width: 1200px; margin: 20px auto;">
      <div class="card-header">
        <h3 class="card-title">Configuration Examples</h3>
      </div>
      <div class="card-body">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px;">
          <div class="example-card" data-example="basic">
            <h4>Basic Reverse Proxy</h4>
            <p>Simple proxy to a backend service</p>
          </div>
          <div class="example-card" data-example="ssl">
            <h4>TLS/HTTPS Server</h4>
            <p>HTTPS server with TLS certificate</p>
          </div>
          <div class="example-card" data-example="loadbalancer">
            <h4>Load Balancer</h4>
            <p>Distribute traffic across multiple backends</p>
          </div>
          <div class="example-card" data-example="redirect">
            <h4>HTTP to HTTPS Redirect</h4>
            <p>Redirect all HTTP traffic to HTTPS</p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Style for example cards
  const style = document.createElement('style');
  style.textContent = `
    .example-card {
      padding: 15px;
      border: 2px solid var(--border-color);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .example-card:hover {
      border-color: var(--primary-color);
      background-color: rgba(79, 70, 229, 0.05);
    }
    .example-card h4 {
      margin: 0 0 8px 0;
      color: var(--text-color);
      font-size: 16px;
    }
    .example-card p {
      margin: 0;
      color: var(--text-secondary);
      font-size: 14px;
    }
  `;
  document.head.appendChild(style);

  // Event listeners
  let testPassed = false;

  const configEditor = document.getElementById('configEditor');
  const configName = document.getElementById('configName');
  const configFilename = document.getElementById('configFilename');
  const testBtn = document.getElementById('testBtn');
  const saveBtn = document.getElementById('saveBtn');
  const clearBtn = document.getElementById('clearBtn');
  const testResults = document.getElementById('testResults');

  // Reset test status when config changes
  configEditor.addEventListener('input', () => {
    testPassed = false;
    saveBtn.style.display = 'none';
    testResults.style.display = 'none';
  });

  // Test button handler
  testBtn.addEventListener('click', async () => {
    const config = configEditor.value.trim();
    const filename = configFilename.value.trim();

    if (!config) {
      showError('Please enter nginx configuration');
      return;
    }

    if (!filename) {
      showError('Please enter a filename');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    testResults.style.display = 'none';

    try {
      const response = await fetch('/api/config/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api.getToken()}`
        },
        body: JSON.stringify({ config, filename })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        testPassed = true;
        testResults.innerHTML = `
          <div style="padding: 15px; background-color: rgba(34, 197, 94, 0.1); border: 2px solid #22c55e; border-radius: 6px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2">
                <path d="M20 6L9 17l-5-5"></path>
              </svg>
              <div>
                <strong style="color: #22c55e;">Configuration Test Passed!</strong>
                <p style="margin: 5px 0 0 0; color: var(--text-secondary);">${data.message}</p>
              </div>
            </div>
          </div>
        `;
        testResults.style.display = 'block';
        saveBtn.style.display = 'inline-block';
        saveBtn.disabled = false;
      } else {
        testPassed = false;
        testResults.innerHTML = `
          <div style="padding: 15px; background-color: rgba(239, 68, 68, 0.1); border: 2px solid #ef4444; border-radius: 6px;">
            <div style="display: flex; align-items: flex-start; gap: 10px;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
              <div>
                <strong style="color: #ef4444;">Configuration Test Failed</strong>
                <pre style="margin: 10px 0 0 0; padding: 10px; background-color: rgba(0,0,0,0.05); border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word;">${data.error || data.message}</pre>
              </div>
            </div>
          </div>
        `;
        testResults.style.display = 'block';
        saveBtn.style.display = 'none';
      }
    } catch (error) {
      showError(error.message || 'Failed to test configuration');
      testPassed = false;
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Configuration';
    }
  });

  // Save button handler
  saveBtn.addEventListener('click', async () => {
    if (!testPassed) {
      showError('Please test the configuration first');
      return;
    }

    const name = configName.value.trim();
    const filename = configFilename.value.trim();
    const config = configEditor.value.trim();

    if (!name || !filename || !config) {
      showError('Please fill in all required fields');
      return;
    }

    if (!confirm('Save and activate this configuration?')) {
      return;
    }

    showLoading();
    saveBtn.disabled = true;

    try {
      const response = await fetch('/api/config/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api.getToken()}`
        },
        body: JSON.stringify({ name, filename, config })
      });

      const data = await response.json();

      if (response.ok) {
        showSuccess(data.message || 'Configuration saved successfully!');

        // Clear form
        configName.value = '';
        configFilename.value = '';
        configEditor.value = '';
        testResults.style.display = 'none';
        saveBtn.style.display = 'none';
        testPassed = false;

        // Redirect to proxies page after a short delay
        setTimeout(() => {
          window.location.hash = '/proxies';
        }, 1500);
      } else {
        throw new Error(data.error || 'Failed to save configuration');
      }
    } catch (error) {
      hideLoading();
      showError(error.message);
      saveBtn.disabled = false;
    }
  });

  // Clear button handler
  clearBtn.addEventListener('click', () => {
    if (configEditor.value.trim() && !confirm('Clear all entered configuration?')) {
      return;
    }

    configName.value = '';
    configFilename.value = '';
    configEditor.value = '';
    testResults.style.display = 'none';
    saveBtn.style.display = 'none';
    testPassed = false;
  });

  // Example cards
  const examples = {
    basic: `# Basic Reverse Proxy
server {
    listen 80;
    server_name example.com www.example.com;

    location / {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}`,

    ssl: `# TLS/HTTPS Server
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/nginx/ssl/example.com.crt;
    ssl_certificate_key /etc/nginx/ssl/example.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}`,

    loadbalancer: `# Load Balancer
upstream backend_servers {
    server backend1:8080 weight=3;
    server backend2:8080 weight=2;
    server backend3:8080 backup;
}

server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://backend_servers;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_next_upstream error timeout invalid_header http_500;
    }
}`,

    redirect: `# HTTP to HTTPS Redirect
server {
    listen 80;
    server_name example.com www.example.com;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com www.example.com;

    ssl_certificate /etc/nginx/ssl/example.com.crt;
    ssl_certificate_key /etc/nginx/ssl/example.com.key;

    location / {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
    }
}`
  };

  document.querySelectorAll('.example-card').forEach(card => {
    card.addEventListener('click', () => {
      const exampleKey = card.dataset.example;
      if (examples[exampleKey]) {
        configEditor.value = examples[exampleKey];
        testPassed = false;
        saveBtn.style.display = 'none';
        testResults.style.display = 'none';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });
}
