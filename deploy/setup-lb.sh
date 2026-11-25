#!/usr/bin/env bash
# Sets up HAProxy as the load balancer. Run from inside a copy of this repo.
#
#   bash deploy/setup-lb.sh <web01 host[:port]> <web02 host[:port]>     (port defaults to 80)
#
# Sandbox example (web-01 on the same box, web-02 on the second sandbox):
#   bash deploy/setup-lb.sh 127.0.0.1:8080 cb8ad26ec6c4.1de0cb85.alu-cod.online:44506
set -euo pipefail

SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
add_port() { case "$1" in *:*) echo "$1" ;; *) echo "$1:80" ;; esac; }
WEB01="$(add_port "${1:?usage: setup-lb.sh <web01 host[:port]> <web02 host[:port]>}")"
WEB02="$(add_port "${2:?usage: setup-lb.sh <web01 host[:port]> <web02 host[:port]>}")"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing HAProxy"
$SUDO apt-get update -y
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y haproxy curl

[ -f /etc/haproxy/haproxy.cfg ] && $SUDO cp /etc/haproxy/haproxy.cfg "/etc/haproxy/haproxy.cfg.bak.$(date +%s)"
sed -e "s/WEB01_ADDR/$WEB01/" -e "s/WEB02_ADDR/$WEB02/" "$HERE/haproxy/haproxy.cfg" | $SUDO tee /etc/haproxy/haproxy.cfg >/dev/null
$SUDO mkdir -p /run/haproxy

echo "==> Validating config"
$SUDO haproxy -c -f /etc/haproxy/haproxy.cfg

# `service` works both on full servers (systemd) and in containers without systemd.
$SUDO service haproxy restart || $SUDO service haproxy start

echo "==> Checking both backends"
for b in "$WEB01" "$WEB02"; do
  if curl -fsS --max-time 5 "http://$b/api/health" >/dev/null; then echo "    $b OK"; else echo "    !! $b is not answering yet"; fi
done
echo "==> Load balancer on :80 -> $WEB01, $WEB02"
