const { execSync } = require('child_process');

// Cache for module information (loaded once at startup)
let moduleCache = null;

/**
 * Test nginx configuration
 * Returns { success: boolean, output: string, error?: string }
 */
function testNginxConfig() {
  try {
    // Use sudo for nginx -t to access SSL certificates and logs
    // Increased timeout for ModSecurity rule loading (OWASP CRS can take 10-15 seconds)
    const output = execSync('sudo nginx -t 2>&1', {
      encoding: 'utf8',
      timeout: 30000
    });

    return {
      success: true,
      output: output.trim()
    };
  } catch (error) {
    return {
      success: false,
      output: error.stdout ? error.stdout.trim() : '',
      error: error.stderr ? error.stderr.trim() : error.message
    };
  }
}

/**
 * Reload nginx configuration
 * Returns { success: boolean, output: string, error?: string }
 */
function reloadNginx() {
  try {
    // Use sudo systemctl reload for reliable reload
    const output = execSync('sudo systemctl reload nginx 2>&1', {
      encoding: 'utf8',
      timeout: 5000
    });

    return {
      success: true,
      output: output.trim()
    };
  } catch (error) {
    return {
      success: false,
      output: error.stdout ? error.stdout.trim() : '',
      error: error.stderr ? error.stderr.trim() : error.message
    };
  }
}

/**
 * Get nginx version
 */
function getNginxVersion() {
  try {
    const output = execSync('nginx -v 2>&1', {
      encoding: 'utf8',
      timeout: 5000
    });
    
    // Output format: nginx version: nginx/1.18.0
    const match = output.match(/nginx[\/\s]+([0-9.]+)/i);
    return match ? match[1] : 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Check if nginx is running
 */
function isNginxRunning() {
  try {
    if (process.platform === 'win32') {
      execSync('tasklist | findstr nginx.exe', { encoding: 'utf8', timeout: 5000 });
    } else {
      execSync('pgrep nginx', { encoding: 'utf8', timeout: 5000 });
    }
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Load nginx module information (called once at startup)
 */
function loadModuleInfo() {
  try {
    const fs = require('fs');
    const path = require('path');

    // Get dynamic modules from nginx.conf
    const nginxConf = fs.readFileSync('/etc/nginx/nginx.conf', 'utf8');
    const moduleRegex = /load_module\s+(?:modules\/)?([^;]+\.so);/g;
    const dynamicModules = [];
    let match;

    while ((match = moduleRegex.exec(nginxConf)) !== null) {
      const moduleName = match[1].replace('modules/', '');

      // Try to get module file info
      const modulePath = path.join('/usr/lib64/nginx/modules', moduleName);
      let moduleInfo = {
        name: moduleName.replace(/\.so$/, '').replace(/ngx_http_|_module/g, '').replace(/_/g, ' '),
        file: moduleName,
        type: 'dynamic'
      };

      // Try to get file size
      try {
        const stats = fs.statSync(modulePath);
        moduleInfo.size = Math.round(stats.size / 1024); // KB
      } catch (e) {
        // File not found, skip size
      }

      dynamicModules.push(moduleInfo);
    }

    // Get built-in modules from nginx -V
    const output = execSync('nginx -V 2>&1', {
      encoding: 'utf8',
      timeout: 5000
    });

    const builtInModules = [];

    // Parse configure arguments to find built-in modules
    const configMatch = output.match(/configure arguments: (.+)/);
    if (configMatch) {
      const args = configMatch[1];

      // Common important built-in modules to highlight
      const importantModules = [
        { flag: '--with-http_ssl_module', name: 'SSL/TLS' },
        { flag: '--with-http_v2_module', name: 'HTTP/2 (built-in)' },
        { flag: '--with-http_v3_module', name: 'HTTP/3 (QUIC)' },
        { flag: '--with-http_realip_module', name: 'Real IP' },
        { flag: '--with-http_gzip_static_module', name: 'Gzip Static' },
        { flag: '--with-stream', name: 'Stream (TCP/UDP proxy)' },
        { flag: '--with-stream_ssl_module', name: 'Stream SSL' },
        { flag: '--with-http_stub_status_module', name: 'Stub Status' }
      ];

      importantModules.forEach(mod => {
        if (args.includes(mod.flag)) {
          builtInModules.push({
            name: mod.name,
            type: 'built-in'
          });
        }
      });
    }

    moduleCache = {
      dynamic: dynamicModules,
      builtin: builtInModules
    };

    console.log(`Loaded ${dynamicModules.length} dynamic modules and ${builtInModules.length} built-in modules`);
  } catch (error) {
    console.error('Error loading module information:', error);
    moduleCache = {
      dynamic: [],
      builtin: []
    };
  }
}

/**
 * Get loaded nginx modules (returns cached data)
 */
function getLoadedModules() {
  // Initialize cache if not loaded
  if (moduleCache === null) {
    loadModuleInfo();
  }
  return moduleCache;
}

/**
 * Refresh module cache (call after nginx reload or config changes)
 */
function refreshModuleCache() {
  moduleCache = null;
  loadModuleInfo();
}

/**
 * Get nginx status information
 */
function getNginxStatus() {
  return {
    version: getNginxVersion(),
    running: isNginxRunning(),
    modules: getLoadedModules()
  };
}

/**
 * Safe reload: Test config first, then reload
 */
function safeReload() {
  // First, test the configuration
  const testResult = testNginxConfig();
  
  if (!testResult.success) {
    return {
      success: false,
      step: 'test',
      message: 'Configuration test failed',
      error: testResult.error,
      output: testResult.output
    };
  }
  
  // If test passes, reload
  const reloadResult = reloadNginx();
  
  if (!reloadResult.success) {
    return {
      success: false,
      step: 'reload',
      message: 'Reload failed',
      error: reloadResult.error,
      output: reloadResult.output
    };
  }
  
  return {
    success: true,
    message: 'Nginx reloaded successfully',
    output: reloadResult.output
  };
}

/**
 * Get nginx stub_status metrics
 * Fetches real-time connection and request statistics from nginx stub_status module
 * Returns { success: boolean, data?: object, error?: string }
 */
function getStubStatus() {
  try {
    const http = require('http');
    const https = require('https');
    
    // Try to fetch stub_status from localhost
    // Default endpoint: http://127.0.0.1/nginx_status
    const stubStatusUrl = process.env.STUB_STATUS_URL || 'http://127.0.0.1/nginx_status';
    
    return new Promise((resolve, reject) => {
      const protocol = stubStatusUrl.startsWith('https') ? https : http;
      const timeout = 5000;
      
      const req = protocol.get(stubStatusUrl, { timeout }, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return resolve({
              success: false,
              error: `stub_status returned HTTP ${res.statusCode}`,
              configured: false
            });
          }
          
          // Parse stub_status output
          // Example format:
          // Active connections: 291
          // server accepts handled requests
          //  16630948 16630948 31070465
          // Reading: 6 Writing: 179 Waiting: 106
          
          const parsed = parseStubStatusOutput(data);
          
          if (!parsed) {
            return resolve({
              success: false,
              error: 'Failed to parse stub_status output',
              rawOutput: data
            });
          }
          
          resolve({
            success: true,
            configured: true,
            data: parsed,
            timestamp: Date.now()
          });
        });
      });
      
      req.on('error', (error) => {
        // Connection refused or network error means stub_status is not configured
        resolve({
          success: false,
          configured: false,
          error: error.message,
          hint: 'stub_status module may not be configured in nginx. See documentation for setup instructions.'
        });
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          error: 'Request to stub_status endpoint timed out',
          configured: false
        });
      });
    });
  } catch (error) {
    return Promise.resolve({
      success: false,
      error: error.message
    });
  }
}

