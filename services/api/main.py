import os, time, uuid, hashlib, secrets, re, io
from pathlib import Path
from typing import Literal
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update, func
from sqlalchemy.exc import IntegrityError
from PIL import Image
from models import (
    Base,
    engine,
    ensure_schema,
    Session,
    Business,
    LoginSession,
    Listing,
    Evidence,
    Exchange,
    ExchangeItem,
    Review,
)
from domain import TAXONOMY, material, parse_query, haversine, pool_options

DEMO = os.getenv("DEMO_MODE", "0") == "1"
UPLOADS = Path(os.getenv("UPLOAD_DIR", "./uploads"))
UPLOADS.mkdir(parents=True, exist_ok=True)


def uid():
    return uuid.uuid4().hex


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    return (
        salt
        + ":"
        + hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 200_000).hex()
    )


def fail(code, text):
    raise HTTPException(code, text)


def db_session():
    with Session() as s:
        yield s


security = HTTPBearer(auto_error=False)


def current(
    auth: HTTPAuthorizationCredentials | None = Depends(security),
    db=Depends(db_session),
):
    if not auth:
        fail(401, "Please sign in.")
    login = db.get(LoginSession, hashlib.sha256(auth.credentials.encode()).hexdigest())
    if not login or login.expires < time.time():
        fail(401, "Your session expired. Please sign in again.")
    return db.get(Business, login.business_id)


def admin(user=Depends(current)):
    if user.role != "admin":
        fail(403, "Reviewer access is required.")
    return user


def public_business(b):
    return {
        k: getattr(b, k)
        for k in [
            "id",
            "name",
            "city",
            "latitude",
            "longitude",
            "gst_status",
            "is_demo",
        ]
    }


def my_business(b):
    return {**public_business(b), "email": b.email, "gstin": b.gstin, "role": b.role}


def create_session(db, b):
    token = secrets.token_urlsafe(40)
    db.add(
        LoginSession(
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            business_id=b.id,
            expires=time.time() + 86400 * 7,
        )
    )
    db.commit()
    return {"token": token, "user": my_business(b)}


def coverage(db, business_ids):
    """Evidence counts for many businesses in four grouped queries.

    Scoring stays in trust(); this only replaces the four per-business lookups it
    used to make, which made every search quadratic in listings.
    """
    ids = list(dict.fromkeys(business_ids))
    if not ids:
        return {}
    listed = dict(
        db.execute(
            select(Listing.seller_id, func.count())
            .where(Listing.seller_id.in_(ids))
            .group_by(Listing.seller_id)
        ).all()
    )
    approved = {
        (bid, kind): n
        for bid, kind, n in db.execute(
            select(
                Evidence.business_id,
                Evidence.kind,
                func.count(func.distinct(Evidence.listing_id)),
            )
            .where(
                Evidence.business_id.in_(ids),
                Evidence.status == "approved",
                Evidence.listing_id.is_not(None),
            )
            .group_by(Evidence.business_id, Evidence.kind)
        ).all()
    }
    handovers = dict(
        db.execute(
            select(ExchangeItem.seller_id, func.count())
            .where(ExchangeItem.seller_id.in_(ids), ExchangeItem.status == "completed")
            .group_by(ExchangeItem.seller_id)
        ).all()
    )
    rated = {
        bid: (total, n)
        for bid, total, n in db.execute(
            select(Review.seller_id, func.sum(Review.rating), func.count())
            .where(Review.seller_id.in_(ids))
            .group_by(Review.seller_id)
        ).all()
    }
    return {
        bid: {
            "listings": listed.get(bid, 0),
            "photos": approved.get((bid, "photo"), 0),
            "slips": approved.get((bid, "weighing_slip"), 0),
            "completed": handovers.get(bid, 0),
            "rating": rated.get(bid, (0, 0)),
        }
        for bid in ids
    }


