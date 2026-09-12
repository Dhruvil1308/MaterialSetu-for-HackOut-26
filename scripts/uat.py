"""User acceptance tests: the product's promises, checked one by one.

Different from services/api/test_api.py, which pins down internals. This walks
the API the way a buyer, a supplier and a reviewer actually would, and states
each expectation in their words so a failure reads as a broken promise rather
than a broken assertion.

    python scripts/uat.py                 # against a throwaway local API
    python scripts/uat.py --url https://... --read-only    # against a deployment

--read-only skips everything that writes, so it is safe to point at production.
"""

import argparse
import io
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import httpx
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
results = []
section = ""


def heading(name):
    global section
    section = name
    print(f"\n\033[1m{name}\033[0m")


def check(promise, ok, detail=""):
    results.append((section, promise, ok, detail))
    mark = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
    print(f"  {mark}  {promise}")
    if not ok and detail:
        print(f"        {detail}")
    return ok


class Api:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.c = httpx.Client(timeout=120)

    def __call__(self, method, path, token=None, **kw):
        headers = kw.pop("headers", {})
        if token:
            headers["Authorization"] = "Bearer " + token
        return self.c.request(method, self.base + path, headers=headers, **kw)

    def token(self, business_id):
        r = self("POST", "/api/auth/demo", json={"business_id": business_id})
        return r.json()["token"] if r.status_code == 200 else None


def jpeg(colour="#2c6a4c", size=(600, 400)):
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, format="JPEG", quality=80)
    return buf.getvalue()


# --------------------------------------------------------------------------


