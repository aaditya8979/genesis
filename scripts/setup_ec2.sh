#!/usr/bin/env bash
set -euo pipefail

echo "=== GENESIS 2026: Hardening Ubuntu EC2 for 1,000+ Concurrent WebSockets ==="

# 1. Raise Linux socket & file descriptor limits (prevent OSError Too many open files at ~950 users)
sudo tee -a /etc/sysctl.conf > /dev/null <<EOF
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
fs.file-max = 200000
EOF
sudo sysctl -p

# 2. Install Docker & Docker Compose v2 if missing
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# 3. Generate SSL certificate using Certbot if domain is passed as $1
if [[ -n "${1:-}" ]]; then
  DOMAIN="$1"
  echo "Provisioning Let's Encrypt TLS certificate for $DOMAIN on Port 443..."
  sudo apt-get update && sudo apt-get install -y certbot
  sudo certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}"
  mkdir -p nginx/ssl
  sudo cp "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" nginx/ssl/fullchain.pem
  sudo cp "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" nginx/ssl/privkey.pem
  sudo chmod 644 nginx/ssl/*.pem
else
  echo "No domain argument given. Generating self-signed cert fallback in nginx/ssl/ (use Cloudflare Flexible/Full or pass domain)."
  mkdir -p nginx/ssl
  openssl req -x509 -nodes -days 30 -newkey rsa:2048 \
    -keyout nginx/ssl/privkey.pem \
    -out nginx/ssl/fullchain.pem \
    -subj "/CN=genesis2026.local"
fi

echo "=== Building & Launching 3-Container Production Stack ==="
docker compose up -d --build
echo "=== EC2 Stack Online! Verify with: curl -k https://localhost/health ==="

