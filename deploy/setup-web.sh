#!/usr/bin/env bash
# One-time setup of a web server (run ON Web01 and ON Web02 as a sudo user).
#
#   curl -fsSL https://raw.githubusercontent.com/muhirwanathan/<repo>/main/deploy/setup-web.sh -o setup-web.sh
#   sudo bash setup-web.sh https://github.com/muhirwanathan/<repo>.git web-01
#
# Idempotent: safe to run again.
set -euo pipefail

REPO_URL="${1:?usage: setup-web.sh <git-repo-url> <server-name>}"
SERVER_NAME="${2:?usage: setup-web.sh <git-repo-url> <server-name>}"
APP_DIR=/opt/weatherglass
APP_USER=weatherglass

echo "==> Installing packages (git, nginx, Node.js 20)"
apt-get update -y
apt-get install -y git nginx curl ca-certificates
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Creating service user"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

echo "==> Fetching code into $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci --omit=dev

if [ ! -f .env ]; then
  echo "==> Creating .env (edit it to add OPENWEATHER_API_KEY)"
  cp .env.example .env
fi
# SERVER_NAME and TRUST_PROXY are specific to this machine.
sed -i "s/^SERVER_NAME=.*/SERVER_NAME=$SERVER_NAME/" .env
sed -i "s/^TRUST_PROXY=.*/TRUST_PROXY=2/" .env
chmod 600 .env
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Installing systemd service"
cp deploy/systemd/weatherglass.service /etc/systemd/system/weatherglass.service
systemctl daemon-reload
systemctl enable weatherglass
systemctl restart weatherglass

echo "==> Configuring nginx"
cp deploy/nginx/weatherglass.conf /etc/nginx/sites-available/weatherglass
ln -sf /etc/nginx/sites-available/weatherglass /etc/nginx/sites-enabled/weatherglass
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Waiting for health check"
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1/api/health >/dev/null; then
    curl -s http://127.0.0.1/api/health; echo
    echo "==> $SERVER_NAME is up"
    exit 0
  fi
  sleep 1
done
echo "!! Health check failed. Check logs with: journalctl -u weatherglass -n 50" >&2
exit 1
