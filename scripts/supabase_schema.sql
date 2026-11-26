-- GENESIS 2026 — Optional Tier-3 Off-Site Cloud Backup Table for Supabase
-- Note: If you set SUPABASE_DB_URL in .env, the backend creates this table automatically!
-- Run this SQL in Supabase SQL Editor ONLY if you prefer HTTPS REST mode (SUPABASE_URL + SUPABASE_SERVICE_KEY).

CREATE TABLE IF NOT EXISTS public.genesis_snapshots (
    id TEXT PRIMARY KEY,
    seq BIGINT NOT NULL DEFAULT 0,
    era_id TEXT NOT NULL DEFAULT 'BASE',
    user_count INTEGER NOT NULL DEFAULT 0,
    exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_genesis_snapshots_seq ON public.genesis_snapshots (seq DESC);

-- Lock down Row Level Security: only Supabase service_role (backend EC2/standby) can read or write snapshots.
ALTER TABLE public.genesis_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.genesis_snapshots FROM anon, authenticated;