def run(api, read_only):
    buyer = api.token("buyer")
    s1 = api.token("s1")
    s2 = api.token("s2")
    admin = api.token("admin")

    heading("1. Getting in")
    h = api("GET", "/api/health").json()
    check("The service reports it is healthy", h.get("status") == "ok", h)
    check("Demo accounts exist so anyone can try it", bool(buyer and s1 and admin))
    check(
        "Signing in returns who you are",
        api("GET", "/api/me", buyer).json().get("name") == "Setu Packaging Studio",
    )
    check(
        "A stranger cannot see my exchanges",
        api("GET", "/api/exchanges").status_code == 401,
    )
    check(
        "A made-up token is refused",
        api("GET", "/api/me", "not-a-real-token").status_code == 401,
    )

    heading("2. Nobody can promote themselves to reviewer")
    if read_only:
        check("skipped in read-only mode", True)
    else:
        email = f"uat-{uuid.uuid4().hex[:8]}@example.test"
        r = api(
            "POST",
            "/api/auth/register",
            json={
                "name": "UAT Business",
                "email": email,
                "password": "a-long-enough-password",
                "city": "Mehsana",
                "latitude": 23.588,
                "longitude": 72.369,
                "role": "admin",
            },
        )
        check("I can register a business", r.status_code == 200, r.text[:120])
        check(
            "Asking to be an admin during signup is ignored",
            r.json()["user"]["role"] == "member",
        )
        mine = r.json()["token"]
        check(
            "A member cannot open the reviewer queue",
            api("GET", "/api/admin/evidence", mine).status_code == 403,
        )
        check(
            "The same email cannot register twice",
            api(
                "POST",
                "/api/auth/register",
                json={
                    "name": "Copycat",
                    "email": email,
                    "password": "a-long-enough-password",
                    "city": "Mehsana",
                    "latitude": 23.5,
                    "longitude": 72.3,
                },
            ).status_code
            == 409,
        )
        check(
            "A short password is refused",
            api(
                "POST",
                "/api/auth/register",
                json={
                    "name": "Weak",
                    "email": f"w-{uuid.uuid4().hex[:6]}@example.test",
                    "password": "short",
                    "city": "Mehsana",
                    "latitude": 23.5,
                    "longitude": 72.3,
                },
            ).status_code
            == 422,
        )
        check(
            "The wrong password is refused",
            api(
                "POST", "/api/auth/login", json={"email": email, "password": "wrong-one"}
            ).status_code
            == 401,
        )
        check(
            "The right password works",
            api(
                "POST",
                "/api/auth/login",
                json={"email": email, "password": "a-long-enough-password"},
            ).status_code
            == 200,
        )
        api("POST", "/api/auth/logout", mine)
        check(
            "After signing out my token stops working",
            api("GET", "/api/me", mine).status_code == 401,
        )

    heading("3. Finding material the way a buyer would ask")
    d = api("POST", "/api/search", json={"query": "50 kg PET within 30 km"}).json()
    check("Asking for '50 kg PET within 30 km' understands the material",
          d["parsed"]["material_ids"] == ["pet"], d["parsed"])
    check("...and the amount", d["quantity"] == 50 and d["unit"] == "kg")
    check("...and the distance", d["radius_km"] == 30)
    check("It finds PET nearby", len(d["listings"]) > 0)
    check("It offers a way to make up the full 50 kg", len(d["pools"]) > 0)

    mixed = api("POST", "/api/search", json={"query": "50 kg plastic"}).json()
    check(
        "Asking for 'plastic' offers each plastic separately, never blended",
        all(len({i["material_id"] for i in p["items"]}) == 1 for p in mixed["pools"]),
    )
    check(
        "Every plan actually adds up to what I asked for",
        all(
            abs(sum(i["take"] for i in p["items"]) - p["quantity"]) < 0.001
            for p in mixed["pools"]
        ),
    )
    check(
        "Every plan shows what it would cost me in total",
        all(
            abs(p["material_cost"] + p["transport_cost"] - p["total_cost"]) < 0.02
            for p in mixed["pools"]
        ),
    )

    unknown = api("POST", "/api/search", json={"query": "50 kg unicorns"}).json()
    check(
        "Nonsense gets a question, not a wrong guess",
        not unknown["listings"] and unknown["clarification"],
    )
    for bad in ["0 kg plastic", "-50 kg plastic"]:
        check(
            f"'{bad}' is refused rather than answered",
            api("POST", "/api/search", json={"query": bad}).status_code == 422,
        )
    check(
        "A supplier is not shown their own material to buy",
        all(
            l["seller_id"] != "s1"
            for l in api(
                "POST", "/api/search", token=s1, json={"query": "50 kg PET"}
            ).json()["listings"]
        ),
    )
    check(
        "A tight transport budget removes plans that exceed it",
        not api(
            "POST", "/api/search", json={"query": "50 kg plastic", "max_transport": 0}
        ).json()["pools"],
    )
    far = api(
        "POST", "/api/search", json={"query": "50 kg PET", "radius_km": 5}
    ).json()
    check(
        "A 5 km radius excludes suppliers further away",
        all((l["distance_km"] or 0) <= 5 for l in far["listings"]),
    )

    heading("4. Listing material as a supplier")
    if read_only:
        check("skipped in read-only mode", True)
        lid = None
    else:
        r = api(
            "POST",
            "/api/listings",
            s1,
            json={
                "title": "UAT clean PET flakes",
                "material_id": "pet",
                "quantity": 40,
                "price": 20,
            },
        )
        check("I can publish material I have spare", r.status_code == 200, r.text[:120])
        lid = r.json()["id"]
        check("It starts fully available", r.json()["available"] == 40)
        check(
            "A material we do not handle is refused",
            api(
                "POST",
                "/api/listings",
                s1,
                json={
                    "title": "Uranium offcuts",
                    "material_id": "uranium",
                    "quantity": 1,
                    "price": 1,
                },
            ).status_code
            == 422,
        )
        check(
            "Half a pallet is refused, because pallets are whole things",
            api(
                "POST",
                "/api/listings",
                s1,
                json={
                    "title": "Broken pallets",
                    "material_id": "pallet",
                    "quantity": 2.5,
                    "price": 100,
                },
            ).status_code
            == 422,
        )
        check(
            "A one-letter title is refused",
            api(
                "POST",
                "/api/listings",
                s1,
                json={"title": "x", "material_id": "pet", "quantity": 1, "price": 1},
            ).status_code
            == 422,
        )
        check(
            "Signing out means I cannot publish",
            api(
                "POST",
                "/api/listings",
                json={
                    "title": "Anonymous material",
                    "material_id": "pet",
                    "quantity": 1,
                    "price": 1,
                },
            ).status_code
            == 401,
        )

    heading("5. Agreeing an exchange")
    if read_only or not lid:
        check("skipped in read-only mode", True)
    else:
        key = uuid.uuid4().hex
        body = {"items": [{"listing_id": lid, "quantity": 10}], "idempotency_key": key}
        r = api("POST", "/api/exchanges", buyer, json=body)
        check("I can ask a supplier for material", r.status_code == 200, r.text[:120])
        avail = lambda: next(
            l["available"] for l in api("GET", "/api/listings").json() if l["id"] == lid
        )
        check("Asking does not yet take it off the shelf", avail() == 40)
        check(
            "Sending the same request twice does not duplicate it",
            api("POST", "/api/exchanges", buyer, json=body).json().get("reused") is True,
        )
        body2 = dict(body)
        body2["items"] = [{"listing_id": lid, "quantity": 99}]
        check(
            "Reusing a request id for a different amount is refused",
            api("POST", "/api/exchanges", buyer, json=body2).status_code == 409,
        )
        check(
            "I cannot buy my own material",
            api(
                "POST",
                "/api/exchanges",
                s1,
                json={
                    "items": [{"listing_id": lid, "quantity": 1}],
                    "idempotency_key": uuid.uuid4().hex,
                },
            ).status_code
            == 422,
        )
        check(
            "A plan cannot mix two different materials",
            api(
                "POST",
                "/api/exchanges",
                buyer,
                json={
                    "items": [
                        {"listing_id": "l1", "quantity": 5},
                        {"listing_id": "l4", "quantity": 5},
                    ],
                    "idempotency_key": uuid.uuid4().hex,
                },
            ).status_code
            == 422,
        )

        item = next(
            i["id"]
            for e in api("GET", "/api/exchanges", s1).json()
            for i in e["items"]
            if i["listing_id"] == lid and i["status"] == "pending"
        )
        check(
            "The buyer cannot accept on the supplier's behalf",
            api(
                "POST", f"/api/exchange-items/{item}/action", buyer, json={"action": "accept"}
            ).status_code
            == 403,
        )
        check(
            "The supplier accepting reserves exactly what was agreed",
            api(
                "POST", f"/api/exchange-items/{item}/action", s1, json={"action": "accept"}
            ).status_code
            == 200,
        )
        check("Stock drops by the agreed amount, not more", avail() == 30)
        check(
            "Accepting twice does nothing the second time",
            api(
                "POST", f"/api/exchange-items/{item}/action", s1, json={"action": "accept"}
            ).status_code
            == 409,
        )

        heading("6. Handing the material over")
        check(
            "Claiming more than was agreed is refused",
            api(
                "POST",
                f"/api/exchange-items/{item}/action",
                s1,
                json={"action": "confirm", "actual": 999},
            ).status_code
            == 422,
        )
        check(
            "Claiming nothing changed hands is refused",
            api(
                "POST",
                f"/api/exchange-items/{item}/action",
                s1,
                json={"action": "confirm", "actual": 0},
            ).status_code
            == 422,
        )
        api(
            "POST",
            f"/api/exchange-items/{item}/action",
            s1,
            json={"action": "confirm", "actual": 8},
        )
        check(
            "If we disagree on the weight, neither figure is accepted",
            api(
                "POST",
                f"/api/exchange-items/{item}/action",
                buyer,
                json={"action": "confirm", "actual": 6},
            ).status_code
            == 409,
        )
        r = api(
            "POST",
            f"/api/exchange-items/{item}/action",
            buyer,
            json={"action": "confirm", "actual": 8},
        )
        check("Agreeing the same weight completes it", r.json().get("status") == "completed")
        check("The 2 kg not taken goes back on sale", avail() == 32)

        heading("7. Reviews come only from real deals")
        review = {"item_id": item, "rating": 5, "comment": "Material was as described"}
        check(
            "The buyer can review a completed exchange",
            api("POST", "/api/reviews", buyer, json=review).status_code == 200,
        )
        check(
            "...but only once",
            api("POST", "/api/reviews", buyer, json=review).status_code == 409,
        )
        check(
            "A supplier cannot review their own sale",
            api("POST", "/api/reviews", s1, json=review).status_code == 403,
        )
        other = uuid.uuid4().hex
        api(
            "POST",
            "/api/exchanges",
            buyer,
            json={"items": [{"listing_id": lid, "quantity": 1}], "idempotency_key": other},
        )
        pending = next(
            i["id"]
            for e in api("GET", "/api/exchanges", buyer).json()
            for i in e["items"]
            if i["status"] == "pending" and i["listing_id"] == lid
        )
        check(
            "An exchange that has not happened cannot be reviewed",
            api(
                "POST",
                "/api/reviews",
                buyer,
                json={"item_id": pending, "rating": 5, "comment": "Too early"},
            ).status_code
            == 409,
        )

        heading("8. Cancelling gives the material back")
        r = api("POST", "/api/exchange-items/{}/action".format(pending), s1, json={"action": "accept"})
        before = avail()
        api("POST", f"/api/exchange-items/{pending}/action", buyer, json={"action": "cancel"})
        check("Cancelling returns the reserved material", avail() == before + 1)
        check(
            "Cancelling twice does not return it twice",
            api(
                "POST", f"/api/exchange-items/{pending}/action", buyer, json={"action": "cancel"}
            ).status_code
            == 409,
        )

    heading("9. Proof, and who may see it")
    if read_only:
        check(
            "A material photo is public",
            api("GET", "/api/evidence/l1-photo").status_code == 200,
        )
        check(
            "A weighing slip is not",
            api("GET", "/api/evidence/l1-weighing_slip").status_code == 401,
        )
    else:
        r = api(
            "POST",
            "/api/evidence",
            s1,
            data={"kind": "weighing_slip", "listing_id": lid},
            files={"file": ("slip.jpg", jpeg(), "image/jpeg")},
        )
        check("I can upload a weighing slip", r.status_code == 200, r.text[:140])
        eid = r.json()["id"]
        check("It is not trusted until someone checks it", r.json()["status"] == "pending")
        check(
            "Only I can download my own slip",
            api("GET", f"/api/evidence/{eid}", s1).status_code == 200,
        )
        check(
            "Another business cannot",
            api("GET", f"/api/evidence/{eid}", buyer).status_code == 403,
        )
        check(
            "A stranger cannot",
            api("GET", f"/api/evidence/{eid}").status_code == 401,
        )
        check(
            "A reviewer can, because that is their job",
            api("GET", f"/api/evidence/{eid}", admin).status_code == 200,
        )
        check(
            "A pretend image is refused",
            api(
                "POST",
                "/api/evidence",
                s1,
                data={"kind": "photo", "listing_id": lid},
                files={"file": ("virus.exe", b"MZ\x00\x00not an image", "application/x-msdownload")},
            ).status_code
            == 422,
        )
        check(
            "I cannot attach proof to someone else's listing",
            api(
                "POST",
                "/api/evidence",
                buyer,
                data={"kind": "photo", "listing_id": lid},
                files={"file": ("p.jpg", jpeg(), "image/jpeg")},
            ).status_code
            == 403,
        )

        heading("10. A reviewer decides what counts")
        check(
            "A member cannot see the review queue",
            api("GET", "/api/admin/evidence", s1).status_code == 403,
        )
        queue = api("GET", "/api/admin/evidence", admin)
        check("A reviewer can", queue.status_code == 200)
        check(
            "A decision without a written reason is refused",
            api(
                "POST", f"/api/admin/evidence/{eid}", admin, json={"approved": True, "reference": ""}
            ).status_code
            == 422,
        )
        check(
            "Approving with a reason works",
            api(
                "POST",
                f"/api/admin/evidence/{eid}",
                admin,
                json={"approved": True, "reference": "Checked against the physical slip"},
            ).status_code
            == 200,
        )

        heading("11. GST is checked by a person, not claimed by the app")
        check(
            "The service says plainly that GST is reviewed by hand",
            h.get("gst_verification") == "manual_review",
        )
        check(
            "A GSTIN of the wrong shape is refused",
            api("POST", "/api/me/gst", s1, json={"gstin": "NOT-A-GSTIN"}).status_code == 422,
        )
        before = next(
            p["points"]
            for p in api("GET", "/api/businesses/s3/trust").json()["parts"]
            if p["label"] == "GST review"
        )
        s3 = api.token("s3")
        api("POST", "/api/me/gst", s3, json={"gstin": "24ABCDE1234F1Z5"})
        mid = next(
            p["points"]
            for p in api("GET", "/api/businesses/s3/trust").json()["parts"]
            if p["label"] == "GST review"
        )
        check("Submitting a GSTIN earns nothing on its own", before == 0 and mid == 0)
        check(
            "A business cannot approve its own GST",
            api(
                "POST",
                "/api/admin/gst/s3",
                s3,
                json={"approved": True, "reference": "I approve myself"},
            ).status_code
            == 403,
        )
        api(
            "POST",
            "/api/admin/gst/s3",
            admin,
            json={"approved": True, "reference": "Certificate checked on 12 September"},
        )
        after = next(
            p["points"]
            for p in api("GET", "/api/businesses/s3/trust").json()["parts"]
            if p["label"] == "GST review"
        )
        check("Only a reviewer's approval earns the 25 points", after == 25)

        heading("A. When the two sides disagree")
        key = uuid.uuid4().hex
        api("POST", "/api/exchanges", buyer,
            json={"items": [{"listing_id": lid, "quantity": 6}], "idempotency_key": key})
        dis = next(i["id"] for e in api("GET", "/api/exchanges", buyer).json()
                   for i in e["items"] if i["status"] == "pending" and i["listing_id"] == lid)
        api("POST", f"/api/exchange-items/{dis}/action", s1, json={"action": "accept"})
        held = avail()
        check("Either side can report a problem",
              api("POST", f"/api/exchange-items/{dis}/action", buyer,
                  json={"action": "dispute"}).status_code == 200)
        check("Disputed material stays reserved until it is settled", avail() == held)
        check("A member cannot see the dispute queue",
              api("GET", "/api/admin/disputes", s1).status_code == 403)
        check("A reviewer can", api("GET", "/api/admin/disputes", admin).status_code == 200)
        check("A reviewer must write down how they settled it",
              api("POST", f"/api/admin/disputes/{dis}", admin,
                  json={"actual": 4, "reference": ""}).status_code == 422)
        check("A settlement above the agreed amount is refused",
              api("POST", f"/api/admin/disputes/{dis}", admin,
                  json={"actual": 99, "reference": "Checked both receipts"}).status_code == 422)
        r = api("POST", f"/api/admin/disputes/{dis}", admin,
                json={"actual": 4, "reference": "Checked both weighbridge receipts"})
        check("A reviewer settles it on the evidence", r.status_code == 200, r.text[:120])
        check("The material not handed over goes back on sale", avail() == held + 2)
        check("A settled dispute cannot be settled again",
              api("POST", f"/api/admin/disputes/{dis}", admin,
                  json={"actual": 4, "reference": "Checked both weighbridge receipts"}).status_code == 404)
        check("A settled dispute does not earn the supplier a review",
              api("POST", "/api/reviews", buyer,
                  json={"item_id": dis, "rating": 5, "comment": "Settled by a reviewer"}).status_code == 409)

        heading("B. Limits that protect the service")
        check("A file over 5 MB is refused",
              api("POST", "/api/evidence", s1, data={"kind": "photo", "listing_id": lid},
                  files={"file": ("huge.jpg", b"\xff\xd8\xff" + b"0" * (5 * 1024 * 1024 + 10), "image/jpeg")}
                  ).status_code == 413)
        check("A PDF is fine as a document",
              api("POST", "/api/evidence", s1, data={"kind": "weighing_slip", "listing_id": lid},
                  files={"file": ("slip.pdf", b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "application/pdf")}
                  ).status_code == 200)
        check("...but not as a material photograph",
              api("POST", "/api/evidence", s1, data={"kind": "photo", "listing_id": lid},
                  files={"file": ("p.pdf", b"%PDF-1.4\n", "application/pdf")}).status_code == 422)
        check("A file claiming to be a PDF but is not, is refused",
              api("POST", "/api/evidence", s1, data={"kind": "weighing_slip", "listing_id": lid},
                  files={"file": ("fake.pdf", b"just text", "application/pdf")}).status_code == 422)
        check("I cannot ask for more than a supplier has",
              api("POST", "/api/exchanges", buyer,
                  json={"items": [{"listing_id": lid, "quantity": 100000}],
                        "idempotency_key": uuid.uuid4().hex}).status_code == 409)
        check("A negative price is refused",
              api("POST", "/api/listings", s1,
                  json={"title": "Negative price test", "material_id": "pet",
                        "quantity": 1, "price": -5}).status_code == 422)
        check("A rating outside one to five is refused",
              api("POST", "/api/reviews", buyer,
                  json={"item_id": item, "rating": 9, "comment": "Off the scale"}).status_code == 422)
        check("An enormous quantity is refused",
              api("POST", "/api/listings", s1,
                  json={"title": "Too much material", "material_id": "pet",
                        "quantity": 9e12, "price": 1}).status_code == 422)
        check("Free material is allowed, because surplus is often given away",
              api("POST", "/api/listings", s1,
                  json={"title": "Free cardboard offcuts", "material_id": "cardboard",
                        "quantity": 10, "price": 0}).status_code == 200)

    heading("12. Trust is explained, not asserted")
    t = api("GET", "/api/businesses/s1/trust").json()
    check("A score is out of 100", 0 <= t["score"] <= 100)
    check("It adds up from its parts", sum(p["points"] for p in t["parts"]) == t["score"])
    check("Every part says where it came from", all(p["detail"] for p in t["parts"]))
    check(
        "The score says it is about evidence, not honesty",
        "guarantee" in t["note"].lower() or "not a" in t["note"].lower(),
    )
    check(
        "Anyone can inspect a supplier's record before dealing with them",
        api("GET", "/api/businesses/s1/trust").status_code == 200,
    )

    heading("13. Reading a request in another language")
    if h.get("classification") != "model":
        check("skipped — no model configured on this server", True)
    else:
        for phrase, expect in [
            ("मुझे 20 लकड़ी के पैलेट चाहिए", "pallet"),
            ("old shipping boxes 100kg", "cardboard"),
        ]:
            got = api("POST", "/api/search", buyer, json={"query": phrase}).json()["parsed"]
            check(f"'{phrase[:28]}' finds {expect}", expect in got["material_ids"], got)
        if not read_only:
            r = api(
                "POST",
                "/api/classify/image",
                s1,
                files={"file": ("m.jpg", jpeg("#b8905a"), "image/jpeg")},
            )
            check("A photograph returns suggestions to confirm", r.status_code == 200, r.text[:120])
            check("...and never claims to be certain of the resin",
                  r.json().get("needs_confirmation") is True)
        check(
            "Suggestions are not offered to anonymous callers",
            api("POST", "/api/classify", json={"text": "film"}).status_code == 401,
        )


