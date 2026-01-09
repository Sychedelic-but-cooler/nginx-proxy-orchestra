const fs = require('fs');
const path = require('path');

class LogOffsetTracker {
  constructor() {
    this.dataDir = path.join(__dirname, '..', '..', 'data');
    this.offsetFile = path.join(this.dataDir, 'log-offsets.json');
    this.offsets = this.loadOffsets();
  }

  loadOffsets() {
    try {
      if (fs.existsSync(this.offsetFile)) {
        return JSON.parse(fs.readFileSync(this.offsetFile, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading log offsets:', error);
    }
    return {};
  }

  saveOffsets() {
    try {
      fs.writeFileSync(this.offsetFile, JSON.stringify(this.offsets, null, 2));
    } catch (error) {
      console.error('Error saving log offsets:', error);
    }
  }

  getOffset(logPath) {
    return this.offsets[logPath] || { offset: 0, inode: 0, size: 0 };
  }

  setOffset(logPath, offset, inode, size) {
    this.offsets[logPath] = { offset, inode, size };
    this.saveOffsets();
  }

  detectRotation(logPath) {
    if (!fs.existsSync(logPath)) return true;

    const stats = fs.statSync(logPath);
    const stored = this.getOffset(logPath);

    // Rotation detected if inode changed or size is smaller
    return stats.ino !== stored.inode || stats.size < stored.offset;
  }
}

const tracker = new LogOffsetTracker();
module.exports = { logOffsetTracker: tracker };
