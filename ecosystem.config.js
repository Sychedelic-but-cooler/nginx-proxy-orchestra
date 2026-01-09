module.exports = {
  apps: [{
    name: 'nginx-proxy-orchestra',
    script: './server/index.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    // If you want to enable watch mode, use: pm2 start ecosystem.config.js --watch
    // The ignore_watch list will prevent restarts from log/data file changes
    ignore_watch: [
      'node_modules',
      'logs',
      'data',
      '.git',
      '*.log',
      '*.md',
      'backfill-*.js',
      'cleanup-*.js',
      'regenerate-*.js'
    ],
    // Environment variables (uses .env file if present)
    env: {
      NODE_ENV: 'production'
      // PORT and other vars are loaded from .env file
    },
    env_development: {
      NODE_ENV: 'development'
      // PORT and other vars are loaded from .env file
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '500M',
    restart_delay: 1000,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    // Kill timeout for graceful shutdown
    kill_timeout: 3000,
    // Wait for app to be ready
    wait_ready: false,
    // Listen for app ready signal
    listen_timeout: 10000
  }]
};
