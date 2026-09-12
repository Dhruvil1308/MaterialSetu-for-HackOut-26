"""Promote an existing registered account. Run only as the database operator."""

import argparse
from sqlalchemy import select
from models import Base, engine, Session, Business

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("email", help="Existing registered email address")
args = parser.parse_args()
Base.metadata.create_all(engine)
with Session() as db:
    business = db.scalar(
        select(Business).where(Business.email == args.email.strip().lower())
    )
    if not business:
        parser.error("Register this business through the application first.")
    business.role = "admin"
    db.commit()
    print("Reviewer access assigned to", business.email)
