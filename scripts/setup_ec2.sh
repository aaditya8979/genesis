#!/usr/bin/env bash
set -euo pipefail

# GENESIS 2026 — Turnkey Free-Tier / Low-Cost AWS EC2 Bootstrap (Ubuntu 22.04/24.04 & Amazon Linux 2023)
# Usage:
#   ./scripts/setup_ec2.sh api.yourdomain.com   # Let's Encrypt Port 443 HTTPS/WSS
#   ./scripts/setup_ec2.sh --http               # Port 80 HTTP mode (for ALB/CloudFront TLS or raw EC2 IP test)
#   ./scripts/setup_ec2.sh                      # Self-signed Port 443 cert (Cloudflare Full SSL mode)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

echo "=== 1. Hardening Kernel Limits for 1,000+ Concurrent WebSockets ==="
sudo tee /etc/sysctl.d/99-genesis.conf > /dev/null <<EOF
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
fs.file-max = 200000
EOF
sudo sysctl --system > /dev/null

echo "=== 2. Ensuring 2GB Swap Safety (prevents OOM on t3.micro/t3.small Free Tier builds) ==="
if ! swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab > /dev/null
  fi
fi

echo "=== 3. Installing Docker Engine & Compose Plugin if Missing ==="
if ! command -v docker &> /dev/null; then
  if [[ -f /etc/os-release ]] && grep -qi 'amzn' /etc/os-release; then
    sudo dnf install -y docker git cronie
    sudo systemctl enable --now docker
    sudo systemctl enable --now crond || true
    sudo mkdir -p /usr/local/lib/docker/cli-plugins
    ARCH=$(uname -m)
    sudo curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  else
    curl -fsSL https://get.docker.com | sudo sh
  fi
  sudo usermod -aG docker "$USER" || true
elif [[ -f /etc/os-release ]] && grep -qi 'amzn' /etc/os-release; then
  sudo systemctl enable --now docker || true
  if ! command -v crontab &> /dev/null; then
    sudo dnf install -y cronie && sudo systemctl enable --now crond || true
  fi
fi

DOCKER_COMPOSE="docker compose"
if ! docker info > /dev/null 2>&1; then
  DOCKER_COMPOSE="sudo docker compose"
fi

echo "=== 4. Preparing .env Configuration ==="
if [[ ! -f .env ]]; then
  cp .env.example .env
  RAND_PG=$(openssl rand -hex 12)
  RAND_JWT=$(openssl rand -hex 24)
  sed -i.bak "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${RAND_PG}/" .env
  sed -i.bak "s/^SECRET_KEY=.*/SECRET_KEY=${RAND_JWT}/" .env
  rm -f .env.bak
  echo "Created .env with auto-generated Postgres & JWT secrets (set ADMIN_SECRET_KEY / SUPABASE / S3 as needed)."
fi

set_env_var() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" .env
    rm -f .env.bak
  else
    echo "${key}=${val}" >> .env
  fi
}

MODE="${1:-}"
mkdir -p nginx/ssl backups

if [[ "$MODE" == "--http" ]]; then
  echo "Configuring Port 80 HTTP mode (NGINX_CONF=./nginx/nginx.http.conf)..."
  set_env_var "NGINX_CONF" "./nginx/nginx.http.conf"
elif [[ -n "$MODE" ]]; then
  DOMAIN="$MODE"
  set_env_var "NGINX_CONF" "./nginx/nginx.conf"
  echo "Provisioning Let's Encrypt TLS certificate for $DOMAIN on Port 443..."
  if command -v apt-get &> /dev/null; then
    sudo apt-get update && sudo apt-get install -y certbot
  elif command -v dnf &> /dev/null; then
    sudo dnf install -y certbot
  fi
  sudo certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}"
  sudo cp "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" nginx/ssl/fullchain.pem
  sudo cp "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" nginx/ssl/privkey.pem
  sudo chmod 644 nginx/ssl/*.pem
else
  set_env_var "NGINX_CONF" "./nginx/nginx.conf"
  if [[ ! -f nginx/ssl/fullchain.pem || ! -f nginx/ssl/privkey.pem ]]; then
    echo "Generating self-signed TLS cert fallback in nginx/ssl/ (pair with Cloudflare Full SSL or use --http)..."
    openssl req -x509 -nodes -days 30 -newkey rsa:2048 \
      -keyout nginx/ssl/privkey.pem \
      -out nginx/ssl/fullchain.pem \
      -subj "/CN=genesis2026.local"
  fi
fi

# Optional S3 pre-boot restore + 1-minute off-instance snapshot sync cron
S3_BUCKET=$(grep -E '^S3_BACKUP_BUCKET=' .env | cut -d= -f2- | tr -d '[:space:]' || true)
if [[ -n "$S3_BUCKET" ]]; then
  if ! command -v aws &> /dev/null; then
    if command -v apt-get &> /dev/null; then
      sudo apt-get update && sudo apt-get install -y awscli || true
    elif command -v dnf &> /dev/null; then
      sudo dnf install -y awscli || true
    fi
  fi
  if command -v aws &> /dev/null; then
    if [[ ! -f "$ROOT_DIR/backups/latest_snapshot.json" ]]; then
      echo "Checking s3://${S3_BUCKET}/latest_snapshot.json for pre-boot disaster recovery..."
      aws s3 cp "s3://${S3_BUCKET}/latest_snapshot.json" "$ROOT_DIR/backups/latest_snapshot.json" --only-show-errors || true
    fi
    CRON_CMD="* * * * * [ -f $ROOT_DIR/backups/latest_snapshot.json ] && aws s3 cp $ROOT_DIR/backups/latest_snapshot.json s3://${S3_BUCKET}/latest_snapshot.json --only-show-errors"
    (crontab -l 2>/dev/null | grep -v 'latest_snapshot.json' ; echo "$CRON_CMD") | crontab -
    echo "Enabled 1-minute Free-Tier S3 snapshot sync -> s3://${S3_BUCKET}/latest_snapshot.json"
  fi
fi

echo "=== 5. Launching 3-Container Production Stack (Postgres + FastAPI + Vite/Nginx) ==="
$DOCKER_COMPOSE up -d --build

echo "Waiting for GENESIS 2026 health endpoint..."
for i in {1..20}; do
  if curl -skf http://127.0.0.1/health 2>/dev/null || curl -skf https://127.0.0.1/health 2>/dev/null; then
    echo ""
    echo "=== GENESIS 2026 AWS Stack Online ==="
    exit 0
  fi
  sleep 2
done

echo "WARNING: Stack started, check logs with: $DOCKER_COMPOSE logs -f backend nginx"
