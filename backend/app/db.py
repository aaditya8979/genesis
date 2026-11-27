from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.config import get_settings

settings = get_settings()

raw_db_url = settings.DATABASE_URL.strip()
if raw_db_url.startswith("postgres://"):
    raw_db_url = "postgresql+asyncpg://" + raw_db_url[len("postgres://"):]
elif raw_db_url.startswith("postgresql://"):
    raw_db_url = "postgresql+asyncpg://" + raw_db_url[len("postgresql://"):]

is_sqlite = raw_db_url.startswith("sqlite")

engine_kwargs: dict = {
    "echo": False,
    "future": True,
}

if is_sqlite:
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    # Sized for 1,000 concurrent campus users on asyncpg
    engine_kwargs["pool_size"] = 30
    engine_kwargs["max_overflow"] = 30
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_recycle"] = 1800

engine = create_async_engine(raw_db_url, **engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session

