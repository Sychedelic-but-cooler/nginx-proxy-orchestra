/**
 * Enhanced Notification Scheduler
 * 
 * Handles periodic checks for WAF matrix notifications,
 * manages notification queue processing, and schedules daily reports
 */

const { getSetting } = require('../db');
const { checkWAFMatrix } = require('./notification-service');

class NotificationScheduler {
  constructor() {
    this.intervals = new Map();
    this.isRunning = false;
  }

  /**
   * Start the notification scheduler
   */
  start() {
    if (this.isRunning) {
      console.log('Notification scheduler already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting enhanced notification scheduler...');

    try {
      // Start WAF matrix checking (every 2 minutes)
      this.startWAFMatrixChecks();
      
      // Start queue processing (every 5 minutes)
      this.startQueueProcessing();
      
      console.log('Notification scheduler started successfully');
    } catch (error) {
      console.error('Failed to start notification scheduler:', error);
      this.isRunning = false;
    }
  }

  /**
   * Stop the notification scheduler
   */
  stop() {
    if (!this.isRunning) return;

    console.log('Stopping notification scheduler...');

    // Clear all intervals
    this.intervals.forEach((interval, name) => {
      clearInterval(interval);
      console.log(`  - Stopped ${name}`);
    });

    this.intervals.clear();
    this.isRunning = false;
    console.log('Notification scheduler stopped');
  }

  /**
   * Restart the scheduler (useful for configuration changes)
   */
  restart() {
    console.log('Restarting notification scheduler...');
    this.stop();
    setTimeout(() => this.start(), 1000);
  }

  /**
   * Start WAF matrix checking
   */
  startWAFMatrixChecks() {
    const interval = setInterval(async () => {
      try {
        const matrixEnabled = getSetting('notification_matrix_enabled') === '1';
        const notificationsEnabled = getSetting('notifications_enabled') === '1';
        
        if (notificationsEnabled && matrixEnabled) {
          await checkWAFMatrix();
        }
      } catch (error) {
        console.error('Error in WAF matrix check:', error);
      }
    }, 2 * 60 * 1000); // Every 2 minutes

    this.intervals.set('waf_matrix_check', interval);
    console.log('  - WAF matrix checks: every 2 minutes');
  }

  /**
   * Start notification queue processing
   */
  startQueueProcessing() {
    const interval = setInterval(async () => {
      try {
        const batchingEnabled = getSetting('notification_batching_enabled') === '1';
        const notificationsEnabled = getSetting('notifications_enabled') === '1';
        
        if (notificationsEnabled && batchingEnabled) {
          const { getNotificationService } = require('./notification-service');
          const service = getNotificationService();
          
          if (service.processNotificationQueue) {
            await service.processNotificationQueue();
          }
        }
      } catch (error) {
        console.error('Error in queue processing:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    this.intervals.set('queue_processing', interval);
    console.log('  - Queue processing: every 5 minutes');
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      running: this.isRunning,
      activeIntervals: Array.from(this.intervals.keys()),
      intervalCount: this.intervals.size
    };
  }

  /**
   * Get health check info
   */
  getHealthCheck() {
    const status = this.getStatus();
    
    return {
      scheduler: {
        status: status.running ? 'healthy' : 'stopped',
        intervals: status.activeIntervals,
        lastCheck: new Date().toISOString()
      },
      settings: {
        notifications_enabled: getSetting('notifications_enabled') === '1',
        matrix_enabled: getSetting('notification_matrix_enabled') === '1',
        daily_report_enabled: getSetting('notification_daily_report_enabled') === '1',
        batching_enabled: getSetting('notification_batching_enabled') === '1'
      }
    };
  }
}

// Singleton instance
let instance = null;

function getNotificationScheduler() {
  if (!instance) {
    instance = new NotificationScheduler();
  }
  return instance;
}

/**
 * Initialize and start the notification scheduler
 */
function initializeNotificationScheduler() {
  try {
    const scheduler = getNotificationScheduler();
    scheduler.start();
    
    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down notification scheduler...');
      scheduler.stop();
    });

    process.on('SIGTERM', () => {
      console.log('\nShutting down notification scheduler...');
      scheduler.stop();
    });
    
    return scheduler;
  } catch (error) {
    console.error('Failed to initialize notification scheduler:', error);
    return null;
  }
}

module.exports = {
  NotificationScheduler,
  getNotificationScheduler,
  initializeNotificationScheduler
};