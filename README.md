# GENESIS 2026 — Institutional Trading Engine & War Room

High-throughput, sub-15ms virtual stock exchange engineered for **1,000+ concurrent traders** behind campus Fortinet DPI firewalls.

## Architecture Highlights
- **3-Container Stack (`docker-compose.yml`):** Isolated `postgres:15-alpine`, `backend` (FastAPI + single `uvloop` worker sharing one authoritative RAM price state), and `nginx` (Port 443 TLS/WSS termination, `worker_rlimit_nofile 65535`).
- **Campus NAT & Firewall Survival:** Zero IP rate-limiting in Nginx (rate limiting is keyed strictly per `user_id` JWT inside FastAPI); 15s WebSocket heartbeat + automatic downgrade to 1s HTTPS Polling if WSS is blocked.
- **Zero-Loss Rehydration & Failover:** Every trade executes in atomic PostgreSQL transactions (`SELECT ... FOR UPDATE`), idempotent `client_order_id` prevents double orders, and a 15-second atomic snapshot exporter (`backups/latest_snapshot.json`) + `STANDBY_SYNC_URL` powers instant Tier-2/Tier-3 takeover.
- **Upstox / Groww Pro UI:** TradingView `lightweight-charts` canvas rendering at 60 FPS decoupled via `zustand`, Plus Jakarta Sans + JetBrains Mono `tabular-nums`, live 30s crowd pressure bar, and instant real-time Admin top-up pushes.

## Quick Start (Local Docker Verification)
```bash
# 1. Start 3-container Postgres + FastAPI + Nginx stack on :8080
docker compose -f docker-compose.local.yml up -d --build

# 2. Run frontend dev server (or deploy ./frontend to Vercel)
cd frontend && npm install && npm run dev

# 3. Run 1,000-user concurrent WebSocket & burst order benchmark
cd backend && GENESIS_HTTP_URL=http://127.0.0.1:8080 GENESIS_WS_URL=ws://127.0.0.1:8080/ws/market .venv/bin/python tests/stress_1000_users.py
```

## Production EC2 Deployment
```bash
chmod +x scripts/setup_ec2.sh
./scripts/setup_ec2.sh api.yourdomain.com
```