def trust(db, b, counts=None):
    c = coverage(db, [b.id])[b.id] if counts is None else counts
    listings, photos, slips = c["listings"], c["photos"], c["slips"]
    completed = c["completed"]
    total, n = c["rating"]
    count = max(1, listings)
    average = float(total) / n if n else 0
    parts = [
        {
            "label": "GST review",
            "points": 25 if b.gst_status == "reviewed" else 0,
            "max": 25,
            "detail": (
                "GST details manually reviewed"
                if b.gst_status == "reviewed"
                else "No completed GST review"
            ),
        },
        {
            "label": "Material photos",
            "points": round(15 * min(1, photos / count)),
            "max": 15,
            "detail": f"{photos} of {listings} listings with reviewed photos",
        },
        {
            "label": "Weighing slips",
            "points": round(20 * min(1, slips / count)),
            "max": 20,
            "detail": f"{slips} of {listings} listings with reviewed slips",
        },
        {
            "label": "Completed exchanges",
            "points": round(25 * min(1, completed / 10)),
            "max": 25,
            "detail": f"{completed} confirmed handovers; full points at 10",
        },
        {
            "label": "Buyer reviews",
            "points": round(15 * ((average - 1) / 4) * min(1, n / 5)) if n else 0,
            "max": 15,
            "detail": (
                f"{average:.1f}/5 from {n} completed-exchange reviews"
                if n
                else "No buyer reviews yet"
            ),
        },
    ]
    return {
        "score": sum(p["points"] for p in parts),
        "parts": parts,
        "completed": completed,
        "review_count": n,
        "average_rating": round(average, 1) if n else None,
        "is_demo": b.is_demo,
        "note": "Evidence coverage score, not a guarantee of quality or government certification. New businesses can have limited evidence.",
    }


LISTING_FIELDS = [
    "id",
    "seller_id",
    "title",
    "material_id",
    "grade",
    "intent",
    "quantity",
    "available",
    "price",
    "unit",
    "description",
    "dimensions",
    "created",
]


def listings_json(db, rows, origin=None):
    """Serialise many listings with a fixed number of queries, not one set each."""
    if not rows:
        return []
    seller_ids = list({l.seller_id for l in rows})
    sellers = {
        b.id: b
        for b in db.scalars(select(Business).where(Business.id.in_(seller_ids))).all()
    }
    files = {}
    for e in db.scalars(
        select(Evidence).where(Evidence.listing_id.in_([l.id for l in rows]))
    ).all():
        files.setdefault(e.listing_id, []).append(e)
    counts = coverage(db, seller_ids)
    scores = {bid: trust(db, sellers[bid], counts[bid]) for bid in seller_ids}
    out = []
    for l in rows:
        b = sellers[l.seller_id]
        out.append(
            {
                **{k: getattr(l, k) for k in LISTING_FIELDS},
                "seller": public_business(b),
                "latitude": b.latitude,
                "longitude": b.longitude,
                "distance_km": (
                    round(haversine(origin, (b.latitude, b.longitude)), 2)
                    if origin
                    else None
                ),
                "trust": scores[l.seller_id],
                "material": material(l.material_id),
                "evidence": [
                    {
                        "id": e.id,
                        "kind": e.kind,
                        "status": e.status,
                        "url": f"/api/evidence/{e.id}",
                        "mime": e.mime,
                    }
                    for e in files.get(l.id, [])
                ],
            }
        )
    return out


def listing_json(db, l, origin=None):
    return listings_json(db, [l], origin)[0]


@asynccontextmanager
async def lifespan(app):
    print("CORS allowed origins: " + (", ".join(ORIGINS) or "(none)"), flush=True)
    ensure_schema()
    Base.metadata.create_all(engine)
    if DEMO:
        from seed import seed

        seed(UPLOADS)
    yield


def allowed_origins():
    """Origins permitted to call this API from a browser.

    A browser sends its Origin with no trailing slash, no quotes and no spaces,
    so an entry carrying any of those can never match and the failure looks like
    the API is down rather than misconfigured. Accept the forms a value pasted
    into a hosting dashboard actually takes.
    """
    raw = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8081",
    )
    return [
        cleaned
        for entry in raw.split(",")
        if (cleaned := entry.strip().strip("\"'").rstrip("/"))
    ]


ORIGINS = allowed_origins()
app = FastAPI(title="MaterialSetu API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "demo": DEMO,
        "classification": "rules",
        "gst_verification": "manual_review",
        "pooling": "local_route_estimate",
    }


