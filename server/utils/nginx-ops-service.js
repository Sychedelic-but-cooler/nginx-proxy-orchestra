const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Nginx operations using signal-file approach (no sudo needed)
 * Requires nginx-reload-watcher service to be running
 */

const PROJECT_ROOT = path.join(__dirname, '../..');
const SIGNAL_FILE = path.join(PROJECT_ROOT, 'data/.nginx-reload-signal');
const TEST_RESULT_FILE = path.join(PROJECT_ROOT, 'data/.nginx-test-result');
const RELOAD_RESULT_FILE = path.join(PROJECT_ROOT, 'data/.nginx-reload-result');

/**
 * Signal the watcher service and wait for result
 */
function signalAndWait(signalType, resultFile, timeout = 5000) {
  try {
    // Remove old result file if exists
    if (fs.existsSync(resultFile)) {
      fs.unlinkSync(resultFile);
    }

    // Write signal file
    fs.writeFileSync(SIGNAL_FILE, signalType);

    // Wait for result file
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (fs.existsSync(resultFile)) {
        const result = fs.readFileSync(resultFile, 'utf8').trim();
        fs.unlinkSync(resultFile); // Clean up
        return result === 'OK';
      }

      // Sleep 100ms
      execSync('sleep 0.1', { encoding: 'utf8' });
    }

    throw new Error('Timeout waiting for nginx operation');
  } catch (error) {
    throw error;
  }
}

/**
 * Test nginx configuration
 * Returns { success: boolean, output: string, error?: string }
 */
function testNginxConfig() {
  try {
    const success = signalAndWait('test', TEST_RESULT_FILE);

    // Read log for output
    const logFile = path.join(PROJECT_ROOT, 'data/nginx-reload.log');
    let output = '';
    if (fs.existsSync(logFile)) {
      const logContent = fs.readFileSync(logFile, 'utf8');
      const lines = logContent.split('\n');
      output = lines.slice(-10).join('\n'); // Last 10 lines
    }

    return {
      success,
      output: output.trim()
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error.message
    };
  }
}

/**
 * Reload nginx configuration
 * Returns { success: boolean, output: string, error?: string }
 */
function reloadNginx() {
  try {
    const success = signalAndWait('reload', RELOAD_RESULT_FILE);

    // Read log for output
    const logFile = path.join(PROJECT_ROOT, 'data/nginx-reload.log');
    let output = '';
    if (fs.existsSync(logFile)) {
      const logContent = fs.readFileSync(logFile, 'utf8');
      const lines = logContent.split('\n');
      output = lines.slice(-10).join('\n'); // Last 10 lines
    }

    return {
      success,
      output: output.trim()
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error.message
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
