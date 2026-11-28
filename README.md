# mail-log-viewer

A lightweight, read-only Next.js (App Router) web application for inspecting Postfix mail logs directly from an Ubuntu VPS without a database or login overhead.

## Features

- **No database required**: Parses `/var/log/mail.log` (plus rotated `.1` and `.gz` archives) on demand with an in-memory cache that automatically invalidates on file `mtime`, `size`, or `inode` change.
- **Postfix Queue Grouping**: Correlates `smtpd`, `cleanup`, `qmgr`, `smtp`/`local`/`lmtp`, `bounce`, and TLS lines by Queue ID, including multi-recipient deliveries, connection timeouts, and `NOQUEUE: reject` events.
- **Dashboard (`/`)**: Total/Delivered/Deferred/Bounced/Rejected cards, 24-hour Recharts volume breakdown, top bounce/deferral/rejection reasons, and top recipient domains.
- **Searchable Messages (`/messages`)**: Debounced search, status/date filtering, pagination, and a live **Auto-refresh** toggle powered by Server-Sent Events (`/api/stream`) with rotation handling.
- **Message Detail (`/messages/[queueId]`)**: Chronological event timeline, delivery attempts table, and collapsible raw syslog viewer with copy button.
- **Live SSE Tailer**: Real-time `/api/stream` endpoint using `fs.watch` + polling fallback with byte-offset and inode tracking across log rotations.
- **Optional `journald` Adapter**: `MAIL_LOG_SOURCE=journald` reads logs via `journalctl -u postfix -o short-iso` using a fixed argument list (`execFile`, no shell).

---

## Local Development

Point `MAIL_LOG_PATH` in `.env.local` to a local Postfix log file copy:

```bash
cp .env.example .env.local
# Edit .env.local to set MAIL_LOG_PATH=/path/to/your/mail.log
npm install
npm run dev
```

Run tests and checks:

```bash
npm run typecheck
npm run test:run
npm run lint
npm run build
```

---

## Ubuntu VPS Deployment (Hostinger + PM2 + Nginx)

> **Security note**: This application intentionally has no built-in login or database. Keep Next.js bound to `127.0.0.1:3099` and restrict access at Nginx (IP allowlist / VPN / `auth_basic`) before exposing it on a public domain.

### 1. Build the Application

```bash
sudo mkdir -p /var/www/mail-log-viewer
sudo chown -R $USER:$USER /var/www/mail-log-viewer
# Copy or git-clone the repository into /var/www/mail-log-viewer
cd /var/www/mail-log-viewer
npm ci
cp .env.example .env.local
# Edit .env.local: set MAIL_LOG_SOURCE=file, MAIL_LOG_PATH=/var/log/mail.log, TZ=UTC (or your server TZ)
npm run build
```

### 2. Grant Read Access to `/var/log/mail.log`

On Ubuntu, `/var/log/mail.log` is typically owned by `syslog:adm` with mode `0640`. Create a dedicated Linux user (or use your PM2 service user, e.g. `mailviewer`) and choose **one** of the two methods below:

#### Option A: Add the app user to the `adm` group (Recommended)

```bash
sudo usermod -aG adm mailviewer
# Log out/in or restart PM2 under that user so group membership takes effect
```

#### Option B: Grant read-only POSIX ACLs

```bash
sudo apt-get install -y acl
sudo setfacl -m u:mailviewer:r /var/log/mail.log
sudo setfacl -m d:u:mailviewer:r /var/log/
```

#### How `logrotate` affects permissions

When `rsyslog` rotates `/var/log/mail.log` (usually configured in `/etc/logrotate.d/rsyslog`), newly created `mail.log` files inherit the `create` directive:

```text
/var/log/mail.log
{
    rotate 4
    weekly
    missingok
    notifempty
    compress
    delaycompress
    sharedscripts
    create 0640 syslog adm
    postrotate
        /usr/lib/rsyslog/rsyslog-rotate
    endscript
}
```

- With **Option A (`adm` group)**, `create 0640 syslog adm` automatically keeps the new `mail.log`, `mail.log.1`, and `mail.log.*.gz` readable by `mailviewer`.
- With **Option B (ACLs)**, add `setfacl -m u:mailviewer:r /var/log/mail.log` inside the `postrotate` block so new rotated files keep the ACL.
- The SSE stream (`/api/stream`) detects `inode` changes and file truncation during `logrotate` and automatically resets its tail offset to byte `0`.

### 3. Systems Using `journald` Instead of `/var/log/mail.log`

On newer Ubuntu/Debian minimal installs without `rsyslog`, Postfix logs live in `systemd-journald` rather than `/var/log/mail.log`.

1. Verify Postfix logs exist in `journald`:
   ```bash
   journalctl -u postfix -o short-iso -n 20
   ```
2. Add the app user to the `systemd-journal` group:
   ```bash
   sudo usermod -aG systemd-journal mailviewer
   ```
3. Set `MAIL_LOG_SOURCE=journald` in `.env.local` (or `ecosystem.config.js`). The app runs `journalctl -u postfix -o short-iso -n <MAIL_LOG_MAX_LINES> --no-pager` via `execFile` with a fixed argument list and no shell.

### 4. Start with PM2

```bash
sudo npm install -g pm2
cd /var/www/mail-log-viewer
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 5. Configure Nginx + Certbot HTTPS

```bash
sudo cp deploy/nginx-mail-log-viewer.conf /etc/nginx/sites-available/mail-log-viewer
# Edit server_name (and uncomment allow/deny or auth_basic if desired)
sudo ln -s /etc/nginx/sites-available/mail-log-viewer /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d mail-logs.example.com
```
