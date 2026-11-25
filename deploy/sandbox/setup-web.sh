#!/usr/bin/env bash
# Sets up one web server inside an ALU Ubuntu 20.04 sandbox (no systemd).
# Run from inside the cloned repo:
#
#   bash deploy/sandbox/setup-web.sh <server-name> <nginx-port>
#
#   Sandbox 1 (also hosts the load balancer on :80/:8080): bash deploy/sandbox/setup-web.sh web-01 5000
#   Sandbox 2:                                         bash deploy/sandbox/setup-web.sh web-02 80
#
# Node.js runs under pm2 (keeps it alive and restarts it if it crashes);
# nginx listens on <nginx-port> and reverse-proxies to Node on 127.0.0.1:3000.
set -euo pipefail

SERVER_NAME="${1:?usage: setup-web.sh <server-name> <nginx-port>}"
NGINX_PORT="${2:?usage: setup-web.sh <server-name> <nginx-port>}"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_DIR"

echo "==> Installing nginx, curl, git"
$SUDO apt-get update -y
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y nginx curl git ca-certificates

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
command -v pm2 >/dev/null || $SUDO npm install -g pm2

echo "==> Installing app dependencies"
npm ci --omit=dev

if [ ! -f .env ]; then cp .env.example .env; fi
sed -i "s/^SERVER_NAME=.*/SERVER_NAME=$SERVER_NAME/" .env
sed -i "s/^TRUST_PROXY=.*/TRUST_PROXY=2/" .env
chmod 600 .env

echo "==> Starting app with pm2"
pm2 delete weatherglass >/dev/null 2>&1 || true
pm2 start server.js --name weatherglass --time
pm2 save

echo "==> Configuring nginx on port $NGINX_PORT"
sed -e "s/listen 80 default_server;/listen $NGINX_PORT default_server;/" \
    -e "s/listen \[::\]:80 default_server;/listen [::]:$NGINX_PORT default_server;/" \
    deploy/nginx/weatherglass.conf | $SUDO tee /etc/nginx/sites-available/weatherglass >/dev/null
$SUDO ln -sf /etc/nginx/sites-available/weatherglass /etc/nginx/sites-enabled/weatherglass
$SUDO rm -f /etc/nginx/sites-enabled/default
$SUDO nginx -t
$SUDO service nginx restart || $SUDO service nginx start

echo "==> Health check"
for _ in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:$NGINX_PORT/api/health"; then echo; echo "==> $SERVER_NAME is up on :$NGINX_PORT"; exit 0; fi
  sleep 1
done
echo "!! Health check failed. Logs: pm2 logs weatherglass --lines 50" >&2
exit 1
