import api from '../api.js';
import { showError } from '../app.js';

export async function renderAbout(container) {
  // Set page title
  const headerTitle = document.getElementById('headerTitle');
  if (headerTitle) {
    headerTitle.textContent = 'About';
  }

  // Show loading
  container.innerHTML = '<div class="loading-text">Loading...</div>';

  try {
    // Fetch the README content from the server
    const response = await fetch('/README.md');
    if (!response.ok) {
      throw new Error('Failed to load README');
    }
    
    const readmeContent = await response.text();
    
    // Convert markdown-style content to HTML
    const htmlContent = convertMarkdownToHTML(readmeContent);
    
    container.innerHTML = `
      <div class="about-page">
        <!-- Quick Links Section -->
        <div class="about-links-section">
          <a href="https://github.com/Sychedelic-but-cooler/nginx-proxy-orchestra" target="_blank" rel="noopener noreferrer" class="about-link-card">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            <div class="about-link-content">
              <h3>GitHub Repository</h3>
              <p>View source code, report issues, and contribute</p>
            </div>
            <svg class="about-link-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </a>

          <a href="#/documentation" class="about-link-card">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            <div class="about-link-content">
              <h3>Documentation</h3>
              <p>Learn how to use and configure the system</p>
              <span class="badge" style="background: var(--warning-color); color: white; font-size: 11px; padding: 2px 8px; border-radius: 12px; margin-top: 4px;">Coming Soon</span>
            </div>
            <svg class="about-link-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </a>

          <button id="showComponentsBtn" class="about-link-card about-link-button">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
            <div class="about-link-content">
              <h3>Components & Credits</h3>
              <p>View all dependencies and frameworks used</p>
            </div>
            <svg class="about-link-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        </div>

        <!-- README Content -->
        <div class="card">
          <div class="card-body" style="padding: 32px;">
            <div class="readme-content">
              ${htmlContent}
            </div>
          </div>
        </div>
      </div>
    `;

    // Set up event listener for components button
    document.getElementById('showComponentsBtn').addEventListener('click', showComponentsModal);
  } catch (error) {
    console.error('Failed to load about page:', error);
    showError('Failed to load about page: ' + error.message);
    container.innerHTML = `
      <div class="empty-state">
        <h2>Failed to Load About Page</h2>
        <p>${error.message}</p>
      </div>
    `;
  }
}

/**
 * Simple markdown to HTML converter
 * Handles the basic markdown features used in the README
 */
