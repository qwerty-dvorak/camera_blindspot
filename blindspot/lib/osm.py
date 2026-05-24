import os
from typing import Any

import requests


def fetch_osm_buildings(bounds: dict) -> list[dict]:
    query = f"""
    [out:json][timeout:25];
    (
      way["building"]({bounds["south"]},{bounds["west"]},{bounds["north"]},{bounds["east"]});
      relation["building"]({bounds["south"]},{bounds["west"]},{bounds["north"]},{bounds["east"]});
    );
    out body;
    >;
    out skel qt;
    """
    response = requests.post(
        os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
        data={"data": query},
        headers={"user-agent": "camera-blindspot/0.1 (+https://github.com/qwerty-dvorak/camera_blindspot)"},
        timeout=45,
    )
    response.raise_for_status()
    return parse_overpass_buildings(response.json().get("elements", []))


def parse_overpass_buildings(elements: list[dict[str, Any]]) -> list[dict]:
    nodes = {}
    ways = {}
    buildings = []
    for element in elements:
        if element.get("type") == "node" and "lat" in element and "lon" in element:
            nodes[element["id"]] = [element["lon"], element["lat"]]
        elif element.get("type") == "way":
            ways[element["id"]] = element

    for way in ways.values():
        if not way.get("tags", {}).get("building") or not way.get("nodes"):
            continue
        ring = nodes_for_way(way, nodes)
        if not ring or not is_closed_ring(ring):
            continue
        buildings.append(
            {
                "sourceType": "way",
                "sourceId": str(way["id"]),
                "tags": way.get("tags", {}),
                "geometry": {"type": "MultiPolygon", "coordinates": [[ring]]},
            }
        )

    for relation in [element for element in elements if element.get("type") == "relation" and element.get("tags", {}).get("building")]:
        outer_ways = [
            ways[member["ref"]]
            for member in relation.get("members", [])
            if member.get("type") == "way" and member.get("role") != "inner" and member.get("ref") in ways
        ]
        rings = stitch_outer_rings(outer_ways, nodes)
        if rings:
            buildings.append(
                {
                    "sourceType": "relation",
                    "sourceId": str(relation["id"]),
                    "tags": relation.get("tags", {}),
                    "geometry": {"type": "MultiPolygon", "coordinates": [[ring] for ring in rings]},
                }
            )
    return buildings


def nodes_for_way(way: dict, nodes: dict) -> list[list[float]] | None:
    coordinates = [nodes.get(node_id) for node_id in way.get("nodes", [])]
    if any(coord is None for coord in coordinates):
        return None
    return coordinates


def stitch_outer_rings(ways: list[dict], nodes: dict) -> list[list[list[float]]]:
    remaining = [ring for way in ways if (ring := nodes_for_way(way, nodes)) and len(ring) >= 2]
    rings = [ring for ring in remaining if is_closed_ring(ring)]
    open_rings = [ring for ring in remaining if not is_closed_ring(ring)]
    while open_rings:
        current = open_rings.pop(0)
        changed = True
        while not is_closed_ring(current) and changed:
            changed = False
            for index, candidate in enumerate(open_rings):
                merged = try_merge(current, candidate)
                if merged:
                    current = merged
                    open_rings.pop(index)
                    changed = True
                    break
        if is_closed_ring(current):
            rings.append(current)
    return rings


def try_merge(a: list, b: list) -> list | None:
    a_start = coord_key(a[0])
    a_end = coord_key(a[-1])
    b_start = coord_key(b[0])
    b_end = coord_key(b[-1])
    if a_end == b_start:
        return [*a, *b[1:]]
    if a_end == b_end:
        return [*a, *reversed(b[:-1])]
    if a_start == b_end:
        return [*b, *a[1:]]
    if a_start == b_start:
        return [*reversed(b), *a[1:]]
    return None


def is_closed_ring(ring: list) -> bool:
    return len(ring) >= 4 and coord_key(ring[0]) == coord_key(ring[-1])


def coord_key(coord: list[float]) -> str:
    return f"{coord[0]:.7f},{coord[1]:.7f}"
