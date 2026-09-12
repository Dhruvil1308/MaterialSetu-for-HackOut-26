"""Brings a live database to a real, non-fictional state.

Two jobs, both safe to repeat:

  1. Adds columns the ORM has grown since the database was created.
     SQLAlchemy's create_all() only ever creates missing *tables* - it will
     never ALTER an existing one, so a new column has to be added by hand or
     every query against that table fails.

  2. Deletes the seeded demo businesses and everything hanging off them:
     their listings, evidence, exchanges and reviews. Real accounts are left
     alone. Nothing here touches a row whose business is not is_demo.

    python scripts/clean_demo.py --dry-run     # count, change nothing
    python scripts/clean_demo.py               # do it

Point DATABASE_URL at the database you mean. There is no undo.
"""

import argparse
import os
import sys

from sqlalchemy import create_engine, text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "api"))

URL = os.environ.get("DATABASE_URL", "")
if not URL:
    sys.exit("Set DATABASE_URL to the database you want to clean.")
# psycopg3 is what the API ships; a plain postgresql:// URL would look for the
# long-retired psycopg2 instead.
if URL.startswith("postgresql://"):
    URL = URL.replace("postgresql://", "postgresql+psycopg://", 1)
elif URL.startswith("postgres://"):
    URL = URL.replace("postgres://", "postgresql+psycopg://", 1)
SCHEMA = os.environ.get("DB_SCHEMA", "app")

# Columns the model has that an older database may not. Adding a column with a
# default is instant in Postgres 11+, so this is safe on a live table.
COLUMNS = [
    ("businesses", "kind", "varchar NOT NULL DEFAULT 'both'"),
]

# Child rows point at a business through different names; delete depth-first so
# nothing is ever orphaned, even on a database without foreign keys.
CASCADE = [
    ("reviews", ["buyer_id", "seller_id"]),
    ("exchange_items", ["seller_id"]),
    ("exchanges", ["buyer_id"]),
    ("evidence", ["business_id"]),
    ("listings", ["seller_id"]),
    ("sessions", ["business_id"]),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="count, change nothing")
    ap.add_argument(
        "--keep-reviewer",
        action="store_true",
        help="leave the demo reviewer account in place so GST review still works",
    )
    args = ap.parse_args()

    connect = {"prepare_threshold": None} if ":6543" in URL else {}
    engine = create_engine(URL, connect_args=connect, pool_pre_ping=True)
    q = lambda name: f'"{SCHEMA}"."{name}"'

    with engine.begin() as db:
        for table, column, spec in COLUMNS:
            db.execute(
                text(f"ALTER TABLE {q(table)} ADD COLUMN IF NOT EXISTS {column} {spec}")
            )
            print(f"  column {table}.{column} present")

        where = "is_demo = true"
        if args.keep_reviewer:
            where += " AND role <> 'admin'"
        ids = [r[0] for r in db.execute(text(f"SELECT id FROM {q('businesses')} WHERE {where}"))]
        if not ids:
            print("\nNo demo businesses. Nothing to remove.")
            return
        print(f"\n{len(ids)} demo business(es): {', '.join(sorted(ids))}")

        total = 0
        for table, columns in CASCADE:
            clause = " OR ".join(f"{c} = ANY(:ids)" for c in columns)
            n = db.execute(
                text(f"SELECT count(*) FROM {q(table)} WHERE {clause}"), {"ids": ids}
            ).scalar_one()
            total += n
            if n and not args.dry_run:
                db.execute(text(f"DELETE FROM {q(table)} WHERE {clause}"), {"ids": ids})
            print(f"  {table:16} {n}")

        n = len(ids)
        if not args.dry_run:
            db.execute(text(f"DELETE FROM {q('businesses')} WHERE id = ANY(:ids)"), {"ids": ids})
        print(f"  {'businesses':16} {n}")

        if args.dry_run:
            db.rollback()
            print(f"\nDry run. {total + n} rows would be removed.")
        else:
            print(f"\nRemoved {total + n} rows. The exchange now holds only real records.")


if __name__ == "__main__":
    main()