@app.get("/api/taxonomy")
def taxonomy():
    return TAXONOMY


@app.get("/api/demo/accounts")
def demo_accounts(db=Depends(db_session)):
    if not DEMO:
        fail(404, "Demo mode is disabled.")
    return [
        my_business(b)
        for b in db.scalars(select(Business).where(Business.is_demo == True)).all()
    ]


class DemoLogin(BaseModel):
    business_id: str


@app.post("/api/auth/demo")
def demo_login(data: DemoLogin, db=Depends(db_session)):
    if not DEMO:
        fail(404, "Demo mode is disabled.")
    b = db.get(Business, data.business_id)
    if not b or not b.is_demo:
        fail(404, "Demo account not found.")
    return create_session(db, b)


class Register(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=150)
    password: str = Field(min_length=10, max_length=200)
    city: str = Field(min_length=2, max_length=80)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


@app.post("/api/auth/register")
def register(data: Register, db=Depends(db_session)):
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", data.email):
        fail(422, "Enter a valid email address.")
    b = Business(
        id=uid(),
        name=data.name.strip(),
        email=data.email.lower().strip(),
        password_hash=hash_password(data.password),
        city=data.city,
        latitude=data.latitude,
        longitude=data.longitude,
    )
    db.add(b)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        fail(409, "That email address is already registered.")
    return create_session(db, b)


