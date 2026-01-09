const { spawn } = require('child_process');

class NginxReloadManager {
  constructor() {
    this.reloadInProgress = false;
    this.reloadQueue = [];
    this.currentReloadId = 0;
    this.reloadStatus = new Map();
  }

  async queueReload() {
    const reloadId = ++this.currentReloadId;
    this.reloadQueue.push(reloadId);
    this.reloadStatus.set(reloadId, { status: 'queued', progress: 0 });

    if (!this.reloadInProgress) {
      this.processQueue();
    }

    return { reloadId, status: 'queued' };
  }

  async processQueue() {
    if (this.reloadQueue.length === 0) {
      this.reloadInProgress = false;
      return;
    }

    this.reloadInProgress = true;
    const reloadId = this.reloadQueue.shift();

    this.reloadStatus.set(reloadId, { status: 'testing', progress: 25 });
    const testResult = await this.testConfigAsync();

    if (!testResult.success) {
      this.reloadStatus.set(reloadId, {
        status: 'failed',
        progress: 100,
        error: testResult.error
      });
      this.processQueue();
      return;
    }

    this.reloadStatus.set(reloadId, { status: 'reloading', progress: 75 });
    const reloadResult = await this.reloadAsync();

    this.reloadStatus.set(reloadId, {
      status: reloadResult.success ? 'completed' : 'failed',
      progress: 100,
      result: reloadResult
    });

    this.processQueue();
  }

  testConfigAsync() {
    return new Promise((resolve) => {
      const proc = spawn('sudo', ['nginx', '-t']);
      let stderr = '';

      proc.stderr.on('data', (data) => stderr += data);

      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          output: stderr,
          error: code !== 0 ? stderr : null
        });
      });

      setTimeout(() => {
        proc.kill();
        resolve({ success: false, error: 'Config test timeout (30s)' });
      }, 30000);
    });
  }

  reloadAsync() {
    return new Promise((resolve) => {
      const proc = spawn('sudo', ['systemctl', 'reload', 'nginx']);
      let stderr = '';

      proc.stderr.on('data', (data) => stderr += data);

      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          error: code !== 0 ? stderr : null
        });
      });

      setTimeout(() => {
        proc.kill();
        resolve({ success: false, error: 'Reload timeout (5s)' });
      }, 5000);
    });
  }

  getReloadStatus(reloadId) {
    return this.reloadStatus.get(reloadId) || { status: 'not_found' };
  }

  clearOldStatuses() {
    // Keep last 100 statuses only
    if (this.reloadStatus.size > 100) {
      const entries = Array.from(this.reloadStatus.entries());
      const toDelete = entries.slice(0, entries.length - 100);
      toDelete.forEach(([id]) => this.reloadStatus.delete(id));
    }
  }
}

const manager = new NginxReloadManager();
module.exports = { reloadManager: manager };
