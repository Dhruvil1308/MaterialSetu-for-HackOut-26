"""Removes application tables accidentally created in the published schema.

A managed PostgreSQL host may expose the `public` schema through its own HTTP
API - on Supabase that hands the browser-side anonymous key full access to
anything there. The application therefore keeps its tables in a private schema
(DB_SCHEMA, `app` in the deployment). Any tool run without DB_SCHEMA set will
not find them, and SQLAlchemy's create_all() will helpfully build a second,
empty set in `public` instead. Those are what this removes.

It refuses to drop a table holding rows, so it can never take real data with it.

    DATABASE_URL=... python scripts/drop_public_tables.py --dry-run
    DATABASE_URL=... python scripts/drop_public_tables.py
"""

import argparse
import os
import sys

from sqlalchemy import create_engine, text

URL = os.environ.get("DATABASE_URL", "")
if not URL:
    sys.exit("Set DATABASE_URL to the database to inspect.")
if URL.startswith("postgresql://"):
    URL = URL.replace("postgresql://", "postgresql+psycopg://", 1)
elif URL.startswith("postgres://"):
    URL = URL.replace("postgres://", "postgresql+psycopg://", 1)

# Children first, so a drop is never blocked by a dependant.
TABLES = [
    "reviews",
    "exchange_items",
    "exchanges",
    "evidence",
    "listings",
    "sessions",
    "businesses",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report, change nothing")
    args = ap.parse_args()

    connect = {"prepare_threshold": None} if ":6543" in URL else {}
    engine = create_engine(URL, connect_args=connect, pool_pre_ping=True)

    with engine.begin() as db:
        present = [
            t
            for t in TABLES
            if db.execute(
                text(
                    "SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=:t"
                ),
                {"t": t},
            ).first()
        ]
        if not present:
            print("Nothing of ours in the public schema. Good.")
            return

        for t in present:
            n = db.execute(text(f'SELECT count(*) FROM public."{t}"')).scalar_one()
            if n:
                sys.exit(
                    f"public.{t} holds {n} rows, so it is not a stray copy.\n"
                    f"Nothing was dropped. Work out where your data lives first."
                )
            print(f"  public.{t:16} empty")

        if args.dry_run:
            print(f"\nDry run. {len(present)} empty table(s) would be dropped.")
            return

        for t in present:
            db.execute(text(f'DROP TABLE public."{t}"'))
        print(f"\nDropped {len(present)} empty table(s) from the public schema.")


if __name__ == "__main__":
    main()
