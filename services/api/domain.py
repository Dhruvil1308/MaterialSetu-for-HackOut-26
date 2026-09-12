"""Pure, deterministic material matching and transparent transport estimates."""

import math
import re
from itertools import combinations

TAXONOMY = [
    {
        "id": "pet",
        "name": "PET plastic",
        "category": "Plastic",
        "unit": "kg",
        "aliases": ["pet", "bottles", "polyethylene terephthalate"],
        "uses": ["Polyester fibre feedstock", "PET recycling"],
        "note": "Resin and contamination must be confirmed. No food-contact suitability is implied.",
    },
    {
        "id": "hdpe",
        "name": "HDPE plastic",
        "category": "Plastic",
        "unit": "kg",
        "aliases": ["hdpe", "rigid plastic", "high density polyethylene"],
        "uses": ["Non-food containers", "Recycled plastic products"],
        "note": "Confirm resin, previous contents and processor acceptance.",
    },
    {
        "id": "ldpe",
        "name": "LDPE film",
        "category": "Plastic",
        "unit": "kg",
        "aliases": ["ldpe", "film", "stretch wrap", "polyethylene film"],
        "uses": ["Recycled film feedstock", "Protective packaging"],
        "note": "Keep clean film separate from contaminated and mixed polymers.",
    },
    {
        "id": "pp",
        "name": "PP plastic",
        "category": "Plastic",
        "unit": "kg",
        "aliases": ["pp", "polypropylene"],
        "uses": ["Recycled plastic products", "Industrial packaging"],
        "note": "Confirm grade and processor requirements before purchase.",
    },
    {
        "id": "cardboard",
        "name": "Corrugated cardboard",
        "category": "Paper",
        "unit": "kg",
        "aliases": ["cardboard", "corrugated", "paper", "carton"],
        "uses": ["Paper recycling", "Protective packing"],
        "note": "Dry, clean cardboard is preferred. Dimensions are needed for box reuse.",
    },
    {
        "id": "pallet",
        "name": "Wooden pallets",
        "category": "Wood",
        "unit": "piece",
        "aliases": ["pallet", "wooden", "wood"],
        "uses": ["Warehouse handling", "Repair and reuse"],
        "note": "Inspect damage and confirm load capacity; this listing does not certify it.",
    },
]


def material(mid):
    return next((m for m in TAXONOMY if m["id"] == mid), None)


def parse_query(text):
    text = text.lower().strip()
    amount = re.search(
        r"(-?\d+(?:\.\d+)?)\s*(kg|kgs|kilograms?|pieces?|pallets?)\b", text
    )
    matched = [
        m["id"]
        for m in TAXONOMY
        if any(re.search(r"\b" + re.escape(a) + r"s?\b", text) for a in m["aliases"])
    ]
    if not matched and "plastic" in text:
        matched = ["pet", "hdpe", "ldpe", "pp"]
    if not matched:
        matched = [
            m["id"]
            for m in TAXONOMY
            if any(w in text for u in m["uses"] for w in [u.lower()])
        ]
    unit = "piece" if amount and amount[2].startswith(("piece", "pallet")) else "kg"
    radius = re.search(r"(?:within|radius)\s*(\d+(?:\.\d+)?)\s*km", text)
    return {
        "material_ids": matched,
        "quantity": float(amount[1]) if amount else None,
        "unit": unit if amount else ("piece" if matched == ["pallet"] else None),
        "radius_km": float(radius[1]) if radius else None,
        "method": "rules",
        "clarification": (
            None if matched else "Choose a material category or try “50 kg plastic”."
        ),
    }


def haversine(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    return (
        6371
        * 2
        * math.asin(
            min(
                1,
                math.sqrt(
                    math.sin(dlat / 2) ** 2
                    + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
                ),
            )
        )
    )


def pool_options(
    rows, quantity, origin, radius, rate, stop_fee, max_transport, max_unit_price
):
    """Bounded heuristic. Same material/grade/intent/unit; buyer AND pairwise radius.
    Route is a straight-line nearest-neighbour round trip times 1.3, not a road quote.
    """
    groups = {}
    for row in rows:
        if row["distance_km"] <= radius and row["available"] > 0:
            groups.setdefault(
                (row["material_id"], row["grade"], row["intent"], row["unit"]), []
            ).append(row)
    options = []
    for key, candidates in groups.items():
        candidates = sorted(candidates, key=lambda r: (r["distance_km"], r["price"]))[
            :15
        ]
        for n in range(1, min(4, len(candidates)) + 1):
            for combo in combinations(candidates, n):
                if sum(r["available"] for r in combo) + 1e-8 < quantity:
                    continue
                if any(
                    haversine(
                        (a["latitude"], a["longitude"]), (b["latitude"], b["longitude"])
                    )
                    > radius
                    for a, b in combinations(combo, 2)
                ):
                    continue
                selected = []
                remaining = quantity
                for r in sorted(combo, key=lambda r: (r["price"], r["distance_km"])):
                    take = min(remaining, r["available"])
                    if take > 0:
                        selected.append({**r, "take": round(take, 3)})
                    remaining = round(remaining - take, 3)
                remaining_stops = {
                    r["seller_id"]: (r["latitude"], r["longitude"]) for r in selected
                }
                distance = 0
                pos = origin
                route = []
                while remaining_stops:
                    sid = min(
                        remaining_stops,
                        key=lambda sid: haversine(pos, remaining_stops[sid]),
                    )
                    loc = remaining_stops.pop(sid)
                    distance += haversine(pos, loc)
                    pos = loc
                    route.append(sid)
                distance += haversine(pos, origin)
                route_km = round(distance * 1.3, 2)
                transport = round(route_km * rate + len(route) * stop_fee, 2)
                cost = round(sum(r["take"] * r["price"] for r in selected), 2)
                landed = round(cost + transport, 2)
                if max_transport is not None and transport > max_transport:
                    continue
                if max_unit_price is not None and landed > quantity * max_unit_price:
                    continue
                options.append(
                    {
                        "material_id": key[0],
                        "grade": key[1],
                        "intent": key[2],
                        "unit": key[3],
                        "quantity": quantity,
                        "items": selected,
                        "supplier_count": len(route),
                        "route": route,
                        "estimated_route_km": route_km,
                        "material_cost": cost,
                        "transport_cost": transport,
                        "total_cost": landed,
                        "cost_per_unit": round(landed / quantity, 2),
                        "estimate_note": "Illustrative round-trip estimate: straight-line route × 1.3, plus loading per stop. Confirm a transporter quote.",
                    }
                )
    dedup = {
        tuple(sorted((r["id"], r["take"]) for r in o["items"])): o for o in options
    }
    return sorted(dedup.values(), key=lambda o: (o["total_cost"], o["supplier_count"]))[
        :5
    ]
