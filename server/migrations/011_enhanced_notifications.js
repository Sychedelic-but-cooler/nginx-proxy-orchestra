/**
 * Migration 011: Enhanced Notification System
 *
 * Adds support for:
 * - WAF notification matrix (severity x count combinations)
 * - Daily report scheduling
 * - Modular notification controls
 * - Notification templates and batching
 */

function runEnhancedNotificationsMigration(db) {
  console.log('Running migration: Enhanced notifications system...');

  try {
    db.prepare('BEGIN TRANSACTION').run();

    // Step 1: Create notification schedules table for daily reports
    console.log('  - Creating notification_schedules table');
    db.prepare(`
      CREATE TABLE IF NOT EXISTS notification_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL, -- 'daily', 'weekly', 'custom'
        enabled INTEGER DEFAULT 1,
        cron_expression TEXT, -- For custom schedules
        last_run DATETIME,
        next_run DATETIME,
        settings TEXT, -- JSON configuration
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Step 2: Create WAF notification matrix table
    console.log('  - Creating waf_notification_matrix table');
    db.prepare(`
      CREATE TABLE IF NOT EXISTS waf_notification_matrix (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        severity_level TEXT NOT NULL, -- 'critical', 'error', 'warning', 'notice'
        count_threshold INTEGER NOT NULL,
        time_window INTEGER NOT NULL, -- in minutes
        enabled INTEGER DEFAULT 1,
        notification_delay INTEGER DEFAULT 0, -- cooldown in minutes
        last_triggered DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Step 3: Create notification templates table
    console.log('  - Creating notification_templates table');
    db.prepare(`
      CREATE TABLE IF NOT EXISTS notification_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL, -- 'waf_matrix', 'proxy_lifecycle', 'daily_report', etc.
        title_template TEXT NOT NULL,
        message_template TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Step 4: Create notification queue for batching
    console.log('  - Creating notification_queue table');
    db.prepare(`
      CREATE TABLE IF NOT EXISTS notification_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_type TEXT NOT NULL,
        event_data TEXT, -- JSON
        scheduled_for DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'failed'
        attempts INTEGER DEFAULT 0,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        sent_at DATETIME
      )
    `).run();

    // Step 5: Insert default WAF notification matrix entries
    console.log('  - Inserting default WAF matrix configurations');
    const defaultMatrixConfigs = [
      { severity: 'critical', count: 1, window: 1 }, // Immediate for critical
      { severity: 'critical', count: 5, window: 5 },
      { severity: 'critical', count: 10, window: 15 },
      { severity: 'error', count: 5, window: 5 },
      { severity: 'error', count: 10, window: 10 },
      { severity: 'error', count: 20, window: 30 },
      { severity: 'warning', count: 10, window: 10 },
      { severity: 'warning', count: 25, window: 30 },
      { severity: 'warning', count: 50, window: 60 },
      { severity: 'notice', count: 25, window: 30 },
      { severity: 'notice', count: 100, window: 60 },
      { severity: 'notice', count: 500, window: 240 }
    ];

    const insertMatrix = db.prepare(`
      INSERT INTO waf_notification_matrix (severity_level, count_threshold, time_window, enabled)
      VALUES (?, ?, ?, ?)
    `);

    defaultMatrixConfigs.forEach(config => {
      insertMatrix.run(config.severity, config.count, config.window, 1);
    });

    // Step 6: Insert default notification templates
    console.log('  - Inserting default notification templates');
    const defaultTemplates = [
      {
        name: 'WAF Matrix Alert',
        type: 'waf_matrix',
        title: 'WAF Alert: {severity} Events Detected',
        message: '{count} {severity} level WAF events detected in the last {window} minutes.\n\nTop Attack Types:\n{attack_summary}\n\nTop IPs:\n{ip_summary}'
      },
      {
        name: 'Proxy Created',
        type: 'proxy_created',
        title: 'Proxy Host Created',
        message: 'New proxy host "{proxy_name}" has been created.\n\nDomain Names: {domains}\nStatus: {status}\nCreated by: {user}'
      },
      {
        name: 'Proxy Deleted',
        type: 'proxy_deleted',
        title: 'Proxy Host Deleted',
        message: 'Proxy host "{proxy_name}" has been deleted.\n\nDomain Names: {domains}\nDeleted by: {user}'
      },
      {
        name: 'Daily Report',
        type: 'daily_report',
        title: 'Daily Nginx & WAF Report - {date}',
        message: 'Daily Report for {date}\n\nSecurity Summary:\n{waf_summary}\n\nTraffic Summary:\n{nginx_summary}\n\nNotable Events:\n{notable_events}'
      }
    ];

    const insertTemplate = db.prepare(`
      INSERT INTO notification_templates (name, type, title_template, message_template)
      VALUES (?, ?, ?, ?)
    `);

    defaultTemplates.forEach(template => {
      insertTemplate.run(template.name, template.type, template.title, template.message);
    });

    // Step 7: Insert default daily report schedule
    console.log('  - Creating default daily report schedule');
    db.prepare(`
      INSERT INTO notification_schedules (name, type, cron_expression, settings, enabled)
      VALUES (
        'Daily Report',
        'daily',
        '30 23 * * *',
        '{"report_type": "daily", "include_nginx": true, "include_waf": true, "include_bans": true}',
        1
      )
    `).run();

    // Step 8: Add new settings for enhanced features
    console.log('  - Adding new notification settings');
    const newSettings = [
      ['notification_matrix_enabled', '1'],
      ['notification_daily_report_enabled', '1'], 
      ['notification_proxy_lifecycle_enabled', '1'],
      ['notification_batching_enabled', '1'],
      ['notification_batch_interval', '300'], // 5 minutes
      ['notification_rate_limit', '10'], // Max 10 notifications per hour
      ['notification_daily_report_time', '23:30'],
      ['notification_timezone', 'UTC']
    ];

    const insertSetting = db.prepare(`
      INSERT OR IGNORE INTO settings (key, value)
      VALUES (?, ?)
    `);

    newSettings.forEach(([key, value]) => {
      insertSetting.run(key, value);
    });

    db.prepare('COMMIT').run();
    console.log('Enhanced notifications migration completed successfully!');

  } catch (error) {
    db.prepare('ROLLBACK').run();
    console.error('Enhanced notifications migration failed:', error);
    throw error;
  }
}

module.exports = runEnhancedNotificationsMigration;