# --------------------------------------------------------------------------


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", help="test a running deployment instead of a local one")
    p.add_argument("--read-only", action="store_true", help="skip everything that writes")
    args = p.parse_args()

    proc = tmp = None
    if args.url:
        base, read_only = args.url, args.read_only
    else:
        tmp = tempfile.TemporaryDirectory()
        env = {
            **os.environ,
            "DEMO_MODE": "1",
            "DATABASE_URL": "sqlite:///" + str(Path(tmp.name) / "uat.db"),
            "UPLOAD_DIR": str(Path(tmp.name) / "uploads"),
        }
        env.pop("SUPABASE_URL", None)
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "main:app", "--port", "8123"],
            cwd=ROOT / "services/api",
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        base, read_only = "http://127.0.0.1:8123", args.read_only

    api = Api(base)
    try:
        for _ in range(150):
            try:
                if api("GET", "/api/health").status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(0.3)
        print(f"\n\033[1mMaterialSetu acceptance tests\033[0m — {base}"
              f"{' (read-only)' if read_only else ''}")
        run(api, read_only)
    finally:
        if proc:
            proc.terminate()
            proc.wait(timeout=10)
        if tmp:
            tmp.cleanup()

    failed = [r for r in results if not r[2]]
    print(f"\n\033[1m{len(results) - len(failed)} of {len(results)} promises kept\033[0m")
    if failed:
        print("\n\033[31mNot kept:\033[0m")
        for sec, promise, _, detail in failed:
            print(f"  [{sec}] {promise}")
            if detail:
                print(f"      {detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
