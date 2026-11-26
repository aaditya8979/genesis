#!/usr/bin/env bash
set -euo pipefail

echo "=== GENESIS 2026: Starting Tier-3 Local Warm-Standby Mirror ==="
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

# Start local 3-container mirror on port 8080
docker compose -f docker-compose.local.yml up -d --build

echo "Waiting for local mirror health..."
for i in {1..15}; do
  if curl -sf http://127.0.0.1:8080/health > /dev/null; then
    echo "Standby Mirror Online at http://127.0.0.1:8080"
    break
  fi
  sleep 2
done

if command -v cloudflared &> /dev/null; then
  echo "Launching public HTTPS/WSS Cloudflare Tunnel on Port 443..."
  cloudflared tunnel --url http://127.0.0.1:8080
else
  echo "Install cloudflared (`brew install cloudflared`) to expose your Mac as a Port 443 public failover!"
fi

