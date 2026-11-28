# GENESIS 2026 — Institutional Trading Engine & War Room

High-throughput virtual stock exchange engineered for **1,000+ concurrent traders** behind campus Fortinet DPI firewalls.

## Architecture Highlights
- **Single-Origin 3-Container Stack (`docker-compose.yml`):** Isolated `postgres:15-alpine`, `backend` (FastAPI + single `uvloop` worker sharing authoritative RAM state & Log-OU microstructure), and `nginx` (serves compiled Vite React Supercharts SPA + terminates Port 443 TLS/WSS + 32 MB upload limit).
- **Campus NAT & Firewall Survival:** Zero IP rate-limiting in Nginx (rate limiting is keyed per `user_id` JWT inside FastAPI); 15s WebSocket heartbeat (`ws_manager` slow-consumer 0.25s isolation) + automatic fallback to 1s HTTPS polling and multi-gateway failover.
- **Configurable 3-Tier Backup & Disaster Recovery (`5s` Cadence):**
  - **Tier 1 (Local Disk Vault):** Atomic `./backups/latest_snapshot.json` + 30 rolling checkpoints (`users`, `wallets`, `holdings`, up to `10,000` `transactions`, `480`-bar candles), auto-recovered on container boot.
  - **Tier 2 (Warm Standby Mirror):** Bidirectional `STANDBY_SYNC_URL` (push) / `PRIMARY_SYNC_URL` (NAT-safe pull) + `./scripts/run_standby.sh` Cloudflare Tunnel mirror.
  - **Tier 3 (Off-Site Cloud Vault):** Zero-latency async Supabase mirror (`SUPABASE_DB_URL` auto-schema OR HTTPS REST `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` using `scripts/supabase_schema.sql`) + optional Free-Tier S3 cron sync (`S3_BACKUP_BUCKET`).
  - **Admin Command Vault:** One-click `Backup Now`, `Download .json`, `Restore .json`, `Pull from Supabase`, `Reset Base`, and isolated `REAL` vs `DUMMY` (`150` active bot) cohorts + formula-safe CSV tally export.

## Production AWS EC2 Deployment (Free-Tier / Low-Cost Single Instance)
1. Provision a `t3.small` or `t4g.small` (Ubuntu 22.04/24.04 or Amazon Linux 2023, `20 GB gp3` EBS, `IMDSv2` + `HttpPutResponseHopLimit=2`), open Inbound TCP `80`, `443`, `22` in Security Group.
2. Least-privilege IAM templates are provided in [`aws/`](aws/): `iam-deployer-policy.json` and `iam-ec2-s3-backup-policy.json`.
3. Configure `.env` from `.env.example` (set `ADMIN_SECRET_KEY`, optional `SUPABASE_DB_URL`/`SUPABASE_URL`, optional `S3_BACKUP_BUCKET`, optional `VITE_FALLBACK_URLS`), then run:
```bash
chmod +x scripts/setup_ec2.sh scripts/run_standby.sh scripts/backup_drill.sh

# Option A: Custom domain with automatic Let's Encrypt Port 443 HTTPS/WSS
./scripts/setup_ec2.sh api.yourdomain.com

# Option B: Port 80 HTTP mode (behind AWS ALB/CloudFront TLS or direct EC2 IP testing)
./scripts/setup_ec2.sh --http
```

## Local Verification & Warm-Standby Failover
```bash
# Option 1 (Recommended): Start full local stack (Postgres + Backend + Vite/Nginx on http://localhost:8080)
./scripts/run_standby.sh

# Option 2 (Direct Dev without Docker): Run Backend on :8000 + Vite on :5173
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/uvicorn app.main:app --port 8000
cd frontend && npm install && npm run dev

# Verify full v2 snapshot & backup health against running stack
./scripts/backup_drill.sh http://127.0.0.1:8080

# Run backend unit, concurrency, 15,000-tick Log-OU stability & snapshot restore tests
cd backend && .venv/bin/pytest -v tests/test_trading_engine.py
```
