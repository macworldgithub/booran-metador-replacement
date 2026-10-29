const fs = require('node:fs');
// Values use the same literal JSON quoting as configure.py and systemd's
// EnvironmentFile. Parsing explicitly preserves quotes, backslashes and dollars.
const environment = Object.fromEntries(
  fs.readFileSync('/etc/cranbourne/backend.env', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=');
      if (separator <= 0) throw new Error('Invalid backend.env setting');
      const value = line.slice(separator + 1).trim();
      return [line.slice(0, separator).trim(), value.startsWith('"') ? JSON.parse(value) : value];
    }),
);

module.exports = {
  apps: [{
    name: 'cranbourne-backend',
    cwd: '/var/www/cranbourne/current/backend',
    script: '/var/www/cranbourne/current/backend/dist/main.js',
    interpreter: '/var/www/cranbourne/runtime/node24/bin/node',
    node_args: ['--max-old-space-size=640'],
    // Scheduled SMS and write-back jobs must have only one process owner.
    exec_mode: 'fork',
    instances: 1,
    env: {
      ...environment,
      NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '5972',
    },
    watch: false,
    autorestart: true,
    min_uptime: '10s',
    max_restarts: 10,
    exp_backoff_restart_delay: 1000,
    max_memory_restart: '768M',
    kill_timeout: 45000,
    time: true,
    out_file: '/var/log/cranbourne/backend-out.log',
    error_file: '/var/log/cranbourne/backend-error.log',
    merge_logs: true,
  }],
};
