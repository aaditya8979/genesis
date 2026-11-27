#!/usr/bin/env bash
set -euo pipefail

echo "=== GENESIS 2026: Starting Tier-2/Tier-3 Warm-Standby Mirror ==="
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"
mkdir -p backups

# Optional pre-boot pull from S3 if S3_BACKUP_BUCKET is configured in .env
if [[ -f .env ]]; then
  S3_BUCKET=$(grep -E '^S3_BACKUP_BUCKET=' .env | cut -d= -f2- | tr -d '[:space:]' || true)
  if [[ -n "$S3_BUCKET" ]] && command -v aws &> /dev/null && [[ ! -f backups/latest_snapshot.json ]]; then
    aws s3 cp "s3://${S3_BUCKET}/latest_snapshot.json" backups/latest_snapshot.json --only-show-errors || true
  fi
fi

# Start full 3-container standby mirror (Postgres + FastAPI + built Vite/Nginx SPA) on port 8080
docker compose -f docker-compose.local.yml up -d --build

echo "Waiting for local mirror health..."
for i in {1..20}; do
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
  echo "Install cloudflared ('brew install cloudflared') to expose this mirror over public HTTPS/WSS!"
fi