class Login(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
def login(data: Login, db=Depends(db_session)):
    b = db.scalar(select(Business).where(Business.email == data.email.lower().strip()))
    candidate = hash_password(
        data.password,
        b.password_hash.split(":")[0] if b else "00000000000000000000000000000000",
    )
    if not b or not secrets.compare_digest(candidate, b.password_hash):
        fail(401, "Email or password is incorrect.")
    return create_session(db, b)


@app.get("/api/me")
def me(user=Depends(current)):
    return my_business(user)


@app.post("/api/auth/logout")
def logout(auth=Depends(security), user=Depends(current), db=Depends(db_session)):
    login = db.get(LoginSession, hashlib.sha256(auth.credentials.encode()).hexdigest())
    db.delete(login)
    db.commit()
    return {"ok": True}


class Search(BaseModel):
    query: str = Field(default="", max_length=500)
    material_id: str = ""
    latitude: float = Field(default=23.588, ge=-90, le=90)
    longitude: float = Field(default=72.369, ge=-180, le=180)
    radius_km: float = Field(default=30, gt=0, le=100)
    quantity: float = Field(default=50, ge=0.001, le=1000000, multiple_of=0.001)
    unit: Literal["kg", "piece"] = "kg"
    use: str = ""
    grade: str = ""
    intent: str = ""
    pool: bool = True
    km_rate: float = Field(default=12, ge=0, le=1000)
    stop_fee: float = Field(default=40, ge=0, le=10000)
    max_transport: float | None = Field(default=None, ge=0)
    max_unit_price: float | None = Field(default=None, ge=0)


@app.post("/api/search")
def search(
    data: Search,
    db=Depends(db_session),
    auth: HTTPAuthorizationCredentials | None = Depends(security),
):
    parsed = parse_query(data.query)
    mids = [data.material_id] if data.material_id else parsed["material_ids"]
    if data.query.strip() and not mids:
        return {
            "listings": [],
            "pools": [],
            "parsed": parsed,
            "quantity": data.quantity,
            "unit": data.unit,
            "radius_km": data.radius_km,
            "pool_note": "",
            "clarification": parsed["clarification"],
        }
    quantity = parsed["quantity"] if parsed["quantity"] is not None else data.quantity
    unit = parsed["unit"] or data.unit
    if not (0 < quantity <= 1000000):
        fail(422, "Quantity must be greater than zero and at most 1,000,000.")
    if abs(quantity * 1000 - round(quantity * 1000)) > 0.00001:
        fail(422, "Use quantities with at most three decimal places.")
    if unit == "piece" and quantity != int(quantity):
        fail(422, "Pieces must be whole numbers.")
    radius = (
        min(data.radius_km, parsed["radius_km"])
        if parsed["radius_km"]
        else data.radius_km
    )
    if radius <= 0:
        fail(422, "Radius must be greater than zero.")
    origin = (data.latitude, data.longitude)
    candidates = []
    buyer = None
    if auth:
        login = db.get(
            LoginSession, hashlib.sha256(auth.credentials.encode()).hexdigest()
        )
        if login and login.expires > time.time():
            buyer = login.business_id
    open_listings = db.scalars(select(Listing).where(Listing.available > 0)).all()
    sellers = {
        b.id: b
        for b in db.scalars(
            select(Business).where(
                Business.id.in_({l.seller_id for l in open_listings})
            )
        ).all()
    }
    for l in open_listings:
        if (
            l.seller_id == buyer
            or (mids and l.material_id not in mids)
            or l.unit != unit
        ):
            continue
        if data.grade and l.grade != data.grade:
            continue
        if data.intent and l.intent != data.intent:
            continue
        if data.use and not any(
            data.use.lower() in u.lower() for u in material(l.material_id)["uses"]
        ):
            continue
        b = sellers[l.seller_id]
        if haversine(origin, (b.latitude, b.longitude)) > radius:
            continue
        candidates.append(l)
    rows = listings_json(db, candidates, origin)
    rows.sort(key=lambda r: (r["distance_km"], -r["trust"]["score"]))
    pools = (
        pool_options(
            rows,
            quantity,
            origin,
            radius,
            data.km_rate,
            data.stop_fee,
            data.max_transport,
            data.max_unit_price,
        )
        if data.pool
        else []
    )
    return {
        "listings": rows,
        "pools": pools,
        "parsed": parsed,
        "quantity": quantity,
        "unit": unit,
        "radius_km": radius,
        "clarification": None,
        "pool_note": "Each plan uses one material, grade, intended use and unit. Every supplier and supplier pair is within the radius. Up to 4 listings are evaluated per plan; this is a bounded heuristic, not a guaranteed cheapest route.",
    }


@app.get("/api/listings")
def listings(db=Depends(db_session)):
    return listings_json(
        db, db.scalars(select(Listing).order_by(Listing.created.desc())).all()
    )


class NewListing(BaseModel):
    title: str = Field(min_length=4, max_length=140)
    material_id: str
    grade: Literal["clean_sorted", "used_sorted", "mixed"] = "clean_sorted"
    intent: Literal["reuse", "recycle"] = "recycle"
    quantity: float = Field(ge=0.001, le=1000000, multiple_of=0.001)
    price: float = Field(ge=0, le=1000000)
    description: str = Field(default="", max_length=2000)
    dimensions: str = Field(default="", max_length=150)


@app.post("/api/listings")
def add_listing(data: NewListing, user=Depends(current), db=Depends(db_session)):
    m = material(data.material_id)
    if not m:
        fail(422, "Choose a supported material.")
    if m["unit"] == "piece" and data.quantity != int(data.quantity):
        fail(422, "Pieces must be whole numbers.")
    l = Listing(
        id=uid(),
        seller_id=user.id,
        unit=m["unit"],
        available=data.quantity,
        created=time.time(),
        **data.model_dump(),
    )
    db.add(l)
    db.commit()
    return listing_json(db, l)


class Classification(BaseModel):
    text: str = Field(max_length=2000)


@app.post("/api/classify")
def classify(data: Classification):
    parsed = parse_query(data.text)
    return {
        "method": "rules",
        "suggestions": [material(x) for x in parsed["material_ids"]],
        "needs_confirmation": True,
        "note": "Keyword-based suggestions. Confirm resin, condition and intended use; no image model is connected.",
    }


class GST(BaseModel):
    gstin: str


@app.post("/api/me/gst")
def submit_gst(data: GST, user=Depends(current), db=Depends(db_session)):
    value = data.gstin.strip().upper()
    if not re.fullmatch(r"\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]", value):
        fail(
            422,
            "GSTIN must contain 15 characters in the expected format. Format checking does not verify registration.",
        )
    user.gstin = value
    user.gst_status = "pending"
    user.gst_reference = ""
    db.add(user)
    db.commit()
    return {
        "status": "pending",
        "message": "Submitted for manual review. This is not government verification.",
    }


@app.post("/api/evidence")
async def upload(
    file: UploadFile = File(...),
    kind: str = Form(...),
    listing_id: str | None = Form(default=None),
    user=Depends(current),
    db=Depends(db_session),
):
    if kind not in ["photo", "weighing_slip", "gst_document"]:
        fail(422, "Unsupported evidence type.")
    if kind != "gst_document":
        listing = db.get(Listing, listing_id or "")
        if not listing or listing.seller_id != user.id:
            fail(403, "Choose one of your listings.")
    else:
        listing_id = None
    raw = await file.read(5 * 1024 * 1024 + 1)
    if len(raw) > 5 * 1024 * 1024:
        fail(413, "Maximum file size is 5 MB.")
    eid = uid()
    if file.content_type in ["image/jpeg", "image/png", "image/webp"]:
        try:
            Image.MAX_IMAGE_PIXELS = 20_000_000
            im = Image.open(io.BytesIO(raw))
            im.load()
            im.thumbnail((1800, 1800))
            im = im.convert("RGB")
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=85)
            raw = buf.getvalue()
        except Exception:
            fail(
                422,
                "The image could not be read. Use a JPG, PNG or WebP under 20 megapixels.",
            )
        filename = eid + ".jpg"
        mime = "image/jpeg"
    elif (
        kind != "photo"
        and file.content_type == "application/pdf"
        and raw.startswith(b"%PDF-")
    ):
        filename = eid + ".pdf"
        mime = "application/pdf"
    else:
        fail(422, "Use an image for photos, or an image/PDF for documents.")
    (UPLOADS / filename).write_bytes(raw)
    e = Evidence(
        id=eid,
        business_id=user.id,
        listing_id=listing_id,
        kind=kind,
        filename=filename,
        mime=mime,
    )
    db.add(e)
    db.commit()
    return {"id": eid, "status": "pending"}


