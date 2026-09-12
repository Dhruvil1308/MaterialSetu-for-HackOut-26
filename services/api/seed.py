"""Explicitly fictional development fixtures. Called only with DEMO_MODE=1."""

import time
from PIL import Image, ImageDraw
from sqlalchemy import select
from models import Session, Business, Listing, Evidence, Exchange, ExchangeItem, Review


LOTS = [
    (
        "l1",
        "s1",
        "Sorted PET bottle flakes",
        "pet",
        30,
        24,
        "clean_sorted",
        "recycle",
    ),
    (
        "l2",
        "s2",
        "Clean PET packaging offcuts",
        "pet",
        25,
        22,
        "clean_sorted",
        "recycle",
    ),
    (
        "l3",
        "s3",
        "PET production surplus",
        "pet",
        18,
        21,
        "clean_sorted",
        "recycle",
    ),
    (
        "l4",
        "s1",
        "Rigid HDPE packaging",
        "hdpe",
        70,
        32,
        "clean_sorted",
        "recycle",
    ),
    (
        "l5",
        "s2",
        "Dry corrugated cardboard",
        "cardboard",
        140,
        9,
        "clean_sorted",
        "recycle",
    ),
    (
        "l6",
        "s3",
        "Reusable wooden pallets",
        "pallet",
        12,
        260,
        "used_sorted",
        "reuse",
    ),
    (
        "l7",
        "s4",
        "PET baled packaging",
        "pet",
        120,
        18,
        "clean_sorted",
        "recycle",
    ),
    (
        "l8",
        "s2",
        "LDPE stretch film surplus",
        "ldpe",
        45,
        20,
        "clean_sorted",
        "recycle",
    ),
]


def demo_files(folder):
    """(Re)create the sample evidence images.

    Safe to call repeatedly, and called before the early return below: a host with
    an ephemeral filesystem loses these files on every restart while the database
    rows that point at them survive, which would leave the demo listings showing
    broken evidence.
    """
    folder.mkdir(parents=True, exist_ok=True)
    for lid, *_ in LOTS[:5]:
        for kind in ["photo", "weighing_slip"]:
            path = folder / f"{lid}-{kind}.png"
            if path.exists():
                continue
            im = Image.new("RGB", (900, 550), "#e9f0eb")
            draw = ImageDraw.Draw(im)
            draw.text(
                (60, 60),
                "MATERIALSETU / DEMONSTRATION ONLY",
                fill="black",
                font_size=28,
            )
            draw.text(
                (60, 170),
                "SAMPLE " + kind.upper().replace("_", " "),
                fill="black",
                font_size=36,
            )
            draw.text(
                (60, 285),
                "Not a real material photograph or weighing record.",
                fill="black",
                font_size=23,
            )
            im.save(path)


def seed(folder):
    from main import hash_password

    demo_files(folder)
    with Session() as db:
        if db.get(Business, "buyer"):
            return
        accounts = [
            ("buyer", "Setu Packaging Studio", "Mehsana", 23.588, 72.369, "member"),
            ("s1", "North Gujarat Polymers", "Mehsana", 23.603, 72.378, "member"),
            ("s2", "Umiya Packaging Works", "Mehsana", 23.565, 72.388, "member"),
            ("s3", "Sahyog Distribution", "Visnagar", 23.703, 72.525, "member"),
            ("s4", "Metro Recyclers", "Ahmedabad", 23.022, 72.571, "member"),
            ("admin", "MaterialSetu Reviewer", "Mehsana", 23.588, 72.369, "admin"),
        ]
        for bid, name, city, lat, lon, role in accounts:
            db.add(
                Business(
                    id=bid,
                    name=name,
                    email=bid + "@demo.materialsetu.local",
                    password_hash=hash_password("demo-account-no-password-login"),
                    role=role,
                    city=city,
                    latitude=lat,
                    longitude=lon,
                    gstin="",
                    gst_status="reviewed" if bid in ["s1", "s2"] else "not_provided",
                    gst_reference=(
                        "SIMULATED REVIEW - demonstration only"
                        if bid in ["s1", "s2"]
                        else ""
                    ),
                    is_demo=True,
                )
            )
        db.flush()
        for lid, sid, title, mid, qty, price, grade, intent in LOTS:
            db.add(
                Listing(
                    id=lid,
                    seller_id=sid,
                    title=title,
                    material_id=mid,
                    grade=grade,
                    intent=intent,
                    quantity=qty,
                    available=qty,
                    price=price,
                    unit="piece" if mid == "pallet" else "kg",
                    description="Fictional demo listing. Material condition and potential uses must be checked before a real exchange.",
                    dimensions="1200 × 1000 mm" if mid == "pallet" else "",
                    created=time.time(),
                )
            )
        db.flush()
        for lid, sid, *_ in LOTS[:5]:
            for kind in ["photo", "weighing_slip"]:
                eid = lid + "-" + kind
                fn = eid + ".png"      # written by demo_files() above
                db.add(
                    Evidence(
                        id=eid,
                        business_id=sid,
                        listing_id=lid,
                        kind=kind,
                        filename=fn,
                        mime="image/png",
                        status="approved",
                        reference="SIMULATED EVIDENCE - demo fixture",
                        reviewed_at=time.time(),
                    )
                )
        for sid, count in [("s1", 8), ("s2", 4), ("s3", 1)]:
            for n in range(count):
                eid = f"history-{sid}-{n}"
                lid = {"s1": "l1", "s2": "l2", "s3": "l3"}[sid]
                db.add(
                    Exchange(
                        id=eid,
                        buyer_id="buyer",
                        idempotency_key=eid,
                        created=time.time() - 86400 * (n + 1),
                        pickup="Simulated historical handover",
                        pooled=False,
                    )
                )
                db.flush()
                db.add(
                    ExchangeItem(
                        id=eid,
                        exchange_id=eid,
                        listing_id=lid,
                        seller_id=sid,
                        quantity=10,
                        unit_price=20,
                        status="completed",
                        seller_confirmed=True,
                        buyer_confirmed=True,
                        actual=10,
                    )
                )
                db.flush()
                if n < 5:
                    db.add(
                        Review(
                            id=eid,
                            item_id=eid,
                            buyer_id="buyer",
                            seller_id=sid,
                            rating=5 if n % 3 else 4,
                            comment="Sample review for demonstration; not real buyer feedback.",
                            created=time.time() - 86400 * n,
                        )
                    )
        db.commit()
