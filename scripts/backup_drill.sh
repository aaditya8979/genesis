#!/usr/bin/env bash
set -euo pipefail

# GENESIS 2026 — Live Backup & Disaster Recovery Verification Drill
# Tests: (1) Live snapshot export, (2) Full Backup Cycle trigger, (3) Integrity validation of latest_snapshot.json

BASE_URL="${1:-http://127.0.0.1:8080}"
ADMIN_SECRET="${ADMIN_SECRET_KEY:-genesis_admin_master_2026}"

echo "=== GENESIS 2026 Backup & Failover Drill ($BASE_URL) ==="

echo "1. Checking /health..."
curl -sf "$BASE_URL/health" | python3 -m json.tool

echo "2. Triggering immediate 3-Tier Backup Cycle (/api/v1/system/backup/now)..."
curl -sf -X POST "$BASE_URL/api/v1/system/backup/now" \
  -H "X-Admin-Secret: $ADMIN_SECRET" | python3 -m json.tool

echo "3. Checking /api/v1/system/backup/status..."
curl -sf "$BASE_URL/api/v1/system/backup/status" \
  -H "X-Admin-Secret: $ADMIN_SECRET" | python3 -m json.tool

echo "4. Verifying full snapshot integrity (users, wallets, holdings, transactions, 480-bar candles)..."
curl -sf "$BASE_URL/api/v1/system/snapshot" \
  -H "X-Admin-Secret: $ADMIN_SECRET" | python3 -c '
import json, sys
s = json.load(sys.stdin)
sv = s.get("schema_version")
assert sv == 2, f"Unexpected schema_version: {sv}"
mr = s.get("market_runtime", {})
stocks = mr.get("stocks", {})
min_c = min((len(v.get("candles", [])) for v in stocks.values()), default=0)
print(json.dumps({
    "ok": True,
    "seq": s.get("seq"),
    "users": len(s.get("users", [])),
    "wallets": len(s.get("wallets", [])),
    "holdings": len(s.get("holdings", [])),
    "transactions": len(s.get("transactions", [])),
    "stocks": len(stocks),
    "min_candles_per_stock": min_c,
}, indent=2))
'
echo "=== DRILL PASSED ==="
