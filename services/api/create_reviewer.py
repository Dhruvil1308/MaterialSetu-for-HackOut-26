"""Promote an existing registered account. Run only as the database operator.

    DATABASE_URL=... DB_SCHEMA=app python create_reviewer.py someone@example.com

DB_SCHEMA has to match the running service, or this looks in the wrong place.
"""

import argparse
import os
import sys
from sqlalchemy import select, inspect
from models import SCHEMA, engine, Session, Business

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("email", help="Existing registered email address")
args = parser.parse_args()

# Deliberately no create_all() here. Against a live database with DB_SCHEMA
# forgotten it would not find the tables - it would quietly build a second,
# empty set in the default schema, which on a managed host is the one published
# to the public API. Say so instead.
if not inspect(engine).has_table(Business.__tablename__, schema=SCHEMA or None):
    where = f"schema {SCHEMA!r}" if SCHEMA else "the default schema"
    sys.exit(
        f"No businesses table in {where}.\n"
        f"Set DB_SCHEMA to the one the service uses (the deployment uses 'app')."
    )

with Session() as db:
    business = db.scalar(
        select(Business).where(Business.email == args.email.strip().lower())
    )
    if not business:
        parser.error("Register this business through the application first.")
    business.role = "admin"
    db.commit()
    print("Reviewer access assigned to", business.email)
