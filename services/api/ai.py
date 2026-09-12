"""Optional model adapter for demand extraction and image category suggestions.

Built to the rules in docs/architecture.md: it sits on the API side, before
matching; every answer is validated back to the taxonomy; and it never touches
trust scores, GST status or inventory. Its output is always a *suggestion* that a
person confirms.

Without OPENAI_API_KEY the whole module reports itself unavailable and every
caller falls back to the keyword rules in domain.py, so the application works
exactly as before.
"""

import base64
import json
import os

import httpx

from domain import TAXONOMY, parse_query

ENDPOINT = "https://api.openai.com/v1/chat/completions"
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
TIMEOUT = float(os.getenv("OPENAI_TIMEOUT", "20"))
IDS = [m["id"] for m in TAXONOMY]

CATALOGUE = "\n".join(
    f"- {m['id']}: {m['name']} ({m['category']}, sold per {m['unit']}). "
    f"Also called: {', '.join(m['aliases'])}."
    for m in TAXONOMY
)


def enabled():
    return bool(os.getenv("OPENAI_API_KEY"))


def _ask(messages, max_tokens=300):
    """One call, returning parsed JSON or None. Never raises: a model outage
    must degrade to the keyword rules rather than fail a search."""
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return None
    try:
        r = httpx.post(
            ENDPOINT,
            headers={"Authorization": "Bearer " + key},
            json={
                "model": MODEL,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0,
                "response_format": {"type": "json_object"},
            },
            timeout=TIMEOUT,
        )
        if r.status_code != 200:
            return None
        return json.loads(r.json()["choices"][0]["message"]["content"])
    except Exception:
        return None


def _clean_ids(value):
    """Keep only ids that exist in the taxonomy, in taxonomy order, no repeats."""
    if not isinstance(value, list):
        return []
    picked = {v for v in value if isinstance(v, str) and v in IDS}
    return [i for i in IDS if i in picked]


def _clean_number(value, unit):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    if not (0 < value <= 1_000_000):
        return None
    if unit == "piece" and value != int(value):
        return None
    return round(float(value), 3)


DEMAND_RULES = f"""You read short buying requests for an Indian surplus packaging
exchange and return JSON. The requests may be in English, Hindi, Gujarati, or a
mix, and may be transliterated.

Only these materials exist:
{CATALOGUE}

Return exactly:
{{"material_ids": [ids in priority order],
  "quantity": number or null,
  "unit": "kg" or "piece" or null,
  "use": short English phrase or null,
  "radius_km": number or null,
  "clarification": short English question or null}}

Rules:
- Use only ids from the list. Never invent one.
- A generic word for plastic in ANY language means all four plastics. Offer them
  all rather than asking which one.
- Everyday words count: boxes, cartons and shipping boxes are cardboard; bottles
  are pet; milk or shampoo bottles are hdpe; wrap and film are ldpe.
- Wooden pallets are counted in pieces; everything else is weighed in kg.
- Set quantity only if the request states an amount. Never estimate one.
- Ask a question only when nothing in the request points at a material at all.
- Reply with JSON only.

Examples:
"50 kg PET"                       -> ["pet"], 50, "kg"
"plastic" / "પ્લાસ્ટિક" / "प्लास्टिक"     -> ["pet","hdpe","ldpe","pp"], null, "kg"
"old shipping boxes, 100kg"       -> ["cardboard"], 100, "kg"
"20 લાકડાના પેલેટ"                    -> ["pallet"], 20, "piece"
"stretch wrap rolls"              -> ["ldpe"], null, "kg"
"something for my garden"         -> [], null, null, clarification set"""


def extract_demand(text):
    """Structured demand from free text. Returns None to mean "use the rules"."""
    text = (text or "").strip()
    if not enabled() or not text:
        return None
    data = _ask(
        [
            {"role": "system", "content": DEMAND_RULES},
            {"role": "user", "content": text[:500]},
        ],
        max_tokens=200,
    )
    if not isinstance(data, dict):
        return None

    ids = _clean_ids(data.get("material_ids"))
    unit = data.get("unit") if data.get("unit") in ("kg", "piece") else None
    if ids and not unit:
        unit = "piece" if ids == ["pallet"] else "kg"
    quantity = _clean_number(data.get("quantity"), unit)
    radius = _clean_number(data.get("radius_km"), "kg")
    use = data.get("use") if isinstance(data.get("use"), str) else None
    clarification = (
        data.get("clarification") if isinstance(data.get("clarification"), str) else None
    )
    return {
        "material_ids": ids,
        "quantity": quantity,
        "unit": unit,
        "use": (use or "")[:80] or None,
        "radius_km": radius if radius and radius <= 100 else None,
        "method": "model",
        "clarification": None if ids else (clarification or "").strip()[:160] or None,
    }


def parse_demand(text):
    """Keyword rules first; the model only for what the rules could not read.

    Ordinary searches cost nothing and stay instant. A phrase the rules do not
    recognise - another language, an unusual wording - gets one model call.
    """
    parsed = parse_query(text)
    if parsed["material_ids"] or not (text or "").strip() or not enabled():
        return parsed
    return extract_demand(text) or parsed


IMAGE_RULES = f"""You look at a photograph of surplus packaging material at an
Indian business and suggest which catalogue categories it might be.

Only these categories exist:
{CATALOGUE}

Return exactly:
{{"material_ids": [ids, most likely first, at most 3],
  "confidence": "high" or "medium" or "low",
  "observed": one short English sentence describing only what is visible,
  "check": one short English sentence naming what the seller must confirm}}

Rules:
- Use only ids from the list. If nothing in the photo matches, return an empty
  list and say so in observed.
- A photograph cannot identify a polymer. Never state a resin as fact; say what
  it resembles and put resin confirmation in check.
- Never comment on cleanliness, food-contact suitability or value.
- Reply with JSON only."""


def suggest_from_image(raw, mime):
    """Candidate categories for a material photo. Always needs confirmation."""
    if not enabled():
        return None
    url = f"data:{mime};base64," + base64.b64encode(raw).decode()
    data = _ask(
        [
            {"role": "system", "content": IMAGE_RULES},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Which categories might this be?"},
                    {"type": "image_url", "image_url": {"url": url, "detail": "low"}},
                ],
            },
        ],
        max_tokens=250,
    )
    if not isinstance(data, dict):
        return None
    confidence = data.get("confidence")
    return {
        "material_ids": _clean_ids(data.get("material_ids"))[:3],
        "confidence": confidence if confidence in ("high", "medium", "low") else "low",
        "observed": str(data.get("observed") or "")[:200],
        "check": str(data.get("check") or "")[:200],
    }
