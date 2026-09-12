import os
import re
from sqlalchemy import (
    MetaData,
    create_engine,
    text,
    String,
    Float,
    Integer,
    Boolean,
    Text,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

URL = os.getenv("DATABASE_URL", "sqlite:///./materialsetu.db")
SQLITE = URL.startswith("sqlite")

# A managed PostgreSQL host may publish the `public` schema through its own HTTP
# API. On Supabase that grants the browser-side anonymous role full access to
# every table created there, so application tables belong in a private schema
# instead. Empty means the connection default, which is what SQLite wants.
SCHEMA = os.getenv("DB_SCHEMA", "").strip()
if SCHEMA and not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", SCHEMA):
    raise RuntimeError("DB_SCHEMA must be a lowercase identifier, for example app.")
if SCHEMA and SQLITE:
    raise RuntimeError("DB_SCHEMA needs PostgreSQL. Leave it unset for SQLite.")

# A transaction-mode pooler hands a different server connection to each
# transaction, so client-side prepared statements cannot be reused. Keep our own
# connection pool regardless: a fresh TLS handshake to a distant database costs
# far more than every query in the request put together.
POOLED = ":6543" in URL
CONNECT_ARGS = {"check_same_thread": False, "timeout": 20} if SQLITE else {}
if POOLED and "psycopg" in URL:
    CONNECT_ARGS["prepare_threshold"] = None

engine = create_engine(
    URL,
    connect_args=CONNECT_ARGS,
    pool_pre_ping=True,
    **(
        {}
        if SQLITE
        else {"pool_size": 5, "max_overflow": 5, "pool_recycle": 900, "pool_timeout": 30}
    ),
)
Session = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA or None)


def ensure_schema():
    """Create the private schema and keep the host's public API roles out of it."""
    if not SCHEMA:
        return
    with engine.begin() as c:
        c.execute(text(f'create schema if not exists "{SCHEMA}"'))
        exposed = (
            c.execute(
                text(
                    "select rolname from pg_roles "
                    "where rolname in ('anon', 'authenticated')"
                )
            )
            .scalars()
            .all()
        )
        for role in exposed:
            c.execute(text(f'revoke all on schema "{SCHEMA}" from "{role}"'))
            c.execute(
                text(
                    f'alter default privileges in schema "{SCHEMA}" '
                    f'revoke all on tables from "{role}"'
                )
            )


class Business(Base):
    __tablename__ = "businesses"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String, unique=True)
    password_hash: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String, default="member")
    city: Mapped[str] = mapped_column(String)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    gstin: Mapped[str] = mapped_column(String, default="")
    gst_status: Mapped[str] = mapped_column(String, default="not_provided")
    gst_reference: Mapped[str] = mapped_column(String, default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class LoginSession(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String, primary_key=True)
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    expires: Mapped[float] = mapped_column(Float)


class Listing(Base):
    __tablename__ = "listings"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    seller_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    title: Mapped[str] = mapped_column(String)
    material_id: Mapped[str] = mapped_column(String)
    grade: Mapped[str] = mapped_column(String)
    intent: Mapped[str] = mapped_column(String)
    quantity: Mapped[float] = mapped_column(Float)
    available: Mapped[float] = mapped_column(Float)
    price: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text, default="")
    dimensions: Mapped[str] = mapped_column(String, default="")
    created: Mapped[float] = mapped_column(Float)


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    listing_id: Mapped[str | None] = mapped_column(
        ForeignKey("listings.id"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)
    mime: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending")
    reference: Mapped[str] = mapped_column(String, default="")
    reviewed_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class Exchange(Base):
    __tablename__ = "exchanges"
    __table_args__ = (UniqueConstraint("buyer_id", "idempotency_key"),)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    buyer_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    idempotency_key: Mapped[str] = mapped_column(String)
    created: Mapped[float] = mapped_column(Float)
    pickup: Mapped[str] = mapped_column(String, default="Arrange pickup with supplier")
    pooled: Mapped[bool] = mapped_column(Boolean, default=False)


class ExchangeItem(Base):
    __tablename__ = "exchange_items"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    exchange_id: Mapped[str] = mapped_column(ForeignKey("exchanges.id"))
    listing_id: Mapped[str] = mapped_column(ForeignKey("listings.id"))
    seller_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    quantity: Mapped[float] = mapped_column(Float)
    unit_price: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String, default="pending")
    seller_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    buyer_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    actual: Mapped[float | None] = mapped_column(Float, nullable=True)


class Review(Base):
    __tablename__ = "reviews"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("exchange_items.id"), unique=True)
    buyer_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    seller_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str] = mapped_column(String)
    created: Mapped[float] = mapped_column(Float)
