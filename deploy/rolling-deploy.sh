#!/usr/bin/env bash
# Zero-downtime rolling deploy, run from your laptop (or CI):
#
#   SSH_USER=ubuntu WEB01=1.2.3.4 WEB02=5.6.7.8 LB=9.9.9.9 bash deploy/rolling-deploy.sh
#
# Updates ONE server at a time. While a server restarts, HAProxy's health
# check marks it down and sends all traffic to the other one. The script only
# moves to the next server after the updated one passes its health check.
set -euo pipefail

: "${SSH_USER:?set SSH_USER}"
: "${WEB01:?set WEB01}"
: "${WEB02:?set WEB02}"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=accept-new -o ConnectTimeout=10}"

deploy_one() {
  local host="$1"
  echo "==> Deploying to $host"
  # shellcheck disable=SC2086
  ssh $SSH_OPTS "$SSH_USER@$host" 'set -e
    cd /opt/weatherglass
    sudo -u weatherglass git pull --ff-only
    sudo -u weatherglass npm ci --omit=dev
    sudo systemctl restart weatherglass'

  echo "    waiting for $host to become healthy..."
  for _ in $(seq 1 20); do
    if curl -fsS "http://$host/api/health" >/dev/null; then
      echo "    $host healthy"
      # Give HAProxy time to see it "up" (rise 2 x inter 3s) before touching the other server.
      sleep 7
      return 0
    fi
    sleep 1
  done
  echo "!! $host failed its health check. Stopping rollout; the other server is untouched." >&2
  exit 1
}

deploy_one "$WEB01"
deploy_one "$WEB02"

if [ -n "${LB:-}" ]; then
  echo "==> Verifying through the load balancer"
  for _ in 1 2 3 4; do
    curl -s -o /dev/null -D - "http://$LB/api/health" | grep -i '^x-served-by'
  done
fi
echo "==> Rollout complete"
