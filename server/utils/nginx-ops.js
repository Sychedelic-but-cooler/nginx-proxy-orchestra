const { execSync } = require('child_process');

/**
 * Test nginx configuration
 * Returns { success: boolean, output: string, error?: string }
 */
function testNginxConfig() {
  try {
    const output = execSync('nginx -t 2>&1', {
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
 * Reload nginx configuration
 * Returns { success: boolean, output: string, error?: string }
 */
function reloadNginx() {
  try {
    const output = execSync('nginx -s reload 2>&1', {
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
 * Get nginx status information
 */
function getNginxStatus() {
  return {
    version: getNginxVersion(),
    running: isNginxRunning()
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
  safeReload
};
