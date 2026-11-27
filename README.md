# GENESIS 2026 — Supercharts Virtual Trading Terminal & Exchange Engine

High-throughput, sub-15ms virtual stock exchange engineered for **1,000+ concurrent traders** behind campus Fortinet DPI firewalls.

## Architecture Highlights
- **3-Container Production Stack (`docker-compose.yml`):** Isolated `postgres:15-alpine`, `backend` (FastAPI + single `uvloop` worker sharing one authoritative RAM price engine), and multi-stage `nginx` (`nginx/Dockerfile`, Vite SPA + REST/WSS reverse proxy on Port 80/443 with `worker_rlimit_nofile 65535`).
- **Campus NAT & Firewall Survival:** Zero IP rate-limiting in Nginx (rate limiting is keyed strictly per `user_id` JWT inside FastAPI); 15s WebSocket heartbeat + automatic downgrade to 1s HTTPS Polling if WSS is blocked.
- **TradingView Supercharts UI:** `lightweight-charts` canvas rendering at 60 FPS decoupled via `zustand`, **IBM Plex Sans** + **IBM Plex Mono** (`tabular-nums`), neutral Obsidian Dark (`#0F0F0F`) & TradingView White (`#FFFFFF`) themes, OHLCV HUD, floating `SELL`/`BUY` quote boxes, left drawing rail, right watchlist/inspector dock, and `%`/`log`/`auto` price scales.
- **Real vs Dummy Cohort Isolation & Official Tallying:** Real students (`cohort = 'REAL'`) are isolated from the 150 autonomous simulated traders (`cohort = 'DUMMY'`) via `GET /api/v1/admin/tally`, bulk real-participant CSV import (`POST /api/v1/admin/users/import-real`), and formula-safe CSV tally export in `/admin`.
- **3-Tier Failover & Backup:** Atomic PostgreSQL row locking (`SELECT ... FOR UPDATE`), idempotent `client_order_id`, local disk vault (`backups/latest_snapshot.json`), Warm Standby push (`STANDBY_SYNC_URL`), Supabase backup mirror (`scripts/supabase_schema.sql`), and optional EC2-to-S3 snapshot cron (`aws/iam-ec2-s3-backup-policy.json`).

## Quick Start (Local Development)
```bash
# 1. Start 3-container Postgres + FastAPI + Nginx stack on :8080
docker compose -f docker-compose.local.yml up -d --build

# 2. Run frontend dev server
cd frontend && npm install && npm run dev

# 3. Run backend unit/integration suite
cd backend && .venv/bin/pytest -v

# 4. Run 1,000-user concurrent WebSocket & burst order benchmark
cd backend && GENESIS_HTTP_URL=http://127.0.0.1:8080 GENESIS_WS_URL=ws://127.0.0.1:8080/ws/market .venv/bin/python tests/stress_1000_users.py
```

## Production AWS EC2 Deployment
```bash
chmod +x scripts/setup_ec2.sh
# Domain with Let's Encrypt Port 443 HTTPS/WSS:
./scripts/setup_ec2.sh api.yourdomain.com
# Or HTTP-80 mode behind AWS ALB / CloudFront TLS:
./scripts/setup_ec2.sh --http
```

Least-privilege AWS IAM policy templates are included under `aws/iam-deployer-policy.json` and `aws/iam-ec2-s3-backup-policy.json`.