@app.get("/api/evidence/{eid}")
def get_evidence(
    eid: str,
    db=Depends(db_session),
    auth: HTTPAuthorizationCredentials | None = Depends(security),
):
    e = db.get(Evidence, eid)
    if not e:
        fail(404, "Evidence not found.")
    if e.kind != "photo":
        u = current(auth, db)
        if u.id != e.business_id and u.role != "admin":
            fail(403, "Private evidence is visible to its owner and reviewers only.")
    path = UPLOADS / e.filename
    if not path.exists():
        fail(404, "Evidence file is missing.")
    return FileResponse(
        path,
        media_type=e.mime,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline" if e.kind == "photo" else "attachment",
        },
    )


@app.get("/api/businesses/{bid}/trust")
def get_trust(bid: str, db=Depends(db_session)):
    b = db.get(Business, bid)
    if not b:
        fail(404, "Business not found.")
    reviews = db.scalars(
        select(Review).where(Review.seller_id == bid).order_by(Review.created.desc())
    ).all()
    return {
        **trust(db, b),
        "business": public_business(b),
        "reviews": [
            {
                "rating": r.rating,
                "comment": r.comment,
                "buyer": db.get(Business, r.buyer_id).name,
            }
            for r in reviews
        ],
    }


@app.get("/api/admin/evidence")
def pending_evidence(user=Depends(admin), db=Depends(db_session)):
    return {
        "gst": [
            {"id": b.id, "name": b.name, "gstin": b.gstin, "status": b.gst_status}
            for b in db.scalars(
                select(Business).where(Business.gst_status == "pending")
            ).all()
        ],
        "evidence": [
            {
                "id": e.id,
                "business": db.get(Business, e.business_id).name,
                "business_id": e.business_id,
                "kind": e.kind,
                "url": f"/api/evidence/{e.id}",
                "status": e.status,
                "listing_id": e.listing_id,
            }
            for e in db.scalars(
                select(Evidence).where(Evidence.status == "pending")
            ).all()
        ],
    }


class Decision(BaseModel):
    approved: bool
    reference: str = Field(min_length=8, max_length=500)


