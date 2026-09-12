"""Creates or updates a reviewer account, password included.

Registration through the application deliberately refuses a short password and
anything that is not an email address. This is the operator's way in, so it
allows both - which is exactly why it must be run by hand, against a database
you control, and never wired to a route.

    DATABASE_URL=... DB_SCHEMA=app python set_admin.py admin admin
    DATABASE_URL=... DB_SCHEMA=app python set_admin.py admin --password-from-stdin

It prints a warning for a password anyone would guess, because on a site that
is actually reachable, the reviewer account can read every business's documents
and change every verification.
"""

import argparse
import getpass
import sys

from sqlalchemy import inspect, select

from main import hash_password, uid
from models import SCHEMA, Business, Session, engine

OBVIOUS = {"admin", "password", "123456", "admin123", "root", "test", "changeme"}

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("email", help="Sign-in name. Need not be a real address.")
parser.add_argument("password", nargs="?", help="Omit to be prompted without echo.")
parser.add_argument("--name", default="MaterialSetu Reviewer", help="Business name")
parser.add_argument("--city", default="Mehsana")
parser.add_argument("--latitude", type=float, default=23.588)
parser.add_argument("--longitude", type=float, default=72.369)
args = parser.parse_args()

if not inspect(engine).has_table("businesses", schema=SCHEMA or None):
    where = f"schema {SCHEMA!r}" if SCHEMA else "the default schema"
    sys.exit(
        f"No businesses table in {where}.\n"
        f"Set DB_SCHEMA to the one the service uses (the deployment uses 'app')."
    )

password = args.password or getpass.getpass("Password: ")
if not password:
    sys.exit("A password is required.")

email = args.email.strip().lower()
with Session() as db:
    b = db.scalar(select(Business).where(Business.email == email))
    verb = "Updated" if b else "Created"
    if not b:
        b = Business(
            id=uid(),
            email=email,
            name=args.name,
            city=args.city,
            latitude=args.latitude,
            longitude=args.longitude,
            gstin="",
            gst_status="not_provided",
            gst_reference="",
        )
        db.add(b)
    b.password_hash = hash_password(password)
    b.role = "admin"
    # A reviewer checks evidence; it does not trade, and should not appear in
    # anyone's search results as though it did.
    b.kind = "both"
    b.is_demo = False
    db.commit()
    print(f"{verb} reviewer account: {b.email}")

if password.lower() in OBVIOUS or len(password) < 10:
    print(
        "\nWARNING: that password is guessable. Anyone who finds this site can\n"
        "sign in as the reviewer and read every business's documents, approve\n"
        "GST numbers, and settle disputes. Change it before judging or launch:\n"
        f"    python set_admin.py {email}      # prompts, with no echo",
        file=sys.stderr,
    )
