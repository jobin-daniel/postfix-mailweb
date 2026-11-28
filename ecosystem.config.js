module.exports = {
  apps: [
    {
      name: "mail-log-viewer",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 3099",
      cwd: "/opt/mail-log-viewer",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 3099,
        MAIL_LOG_SOURCE: "file",
        MAIL_LOG_PATH: "/var/log/mail.log",
        MAIL_LOG_INCLUDE_ROTATED: "true",
        TZ: "UTC",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
};
