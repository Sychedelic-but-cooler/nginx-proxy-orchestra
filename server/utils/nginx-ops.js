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

module.exports = {
  testNginxConfig,
  reloadNginx,
  getNginxVersion,
  isNginxRunning,
  getNginxStatus,
  safeReload,
  loadModuleInfo,
  refreshModuleCache
};