@app.post("/api/admin/evidence/{eid}")
def review_evidence(
    eid: str, data: Decision, user=Depends(admin), db=Depends(db_session)
):
    e = db.get(Evidence, eid)
    if not e:
        fail(404, "Evidence not found.")
    if e.business_id == user.id:
        fail(403, "Reviewers cannot approve their own evidence.")
    e.status = "approved" if data.approved else "rejected"
    e.reference = data.reference
    e.reviewed_at = time.time()
    db.commit()
    return {"status": e.status}


@app.post("/api/admin/gst/{bid}")
def review_gst(bid: str, data: Decision, user=Depends(admin), db=Depends(db_session)):
    b = db.get(Business, bid)
    if not b or b.gst_status != "pending":
        fail(404, "Pending GST submission not found.")
    if bid == user.id:
        fail(403, "Reviewers cannot approve their own GST details.")
    b.gst_status = "reviewed" if data.approved else "rejected"
    b.gst_reference = data.reference
    db.commit()
    return {"status": b.gst_status}


class RequestItem(BaseModel):
    listing_id: str
    quantity: float = Field(ge=0.001, le=1000000, multiple_of=0.001)


class NewExchange(BaseModel):
    items: list[RequestItem] = Field(min_length=1, max_length=4)
    idempotency_key: str = Field(min_length=8, max_length=100)
    pickup: str = Field(default="Arrange pickup with supplier", max_length=300)
    radius_km: float = Field(default=30, gt=0, le=100)


@app.post("/api/exchanges")
def request_exchange(data: NewExchange, user=Depends(current), db=Depends(db_session)):
    if len(set(i.listing_id for i in data.items)) != len(data.items):
        fail(422, "A listing can only appear once in a request.")
    existing = db.scalar(
        select(Exchange).where(
            Exchange.buyer_id == user.id,
            Exchange.idempotency_key == data.idempotency_key,
        )
    )
    if existing:
        old = db.scalars(
            select(ExchangeItem).where(ExchangeItem.exchange_id == existing.id)
        ).all()
        if sorted((x.listing_id, x.quantity) for x in old) != sorted(
            (x.listing_id, x.quantity) for x in data.items
        ):
            fail(409, "This request key was already used for different quantities.")
        return {"id": existing.id, "reused": True}
    listings = []
    keys = set()
    locations = []
    for item in data.items:
        l = db.get(Listing, item.listing_id)
        if not l:
            fail(404, "A listing no longer exists.")
        if l.seller_id == user.id:
            fail(422, "You cannot request your own material.")
        if item.quantity > l.available:
            fail(409, "Stock changed. Refresh the search before requesting.")
        if l.unit == "piece" and item.quantity != int(item.quantity):
            fail(422, "Pieces must be whole numbers.")
        keys.add((l.material_id, l.grade, l.intent, l.unit))
        b = db.get(Business, l.seller_id)
        loc = (b.latitude, b.longitude)
        if haversine((user.latitude, user.longitude), loc) > data.radius_km:
            fail(
                422,
                "A supplier is outside your business location radius. Search from your account location.",
            )
        locations.append(loc)
        listings.append(l)
    if len(keys) > 1:
        fail(422, "A pool must use the same material, grade, intended use and unit.")
    from itertools import combinations

    if any(haversine(a, b) > data.radius_km for a, b in combinations(locations, 2)):
        fail(422, "Suppliers are too far apart for this pool.")
    e = Exchange(
        id=uid(),
        buyer_id=user.id,
        idempotency_key=data.idempotency_key,
        pickup=data.pickup,
        created=time.time(),
        pooled=len(data.items) > 1,
    )
    db.add(e)
    db.flush()
    for item, l in zip(data.items, listings):
        db.add(
            ExchangeItem(
                id=uid(),
                exchange_id=e.id,
                listing_id=l.id,
                seller_id=l.seller_id,
                quantity=item.quantity,
                unit_price=l.price,
            )
        )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        fail(409, "Request already submitted. Retry with the same request key.")
    return {"id": e.id, "reused": False}


