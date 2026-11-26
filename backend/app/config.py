from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ENVIRONMENT: str = "production"
    DATABASE_URL: str = "sqlite+aiosqlite:///./genesis_local.db"
    SECRET_KEY: str = "genesis_jwt_secret_key_2026_vitb_change_in_prod"
    ADMIN_SECRET_KEY: str = "genesis_admin_master_2026"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # Market Mechanics & Risk Guardrails
    STARTING_CASH: float = 25000.00
    PRICE_FLOOR: float = 10.00
    MAX_CONCENTRATION_PCT: float = 0.35
    MAX_SHARES_PER_STOCK: int = 40
    SHORT_COLLATERAL_RATIO: float = 1.00
    SHORT_SQUEEZE_THRESHOLD: float = 1.80  # +80% forced cover

    # Real-Time Tick & Snapshot Intervals
    TICK_INTERVAL_SECONDS: float = 1.0
    JITTER_INTERVAL_SECONDS: float = 2.0
    SNAPSHOT_INTERVAL_SECONDS: float = 5.0
    BACKUP_DIR: str = "./backups"
    AUTO_RESTORE_ON_BOOT: bool = True
    STANDBY_SYNC_URL: str = ""
    PRIMARY_SYNC_URL: str = ""
    STANDBY_SYNC_SECRET: str = "genesis_standby_sync_2026"

    # Tier-3 Off-Site Supabase Cloud Vault (zero-latency async mirror)
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""
    SUPABASE_DB_URL: str = ""
    SUPABASE_SNAPSHOT_TABLE: str = "genesis_snapshots"

    # Per-user rate limit (never by IP due to auditorium NAT)
    ORDER_RATE_LIMIT_WINDOW_SEC: float = 2.0
    ORDER_RATE_LIMIT_MAX_ORDERS: int = 5

    CORS_ORIGINS: str = "*"

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()

