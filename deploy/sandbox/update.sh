#!/usr/bin/env bash
# Pulls the latest code and restarts the app on ONE sandbox.
# For zero downtime, run it on web-02 first, wait for "healthy", then on web-01.
# HAProxy keeps routing traffic to whichever server is up.
#
#   bash deploy/sandbox/update.sh <nginx-port>      (web-01: 8080, web-02: 80)
set -euo pipefail
PORT="${1:?usage: update.sh <nginx-port>}"
cd "$(cd "$(dirname "$0")/../.." && pwd)"

git pull --ff-only
npm ci --omit=dev
pm2 restart weatherglass --update-env

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then echo "healthy"; exit 0; fi
  sleep 1
done
echo "!! not healthy, check: pm2 logs weatherglass" >&2
exit 1