@app.get("/api/exchanges")
def my_exchanges(user=Depends(current), db=Depends(db_session)):
    result = []
    for e in db.scalars(select(Exchange).order_by(Exchange.created.desc())).all():
        items = db.scalars(
            select(ExchangeItem).where(ExchangeItem.exchange_id == e.id)
        ).all()
        if e.buyer_id != user.id and not any(i.seller_id == user.id for i in items):
            continue
        visible = (
            items
            if e.buyer_id == user.id
            else [i for i in items if i.seller_id == user.id]
        )
        result.append(
            {
                "id": e.id,
                "buyer_id": e.buyer_id,
                "buyer_name": db.get(Business, e.buyer_id).name,
                "created": e.created,
                "pickup": e.pickup,
                "pooled": e.pooled,
                "all_confirmed": all(
                    i.status in ["accepted", "completed"] for i in items
                ),
                "items": [
                    {
                        **{
                            k: getattr(i, k)
                            for k in [
                                "id",
                                "listing_id",
                                "seller_id",
                                "quantity",
                                "unit_price",
                                "status",
                                "actual",
                                "seller_confirmed",
                                "buyer_confirmed",
                            ]
                        },
                        "title": db.get(Listing, i.listing_id).title,
                        "unit": db.get(Listing, i.listing_id).unit,
                        "seller_name": db.get(Business, i.seller_id).name,
                        "reviewed": bool(
                            db.scalar(select(Review).where(Review.item_id == i.id))
                        ),
                    }
                    for i in visible
                ],
            }
        )
    return result


class Action(BaseModel):
    action: Literal["accept", "decline", "cancel", "confirm", "dispute"]
    actual: float | None = Field(default=None, ge=0, le=1000000, multiple_of=0.001)


@app.post("/api/exchange-items/{iid}/action")
def item_action(iid: str, data: Action, user=Depends(current), db=Depends(db_session)):
    i = db.get(ExchangeItem, iid)
    if not i:
        fail(404, "Exchange item not found.")
    e = db.get(Exchange, i.exchange_id)
    seller = user.id == i.seller_id
    buyer = user.id == e.buyer_id
    if not (seller or buyer):
        fail(403, "This exchange does not belong to you.")
    if data.action in ["accept", "decline"] and not seller:
        fail(403, "Only the supplier can accept or decline.")
    old_status = i.status
    if data.action in ["accept", "decline"] and i.status != "pending":
        fail(409, "This request has already been processed.")
    if data.action == "cancel" and i.status not in ["pending", "accepted"]:
        fail(409, "This item cannot be cancelled.")
    if data.action == "cancel" and (i.seller_confirmed or i.buyer_confirmed):
        fail(409, "Handover already started. Report an issue instead.")
    if data.action in ["confirm", "dispute"] and i.status != "accepted":
        fail(409, "Only an accepted request can proceed to handover.")
    if data.action == "confirm":
        if data.actual is None or data.actual <= 0 or data.actual > i.quantity:
            fail(
                422,
                "Confirm a positive transferred quantity up to the agreed amount. If nothing was transferred, cancel before handover or report an issue.",
            )
        if db.get(Listing, i.listing_id).unit == "piece" and data.actual != int(
            data.actual
        ):
            fail(422, "Pieces must be whole numbers.")
        if (seller and i.seller_confirmed) or (buyer and i.buyer_confirmed):
            return {"status": i.status}
        if i.actual is not None and abs(i.actual - data.actual) > 0.0001:
            fail(
                409,
                "Both parties must confirm the same actual quantity. Report an issue if you disagree.",
            )
    locked = db.execute(
        update(ExchangeItem)
        .where(
            ExchangeItem.id == iid,
            ExchangeItem.status == old_status,
            ExchangeItem.seller_confirmed == i.seller_confirmed,
            ExchangeItem.buyer_confirmed == i.buyer_confirmed,
        )
        .values(status="processing"),
        execution_options={"synchronize_session": False},
    )
    if locked.rowcount != 1:
        db.rollback()
        fail(409, "The exchange changed. Refresh and try again.")
    if data.action == "accept":
        changed = db.execute(
            update(Listing)
            .where(Listing.id == i.listing_id, Listing.available >= i.quantity)
            .values(available=Listing.available - i.quantity)
        )
        if changed.rowcount != 1:
            db.rollback()
            fail(409, "Not enough stock remains. Refresh the request.")
        i.status = "accepted"
    elif data.action in ["decline", "cancel"]:
        if old_status == "accepted":
            db.execute(
                update(Listing)
                .where(Listing.id == i.listing_id)
                .values(available=Listing.available + i.quantity)
            )
        i.status = "declined" if data.action == "decline" else "cancelled"
    elif data.action == "dispute":
        i.status = "disputed"
    else:
        i.actual = data.actual
        if seller:
            i.seller_confirmed = True
        if buyer:
            i.buyer_confirmed = True
        i.status = (
            "completed" if i.seller_confirmed and i.buyer_confirmed else "accepted"
        )
        if i.status == "completed":
            db.execute(
                update(Listing)
                .where(Listing.id == i.listing_id)
                .values(available=Listing.available + (i.quantity - i.actual))
            )
    # force status write even when it equals the original loaded value after processing lock
    db.execute(
        update(ExchangeItem)
        .where(ExchangeItem.id == iid)
        .values(
            status=i.status,
            actual=i.actual,
            seller_confirmed=i.seller_confirmed,
            buyer_confirmed=i.buyer_confirmed,
        )
    )
    db.commit()
    return {"status": i.status}


