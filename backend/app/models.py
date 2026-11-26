import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    registration_no: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False, default="")
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="PARTICIPANT")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="APPROVED")
    is_frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    wallet: Mapped["Wallet"] = relationship("Wallet", back_populates="user", uselist=False, cascade="all, delete-orphan")
    holdings: Mapped[list["Holding"]] = relationship("Holding", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("role IN ('ADMIN', 'PARTICIPANT')", name="chk_user_role"),
        CheckConstraint("status IN ('PENDING', 'APPROVED', 'REJECTED')", name="chk_user_status"),
    )


class Wallet(Base):
    __tablename__ = "wallets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    cash_balance: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=Decimal("25000.00"))
    collateral_locked: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=Decimal("0.00"))
    total_credited: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=Decimal("25000.00"))
    topup_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user: Mapped["User"] = relationship("User", back_populates="wallet")

    __table_args__ = (
        CheckConstraint("cash_balance >= 0.00", name="chk_cash_non_negative"),
        CheckConstraint("collateral_locked >= 0.00", name="chk_collateral_non_negative"),
    )


class Stock(Base):
    __tablename__ = "stocks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    symbol: Mapped[str] = mapped_column(String(10), unique=True, nullable=False, index=True)
    company_name: Mapped[str] = mapped_column(String(150), nullable=False)
    sector: Mapped[str] = mapped_column(String(50), nullable=False)
    current_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    anchor_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    pe_ratio: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    max_shares_per_user: Mapped[int] = mapped_column(Integer, nullable=False, default=40)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (
        CheckConstraint("current_price >= 10.00", name="chk_stock_price_floor"),
        CheckConstraint("anchor_price >= 10.00", name="chk_stock_anchor_floor"),
    )


class Holding(Base):
    __tablename__ = "holdings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    stock_id: Mapped[str] = mapped_column(String(36), ForeignKey("stocks.id", ondelete="RESTRICT"), nullable=False)
    symbol: Mapped[str] = mapped_column(String(10), nullable=False)
    position_type: Mapped[str] = mapped_column(String(10), nullable=False)  # LONG | SHORT
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    avg_entry_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="holdings")

    __table_args__ = (
        UniqueConstraint("user_id", "stock_id", "position_type", name="uq_user_stock_position"),
        CheckConstraint("position_type IN ('LONG', 'SHORT')", name="chk_position_type"),
        CheckConstraint("quantity > 0", name="chk_holding_qty_positive"),
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    client_order_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    stock_id: Mapped[str] = mapped_column(String(36), ForeignKey("stocks.id", ondelete="RESTRICT"), nullable=False)
    symbol: Mapped[str] = mapped_column(String(10), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)  # BUY | SELL | SHORT | COVER | LIQUIDATE
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    execution_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    realized_pnl: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=Decimal("0.00"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        CheckConstraint("action IN ('BUY', 'SELL', 'SHORT', 'COVER', 'LIQUIDATE')", name="chk_tx_action"),
        CheckConstraint("quantity > 0", name="chk_tx_qty_positive"),
    )


class MarketSettings(Base):
    __tablename__ = "market_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    is_market_open: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_leaderboard_frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ticks_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    max_concentration_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("35.00"))
    active_era_id: Mapped[str] = mapped_column(String(50), nullable=False, default="BASE")
    active_scenario_name: Mapped[str] = mapped_column(String(150), nullable=False, default="Normal Trading — Round 0 Base")
    active_headline: Mapped[str] = mapped_column(Text, nullable=False, default="GENESIS 2026 Market Floor Open — ₹25,000 Virtual Capital Credited")


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    details: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
