import os, tempfile, uuid, io
from pathlib import Path

TMP = tempfile.TemporaryDirectory()
os.environ.update(
    DATABASE_URL="sqlite:///" + str(Path(TMP.name) / "test.db"),
    UPLOAD_DIR=str(Path(TMP.name) / "uploads"),
    DEMO_MODE="1",
)
# The suite describes behaviour with no model configured, whatever the shell holds.
os.environ.pop("OPENAI_API_KEY", None)
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth(c, b="buyer"):
    r = c.post("/api/auth/demo", json={"business_id": b})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def listing(c, seller="s1", quantity=100):
    r = c.post(
        "/api/listings",
        headers=auth(c, seller),
        json={
            "title": "Test sorted PET",
            "material_id": "pet",
            "quantity": quantity,
            "price": 20,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def request(c, lid, qty=10):
    r = c.post(
        "/api/exchanges",
        headers=auth(c),
        json={
            "items": [{"listing_id": lid, "quantity": qty}],
            "idempotency_key": uuid.uuid4().hex,
        },
    )
    assert r.status_code == 200, r.text
    return next(
        e["items"][0]["id"]
        for e in c.get("/api/exchanges", headers=auth(c)).json()
        if e["id"] == r.json()["id"]
    )


def action(c, i, a, b="s1", actual=None):
    return c.post(
        f"/api/exchange-items/{i}/action",
        headers=auth(c, b),
        json={"action": a, "actual": actual},
    )


def available(c, lid):
    return next(l["available"] for l in c.get("/api/listings").json() if l["id"] == lid)


def test_reverse_search_and_nearby_pool(client):
    d = client.post(
        "/api/search", json={"query": "50 kg plastic", "radius_km": 30}
    ).json()
    assert d["quantity"] == 50 and d["pools"]
    assert all(l["seller_id"] != "s4" for l in d["listings"])
    for p in d["pools"]:
        assert sum(i["take"] for i in p["items"]) == 50
        assert (
            len(
                {
                    (i["material_id"], i["grade"], i["intent"], i["unit"])
                    for i in p["items"]
                }
            )
            == 1
        )
    assert any(
        p["supplier_count"] >= 2 and p["material_id"] == "pet" for p in d["pools"]
    )


def test_transport_and_landed_budgets(client):
    for key, val in [("max_transport", 0), ("max_unit_price", 1)]:
        assert not client.post(
            "/api/search", json={"query": "50 kg plastic", key: val}
        ).json()["pools"]


def test_unknown_and_zero_query(client):
    d = client.post("/api/search", json={"query": "50 kg unicorns"}).json()
    assert not d["listings"] and d["clarification"]
    for q in ["0 kg plastic", "-50 kg plastic", "0.0001 kg PET"]:
        assert client.post("/api/search", json={"query": q}).status_code == 422


def test_pool_rejects_mixed_and_distant(client):
    for ids in [("l1", "l4"), ("l1", "l7")]:
        r = client.post(
            "/api/exchanges",
            headers=auth(client),
            json={
                "items": [{"listing_id": i, "quantity": 5} for i in ids],
                "idempotency_key": uuid.uuid4().hex,
            },
        )
        assert r.status_code == 422


def test_no_self_purchase_or_buyer_acceptance(client):
    assert (
        client.post(
            "/api/exchanges",
            headers=auth(client, "s1"),
            json={
                "items": [{"listing_id": "l1", "quantity": 1}],
                "idempotency_key": uuid.uuid4().hex,
            },
        ).status_code
        == 422
    )
    assert (
        action(client, request(client, listing(client)), "accept", "buyer").status_code
        == 403
    )


def test_reserve_cancel_once(client):
    lid = listing(client, quantity=20)
    iid = request(client, lid, 15)
    assert available(client, lid) == 20
    assert action(client, iid, "accept").status_code == 200
    assert available(client, lid) == 5
    assert action(client, iid, "accept").status_code == 409
    assert action(client, iid, "cancel", "buyer").status_code == 200
    assert available(client, lid) == 20
    assert action(client, iid, "cancel", "buyer").status_code == 409
    assert available(client, lid) == 20


def test_concurrent_accept_cannot_overallocate(client):
    from concurrent.futures import ThreadPoolExecutor

    lid = listing(client, quantity=20)
    a = request(client, lid, 15)
    b = request(client, lid, 15)
    with ThreadPoolExecutor(2) as ex:
        results = list(
            ex.map(lambda i: action(client, i, "accept").status_code, [a, b])
        )
    assert sorted(results) == [200, 409]
    assert available(client, lid) == 5


def test_partial_handover_review_gating(client):
    lid = listing(client, quantity=20)
    iid = request(client, lid, 15)
    action(client, iid, "accept")
    h = auth(client)
    review = {"item_id": iid, "rating": 5, "comment": "Good material"}
    assert client.post("/api/reviews", headers=h, json=review).status_code == 409
    assert action(client, iid, "confirm", actual=12).status_code == 200
    assert action(client, iid, "confirm", "buyer", 13).status_code == 409
    assert action(client, iid, "confirm", "buyer", 12).status_code == 200
    assert available(client, lid) == 8
    assert (
        client.post("/api/reviews", headers=auth(client, "s2"), json=review).status_code
        == 403
    )
    assert client.post("/api/reviews", headers=h, json=review).status_code == 200
    assert client.post("/api/reviews", headers=h, json=review).status_code == 409


def test_dispute_resolution(client):
    lid = listing(client, quantity=20)
    iid = request(client, lid, 15)
    action(client, iid, "accept")
    action(client, iid, "dispute", "buyer")
    assert available(client, lid) == 5
    body = {"actual": 5, "reference": "Buyer and supplier receipt checked"}
    assert (
        client.post(
            f"/api/admin/disputes/{iid}", headers=auth(client), json=body
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/admin/disputes/{iid}", headers=auth(client, "admin"), json=body
        ).status_code
        == 200
    )
    assert available(client, lid) == 15


def test_gst_entry_does_not_verify(client):
    h = auth(client, "s3")
    assert client.get("/api/businesses/s3/trust").json()["parts"][0]["points"] == 0
    assert (
        client.post("/api/me/gst", headers=h, json={"gstin": "24ABCDE1234F1Z5"}).json()[
            "status"
        ]
        == "pending"
    )
    assert client.get("/api/businesses/s3/trust").json()["parts"][0]["points"] == 0
    body = {"approved": True, "reference": "Test manual review reference"}
    assert client.post("/api/admin/gst/s3", headers=h, json=body).status_code == 403
    assert (
        client.post(
            "/api/admin/gst/s3", headers=auth(client, "admin"), json=body
        ).status_code
        == 200
    )
    assert client.get("/api/businesses/s3/trust").json()["parts"][0]["points"] == 25


def test_upload_private_slip_and_review(client):
    lid = listing(client, "s3")
    h = auth(client, "s3")
    buf = io.BytesIO()
    Image.new("RGB", (20, 20)).save(buf, format="PNG")
    r = client.post(
        "/api/evidence",
        headers=h,
        data={"kind": "weighing_slip", "listing_id": lid},
        files={"file": ("slip.png", buf.getvalue(), "image/png")},
    )
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    assert r.json()["status"] == "pending"
    assert client.get("/api/evidence/" + eid).status_code == 401
    assert client.get("/api/evidence/" + eid, headers=auth(client)).status_code == 403
    assert client.get("/api/evidence/" + eid, headers=h).status_code == 200
    assert (
        client.post(
            "/api/admin/evidence/" + eid,
            headers=auth(client, "admin"),
            json={"approved": True, "reference": "Test physical slip reviewed"},
        ).status_code
        == 200
    )


def test_request_idempotency(client):
    lid = listing(client)
    h = auth(client)
    b = {
        "items": [{"listing_id": lid, "quantity": 1}],
        "idempotency_key": uuid.uuid4().hex,
    }
    a = client.post("/api/exchanges", headers=h, json=b)
    again = client.post("/api/exchanges", headers=h, json=b)
    assert a.json()["id"] == again.json()["id"]
    b["items"][0]["quantity"] = 2
    assert client.post("/api/exchanges", headers=h, json=b).status_code == 409


def test_account_auth_logout_no_role_escalation(client):
    email = f"{uuid.uuid4().hex}@test.example"
    b = {
        "name": "Test business",
        "email": email,
        "password": "long-unique-pass",
        "city": "Mehsana",
        "latitude": 23.588,
        "longitude": 72.369,
        "role": "admin",
    }
    r = client.post("/api/auth/register", json=b)
    assert r.status_code == 200
    assert r.json()["user"]["role"] == "member"
    assert (
        client.post(
            "/api/auth/login", json={"email": email, "password": "bad"}
        ).status_code
        == 401
    )
    r = client.post(
        "/api/auth/login", json={"email": email, "password": "long-unique-pass"}
    )
    h = {"Authorization": "Bearer " + r.json()["token"]}
    assert client.get("/api/me", headers=h).status_code == 200
    assert client.post("/api/auth/logout", headers=h).status_code == 200
    assert client.get("/api/me", headers=h).status_code == 401


def test_zero_handover_cannot_earn_review(client):
    lid = listing(client, quantity=10)
    iid = request(client, lid, 5)
    action(client, iid, "accept")
    assert action(client, iid, "confirm", actual=0).status_code == 422
    assert available(client, lid) == 5


def test_supplier_pair_distance_constraint(client):
    from domain import pool_options

    rows = [
        {
            "id": "a",
            "seller_id": "a",
            "material_id": "pet",
            "grade": "clean_sorted",
            "intent": "recycle",
            "unit": "kg",
            "available": 30,
            "price": 10,
            "latitude": 0,
            "longitude": -0.2,
            "distance_km": 22.24,
        },
        {
            "id": "b",
            "seller_id": "b",
            "material_id": "pet",
            "grade": "clean_sorted",
            "intent": "recycle",
            "unit": "kg",
            "available": 30,
            "price": 10,
            "latitude": 0,
            "longitude": 0.2,
            "distance_km": 22.24,
        },
    ]
    assert pool_options(rows, 50, (0, 0), 30, 12, 40, None, None) == []


def test_classification_without_a_model_configured(client):
    """With no key the keyword rules answer, and the photo route says so plainly."""
    assert client.get("/api/health").json()["classification"] == "rules"
    assert client.post("/api/classify", json={"text": "stretch wrap"}).status_code == 401
    r = client.post(
        "/api/classify", headers=auth(client, "s1"), json={"text": "stretch wrap"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["method"] == "rules"
    assert [s["id"] for s in r.json()["suggestions"]] == ["ldpe"]
    assert r.json()["needs_confirmation"] is True

    buf = io.BytesIO()
    Image.new("RGB", (20, 20)).save(buf, format="JPEG")
    files = {"file": ("m.jpg", buf.getvalue(), "image/jpeg")}
    assert client.post("/api/evidence", files=files, data={"kind": "photo"}).status_code == 401
    r = client.post("/api/classify/image", headers=auth(client, "s1"), files=files)
    assert r.status_code == 503
    assert "not configured" in r.json()["detail"]


def test_model_output_is_validated_against_the_taxonomy(client):
    """A provider answer is never trusted as given."""
    import ai

    assert ai._clean_ids(["pet", "unobtainium", "PET", 7, None]) == ["pet"]
    assert ai._clean_ids("pet") == []
    assert ai._clean_ids(["pallet", "pet"]) == ["pet", "pallet"]  # taxonomy order
    assert ai._clean_number(-5, "kg") is None
    assert ai._clean_number(0, "kg") is None
    assert ai._clean_number(2_000_000, "kg") is None
    assert ai._clean_number(1.5, "piece") is None       # pallets are whole
    assert ai._clean_number(True, "kg") is None          # bools are not quantities
    assert ai._clean_number(12.3456, "kg") == 12.346


def test_an_account_chooses_what_it_came_here_to_do(client):
    """Buyer, supplier or both is picked at registration and changeable after."""
    email = f"{uuid.uuid4().hex}@example.test"
    r = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "a-long-enough-password",
            "name": "Role Test Works",
            "kind": "buyer",
            "city": "Mehsana",
            "latitude": 23.588,
            "longitude": 72.369,
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["kind"] == "buyer"
    head = {"Authorization": "Bearer " + r.json()["token"]}

    # A collect-only account is told why it cannot list, not handed a 500.
    r = client.post(
        "/api/listings",
        headers=head,
        json={"title": "Spare film", "material_id": "ldpe", "quantity": 5, "price": 10},
    )
    assert r.status_code == 403, r.text
    assert "collect" in r.json()["detail"]

    # ...and the mirror image: a generator cannot send collection requests.
    lid = listing(client)
    r = client.post("/api/me/kind", headers=head, json={"kind": "supplier"})
    assert r.status_code == 200, r.text
    r = client.post(
        "/api/exchanges",
        headers=head,
        json={
            "items": [{"listing_id": lid, "quantity": 1}],
            "pickup": "Our truck, Friday",
            "idempotency_key": uuid.uuid4().hex,
        },
    )
    assert r.status_code == 403, r.text
    assert "supply" in r.json()["detail"]

    # Businesses that end up with surplus of their own can say so.
    r = client.post("/api/me/kind", headers=head, json={"kind": "both"})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "both"
    r = client.post(
        "/api/listings",
        headers=head,
        json={"title": "Spare film", "material_id": "ldpe", "quantity": 5, "price": 10},
    )
    assert r.status_code == 200, r.text

    # Nothing outside the three is accepted.
    assert client.post("/api/me/kind", headers=head, json={"kind": "admin"}).status_code == 422