class NewReview(BaseModel):
    item_id: str
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=3, max_length=500)


@app.post("/api/reviews")
def add_review(data: NewReview, user=Depends(current), db=Depends(db_session)):
    i = db.get(ExchangeItem, data.item_id)
    if not i or db.get(Exchange, i.exchange_id).buyer_id != user.id:
        fail(403, "Only the buyer can review this exchange.")
    if i.status != "completed":
        fail(409, "Reviews are available after both parties confirm handover.")
    r = Review(
        id=uid(),
        buyer_id=user.id,
        seller_id=i.seller_id,
        created=time.time(),
        **data.model_dump(),
    )
    db.add(r)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        fail(409, "This exchange has already been reviewed.")
    return {"id": r.id}


class Resolve(BaseModel):
    actual: float = Field(ge=0, le=1000000, multiple_of=0.001)
    reference: str = Field(min_length=8, max_length=500)


@app.get("/api/admin/disputes")
def disputes(user=Depends(admin), db=Depends(db_session)):
    return [
        {
            "id": i.id,
            "title": db.get(Listing, i.listing_id).title,
            "quantity": i.quantity,
            "actual": i.actual,
            "buyer": db.get(Business, db.get(Exchange, i.exchange_id).buyer_id).name,
            "seller": db.get(Business, i.seller_id).name,
        }
        for i in db.scalars(
            select(ExchangeItem).where(ExchangeItem.status == "disputed")
        ).all()
    ]


@app.post("/api/admin/disputes/{iid}")
def resolve(iid: str, data: Resolve, user=Depends(admin), db=Depends(db_session)):
    i = db.get(ExchangeItem, iid)
    if not i or i.status != "disputed":
        fail(404, "Dispute not found.")
    if user.id in [i.seller_id, db.get(Exchange, i.exchange_id).buyer_id]:
        fail(403, "A reviewer cannot resolve their own exchange.")
    if data.actual > i.quantity:
        fail(422, "Actual quantity exceeds the agreement.")
    if db.get(Listing, i.listing_id).unit == "piece" and data.actual != int(
        data.actual
    ):
        fail(422, "Pieces must be whole numbers.")
    changed = db.execute(
        update(ExchangeItem)
        .where(ExchangeItem.id == iid, ExchangeItem.status == "disputed")
        .values(status="resolved", actual=data.actual)
    )
    if changed.rowcount != 1:
        db.rollback()
        fail(409, "Already resolved.")
    db.execute(
        update(Listing)
        .where(Listing.id == i.listing_id)
        .values(available=Listing.available + i.quantity - data.actual)
    )
    # Preserve reviewer audit note without awarding a completed-exchange review.
    e = db.get(Exchange, i.exchange_id)
    e.pickup += " | Resolution: " + data.reference
    db.commit()
    return {"status": "resolved"}
