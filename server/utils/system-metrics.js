/**
 * System Metrics Collection
 * Provides real-time and static system information
 */

const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

// Cache for static system information
let staticInfoCache = null;

// Track previous network/disk stats for rate calculations
let previousNetworkStats = null;
let previousDiskStats = null;
let previousTimestamp = null;

/**
 * Get static system information (cached)
 * This includes hardware details that don't change
 */
function getStaticSystemInfo() {
  if (staticInfoCache) {
    return staticInfoCache;
  }

  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || 'Unknown';
  const cpuCores = cpus.length;
  const cpuSpeed = cpus[0]?.speed || 0;

  // Get OS information
  const platform = os.platform();
  const release = os.release();
  const osType = os.type();
  
  let osName = `${osType} ${release}`;
  
  // Try to get more detailed OS info on Linux
  if (platform === 'linux') {
    try {
      const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
      const prettyName = osRelease.match(/PRETTY_NAME="(.+)"/);
      if (prettyName) {
        osName = prettyName[1];
      }
    } catch (error) {
      // Fall back to basic info
    }
  }

  const totalMemory = os.totalmem();
  const hostname = os.hostname();

  staticInfoCache = {
    hostname,
    os: osName,
    platform,
    cpu: {
      model: cpuModel,
      cores: cpuCores,
      speed: cpuSpeed
    },
    memory: {
      total: totalMemory
    }
  };

  return staticInfoCache;
}

/**
 * Get system uptime in seconds
 */
function getUptime() {
  return os.uptime();
}

/**
 * Get load average
 */
function getLoadAverage() {
  const loadavg = os.loadavg();
  return {
    '1min': loadavg[0],
    '5min': loadavg[1],
    '15min': loadavg[2]
  };
}

/**
 * Get CPU utilization percentage
 * Returns average across all cores
 */
function getCPUUtilization() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  cpus.forEach(cpu => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });

  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const usage = 100 - ~~(100 * idle / total);

  return {
    usage: Math.max(0, Math.min(100, usage)),
    cores: cpus.length
  };
}

/**
 * Get memory usage
 */
function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const usagePercent = (used / total) * 100;

  return {
    total,
    used,
    free,
    usagePercent: Math.round(usagePercent * 100) / 100
  };
}

/**
 * Get swap memory usage
 */
function getSwapUsage() {
  try {
    // Read swap info from /proc/meminfo
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const swapTotalMatch = meminfo.match(/SwapTotal:\s+(\d+)\s+kB/);
    const swapFreeMatch = meminfo.match(/SwapFree:\s+(\d+)\s+kB/);
    
    if (swapTotalMatch && swapFreeMatch) {
      const total = parseInt(swapTotalMatch[1], 10) * 1024; // Convert to bytes
      const free = parseInt(swapFreeMatch[1], 10) * 1024;
      const used = total - free;
      const usagePercent = total > 0 ? (used / total) * 100 : 0;
      
      return {
        total,
        used,
        free,
        usagePercent: Math.round(usagePercent * 100) / 100
      };
    }
  } catch (error) {
    // Swap not available or error reading
  }
  
  return {
    total: 0,
    used: 0,
    free: 0,
    usagePercent: 0
  };
}

/**
 * Get disk usage for root filesystem
 */
function getDiskUsage() {
  try {
    // Use df command for more accurate disk stats
    const output = execSync('df -B1 / | tail -n 1', { encoding: 'utf8' });
    const parts = output.trim().split(/\s+/);
    
    const total = parseInt(parts[1], 10);
    const used = parseInt(parts[2], 10);
    const available = parseInt(parts[3], 10);
    const usagePercent = parseFloat(parts[4]);

    return {
      total,
      used,
      available,
      usagePercent
    };
  } catch (error) {
    // Fallback: return unknown
    return {
      total: 0,
      used: 0,
      available: 0,
      usagePercent: 0
    };
  }
}

/**
 * Get network statistics
 * Returns bytes sent/received and rates if previous data available
 */
