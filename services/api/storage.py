"""Where uploaded evidence is kept.

A container filesystem does not survive a restart, so a photo written there
outlives its database row by only as long as the instance lives. The row then
points at a file that no longer exists and the listing shows broken evidence.

With SUPABASE_URL and SUPABASE_SERVICE_KEY set, objects go to a private Supabase
Storage bucket instead. Without them everything falls back to UPLOAD_DIR exactly
as before, which is what local development and the tests use.

The bucket is private on purpose. Files are fetched by the API using the service
key and passed on only after the permission checks in main.py have run, so a
weighing slip is never reachable by URL alone.
"""

import os
from pathlib import Path

import httpx

URL = os.getenv("SUPABASE_URL", "").rstrip("/")
KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
BUCKET = os.getenv("SUPABASE_BUCKET", "evidence")
TIMEOUT = float(os.getenv("SUPABASE_STORAGE_TIMEOUT", "20"))
LOCAL = Path(os.getenv("UPLOAD_DIR", "./uploads"))

# One client for the process. A new connection per object costs a TLS handshake
# to the storage region, which measured three to six times the transfer itself.
_client = httpx.Client(timeout=TIMEOUT, limits=httpx.Limits(max_keepalive_connections=8))


def remote():
    return bool(URL and KEY)


def describe():
    return f"supabase:{BUCKET}" if remote() else "local"


def _auth():
    return {"apikey": KEY, "Authorization": "Bearer " + KEY}


def _object(name):
    return f"{URL}/storage/v1/object/{BUCKET}/{name}"


def put(name, raw, mime):
    """Store one object. Raises if it could not be stored, so the caller can
    refuse the upload rather than record a row pointing at nothing."""
    if not remote():
        LOCAL.mkdir(parents=True, exist_ok=True)
        (LOCAL / name).write_bytes(raw)
        return
    r = _client.post(
        _object(name),
        headers={**_auth(), "Content-Type": mime, "x-upsert": "true"},
        content=raw,
    )
    if r.status_code >= 300:
        raise RuntimeError(f"storage upload failed: {r.status_code} {r.text[:200]}")


def get(name):
    """The object's bytes, or None if it is not there."""
    if not remote():
        path = LOCAL / name
        return path.read_bytes() if path.exists() else None
    try:
        r = _client.get(_object(name), headers=_auth())
    except Exception:
        return None
    return r.content if r.status_code == 200 else None


def missing(names):
    """Which of these names are not stored yet, in one round trip."""
    names = list(names)
    if not remote():
        return [n for n in names if not (LOCAL / n).exists()]
    try:
        r = _client.post(
            f"{URL}/storage/v1/object/list/{BUCKET}",
            headers={**_auth(), "Content-Type": "application/json"},
            json={"prefix": "", "limit": 1000},
        )
        if r.status_code != 200:
            return names
        present = {o.get("name") for o in r.json()}
    except Exception:
        return names
    return [n for n in names if n not in present]
