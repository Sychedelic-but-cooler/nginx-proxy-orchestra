module.exports = {
  apps: [{
    name: 'nginx-proxy-orchestra',
    script: './server/index.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '200M',
    restart_delay: 3000,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