function getNetworkStats() {
  try {
    const currentTimestamp = Date.now();
    let totalRx = 0;
    let totalTx = 0;

    // Read network stats from /proc/net/dev
    const netDev = fs.readFileSync('/proc/net/dev', 'utf8');
    const lines = netDev.split('\n');

    for (const line of lines) {
      // Skip header lines and loopback
      if (line.includes(':') && !line.includes('lo:')) {
        const parts = line.split(':')[1].trim().split(/\s+/);
        totalRx += parseInt(parts[0], 10) || 0;  // Receive bytes
        totalTx += parseInt(parts[8], 10) || 0;  // Transmit bytes
      }
    }

    let rxRate = 0;
    let txRate = 0;

    // Calculate rates if we have previous data
    if (previousNetworkStats && previousTimestamp) {
      const timeDiff = (currentTimestamp - previousTimestamp) / 1000; // seconds
      rxRate = (totalRx - previousNetworkStats.rx) / timeDiff;
      txRate = (totalTx - previousNetworkStats.tx) / timeDiff;
    }

    // Store current stats for next calculation
    previousNetworkStats = { rx: totalRx, tx: totalTx };
    previousTimestamp = currentTimestamp;

    return {
      rx: totalRx,
      tx: totalTx,
      rxRate: Math.max(0, rxRate),
      txRate: Math.max(0, txRate)
    };
  } catch (error) {
    return {
      rx: 0,
      tx: 0,
      rxRate: 0,
      txRate: 0
    };
  }
}

/**
 * Get disk I/O statistics
 * Returns reads/writes per second
 */
function getDiskIOStats() {
  try {
    const currentTimestamp = Date.now();
    let totalReads = 0;
    let totalWrites = 0;

    // Read disk stats from /proc/diskstats
    const diskStats = fs.readFileSync('/proc/diskstats', 'utf8');
    const lines = diskStats.split('\n');

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      // Only count main disks (sda, nvme0n1, vda, etc), not partitions
      if (parts.length >= 14) {
        const device = parts[2];
        if (/^(sd[a-z]|nvme\d+n\d+|vd[a-z]|hd[a-z])$/.test(device)) {
          totalReads += parseInt(parts[3], 10) || 0;   // Read operations
          totalWrites += parseInt(parts[7], 10) || 0;  // Write operations
        }
      }
    }

    let readsPerSec = 0;
    let writesPerSec = 0;

    // Calculate rates if we have previous data
    if (previousDiskStats && previousTimestamp) {
      const timeDiff = (currentTimestamp - previousTimestamp) / 1000; // seconds
      readsPerSec = (totalReads - previousDiskStats.reads) / timeDiff;
      writesPerSec = (totalWrites - previousDiskStats.writes) / timeDiff;
    }

    // Store current stats for next calculation
    previousDiskStats = { reads: totalReads, writes: totalWrites };

    return {
      reads: totalReads,
      writes: totalWrites,
      readsPerSec: Math.max(0, readsPerSec),
      writesPerSec: Math.max(0, writesPerSec)
    };
  } catch (error) {
    return {
      reads: 0,
      writes: 0,
      readsPerSec: 0,
      writesPerSec: 0
    };
  }
}

/**
 * Get all real-time metrics
 * This should be called frequently for per-second updates
 */
function getRealTimeMetrics() {
  return {
    uptime: getUptime(),
    loadAverage: getLoadAverage(),
    cpu: getCPUUtilization(),
    memory: getMemoryUsage(),
    swap: getSwapUsage(),
    disk: getDiskUsage(),
    network: getNetworkStats(),
    diskIO: getDiskIOStats(),
    timestamp: Date.now()
  };
}

/**
 * Initialize static info cache on module load
 */
function initializeCache() {
  getStaticSystemInfo();
}

module.exports = {
  getStaticSystemInfo,
  getRealTimeMetrics,
  getUptime,
  getLoadAverage,
  getCPUUtilization,
  getMemoryUsage,
  getSwapUsage,
  getDiskUsage,
  getNetworkStats,
  getDiskIOStats,
  initializeCache
};
