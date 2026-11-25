#!/usr/bin/env bash
# Sandboxes have no systemd, so nothing starts automatically after the
# sandbox is restarted. Run this on each sandbox after a restart:
#
#   bash deploy/sandbox/start-all.sh
set -uo pipefail
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_DIR"

pm2 resurrect >/dev/null 2>&1
pm2 describe weatherglass >/dev/null 2>&1 || pm2 start server.js --name weatherglass --time
pm2 save >/dev/null

$SUDO service nginx start
[ -f /etc/haproxy/haproxy.cfg ] && command -v haproxy >/dev/null && { $SUDO mkdir -p /run/haproxy; $SUDO service haproxy start; }

pm2 status