/**
 * Parse stub_status output into structured data
 */
function parseStubStatusOutput(output) {
  try {
    const lines = output.trim().split('\n');
    
    // Line 1: Active connections: 291
    const activeMatch = lines[0].match(/Active connections:\s+(\d+)/);
    if (!activeMatch) return null;
    
    // Line 3: 16630948 16630948 31070465 (accepts handled requests)
    const numbersLine = lines[2].trim().split(/\s+/);
    if (numbersLine.length < 3) return null;
    
    // Line 4: Reading: 6 Writing: 179 Waiting: 106
    const statesMatch = lines[3].match(/Reading:\s+(\d+)\s+Writing:\s+(\d+)\s+Waiting:\s+(\d+)/);
    if (!statesMatch) return null;
    
    return {
      active: parseInt(activeMatch[1]),
      accepts: parseInt(numbersLine[0]),
      handled: parseInt(numbersLine[1]),
      requests: parseInt(numbersLine[2]),
      reading: parseInt(statesMatch[1]),
      writing: parseInt(statesMatch[2]),
      waiting: parseInt(statesMatch[3]),
      // Calculate derived metrics
      requestsPerConnection: numbersLine[1] > 0 ? (parseInt(numbersLine[2]) / parseInt(numbersLine[1])).toFixed(2) : '0.00',
      handledPercentage: numbersLine[0] > 0 ? ((parseInt(numbersLine[1]) / parseInt(numbersLine[0])) * 100).toFixed(2) : '100.00'
    };
  } catch (error) {
    console.error('Error parsing stub_status output:', error);
    return null;
  }
}

module.exports = {
  testNginxConfig,
  reloadNginx,
  getNginxVersion,
  isNginxRunning,
  getNginxStatus,
  safeReload,
  loadModuleInfo,
  refreshModuleCache,
  getStubStatus
};