function convertMarkdownToHTML(markdown) {
  let html = markdown;
  
  // Convert headers (### to h3, ## to h2, # to h1)
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // Convert bold text (**text** to <strong>text</strong>)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Convert links ([text](url) to <a href="url">text</a>)
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  
  // Convert bullet points (- item to <li>item</li>)
  html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
  
  // Wrap consecutive <li> items in <ul>
  html = html.replace(/(<li>.*<\/li>)(\n<li>.*<\/li>)*/g, (match) => {
    return '<ul>' + match + '</ul>';
  });
  
  // Convert horizontal rules (--- to <hr>)
  html = html.replace(/^---$/gim, '<hr>');
  
  // Convert paragraphs (double newlines become paragraph breaks)
  html = html.split('\n\n').map(paragraph => {
    paragraph = paragraph.trim();
    // Don't wrap if already has HTML tags
    if (paragraph.startsWith('<')) {
      return paragraph;
    }
    // Don't wrap empty paragraphs
    if (paragraph === '') {
      return '';
    }
    return '<p>' + paragraph.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');
  
  return html;
}

/**
 * Show the components and credits modal
 */
function showComponentsModal() {
  const modalHTML = `
    <div class="modal-overlay" id="componentsModal">
      <div class="modal modal-wide">
        <div class="modal-header">
          <h3>Components & Credits</h3>
          <button class="modal-close" id="closeComponentsModal">&times;</button>
        </div>
        <div class="modal-body">
          <div class="components-section">
            <h4>Backend Dependencies</h4>
            <div class="components-grid">
              <div class="component-item">
                <div class="component-header">
                  <h5>Node.js</h5>
                  <span class="component-version">v22.0.0+</span>
                </div>
                <p class="component-description">JavaScript runtime built on Chrome's V8 engine</p>
                <a href="https://nodejs.org/" target="_blank" rel="noopener noreferrer" class="component-link">nodejs.org</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>bcrypt</h5>
                  <span class="component-version">^5.0.0</span>
                </div>
                <p class="component-description">Password hashing for secure authentication</p>
                <a href="https://github.com/kelektiv/node.bcrypt.js" target="_blank" rel="noopener noreferrer" class="component-link">GitHub</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>better-sqlite3</h5>
                  <span class="component-version">^11.0.0</span>
                </div>
                <p class="component-description">Fast SQLite3 library with synchronous API</p>
                <a href="https://github.com/WiseLibs/better-sqlite3" target="_blank" rel="noopener noreferrer" class="component-link">GitHub</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>jsonwebtoken</h5>
                  <span class="component-version">^9.0.0</span>
                </div>
                <p class="component-description">JWT authentication with key rotation</p>
                <a href="https://github.com/auth0/node-jsonwebtoken" target="_blank" rel="noopener noreferrer" class="component-link">GitHub</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>node-cron</h5>
                  <span class="component-version">^3.0.3</span>
                </div>
                <p class="component-description">Cron-inspired task scheduler for Node.js</p>
                <a href="https://www.npmjs.com/package/node-cron" target="_blank" rel="noopener noreferrer" class="component-link">NPM</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>otplib</h5>
                  <span class="component-version">^12.0.1</span>
                </div>
                <p class="component-description">One-time password library for 2FA</p>
                <a href="https://github.com/yeojz/otplib" target="_blank" rel="noopener noreferrer" class="component-link">GitHub</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>qrcode</h5>
                  <span class="component-version">^1.5.3</span>
                </div>
                <p class="component-description">QR code generation for 2FA setup</p>
                <a href="https://github.com/soldair/node-qrcode" target="_blank" rel="noopener noreferrer" class="component-link">GitHub</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>ipaddr.js</h5>
                  <span class="component-version">^2.3.0</span>
                </div>
                <p class="component-description">IP address manipulation library</p>
                <a href="https://github.com/whitequark/ipaddr.js" target="_blank" rel="noopener noreferrer" class="component-link">GitHub</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>dotenv</h5>
                  <span class="component-version">^16.0.0</span>
                </div>
                <p class="component-description">Environment variable configuration</p>
                <a href="https://github.com/motdotla/dotenv" target="_blank" rel="noopener noreferrer" class="component-link">GitHub</a>
              </div>
            </div>

            <h4 style="margin-top: 32px;">Frontend Dependencies</h4>
            <div class="components-grid">
              <div class="component-item">
                <div class="component-header">
                  <h5>Chart.js</h5>
                  <span class="component-version">4.4.1</span>
                </div>
                <p class="component-description">Simple yet flexible JavaScript charting library</p>
                <a href="https://www.chartjs.org/" target="_blank" rel="noopener noreferrer" class="component-link">chartjs.org</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>Vanilla JavaScript</h5>
                  <span class="component-version">ES6+</span>
                </div>
                <p class="component-description">Pure JavaScript with no framework dependencies</p>
                <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript" target="_blank" rel="noopener noreferrer" class="component-link">MDN Web Docs</a>
              </div>
            </div>

            <h4 style="margin-top: 32px;">Core Infrastructure</h4>
            <div class="components-grid">
              <div class="component-item">
                <div class="component-header">
                  <h5>Nginx</h5>
                  <span class="component-version">Latest</span>
                </div>
                <p class="component-description">High-performance HTTP server and reverse proxy</p>
                <a href="https://nginx.org/" target="_blank" rel="noopener noreferrer" class="component-link">nginx.org</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>ModSecurity</h5>
                  <span class="component-version">Latest</span>
                </div>
                <p class="component-description">Web Application Firewall (WAF) engine</p>
                <a href="https://modsecurity.org/" target="_blank" rel="noopener noreferrer" class="component-link">modsecurity.org</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>Certbot</h5>
                  <span class="component-version">Latest</span>
                </div>
                <p class="component-description">Automatic SSL/TLS certificate management</p>
                <a href="https://certbot.eff.org/" target="_blank" rel="noopener noreferrer" class="component-link">certbot.eff.org</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>Apprise</h5>
                  <span class="component-version">Latest</span>
                </div>
                <p class="component-description">Multi-platform notification delivery</p>
                <a href="https://github.com/caronc/apprise" target="_blank" rel="noopener noreferrer" class="component-link">GitHub</a>
              </div>

              <div class="component-item">
                <div class="component-header">
                  <h5>PM2</h5>
                  <span class="component-version">^6.0.0</span>
                </div>
                <p class="component-description">Production process manager for Node.js</p>
                <a href="https://github.com/Unitech/pm2" target="_blank" rel="noopener noreferrer" class="component-link">GitHub</a>
              </div>
            </div>

            <div class="components-footer">
              <p style="margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border-color); color: var(--text-secondary); font-size: 14px;">
                This project is built with open-source technologies. Special thanks to all the contributors and maintainers of these projects.
              </p>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="closeComponentsBtn">Close</button>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('modalContainer').innerHTML = modalHTML;
  
  // Close button handlers
  document.getElementById('closeComponentsModal').addEventListener('click', () => {
    document.getElementById('componentsModal').remove();
  });
  
  document.getElementById('closeComponentsBtn').addEventListener('click', () => {
    document.getElementById('componentsModal').remove();
  });
  
  // Close on overlay click
  document.getElementById('componentsModal').addEventListener('click', (e) => {
    if (e.target.id === 'componentsModal') {
      document.getElementById('componentsModal').remove();
    }
  });
}
