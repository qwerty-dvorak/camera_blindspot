import math
from dataclasses import dataclass
from typing import Any

LonLat = tuple[float, float]
Feature = dict[str, Any]
FeatureCollection = dict[str, Any]
Ring = list["Point"]
Polygon = list[Ring]
MultiPolygon = list[Polygon]

EARTH_RADIUS_M = 6_371_008.8
METERS_PER_DEGREE_LAT = 111_320


@dataclass
class Point:
    x: float
    y: float


@dataclass
class Segment:
    start: Point
    end: Point
    midpoint: Point
    normal: Point
    length: float


class Projector:
    def __init__(self, bounds: dict):
        self.origin_lat = (bounds["north"] + bounds["south"]) / 2
        self.origin_lon = (bounds["east"] + bounds["west"]) / 2
        cos_lat = math.cos(math.radians(self.origin_lat))
        self.meters_per_degree_lon = max(0.000001, METERS_PER_DEGREE_LAT * cos_lat)

    def to_xy(self, lon_lat: LonLat | list[float]) -> Point:
        lon, lat = lon_lat
        return Point((lon - self.origin_lon) * self.meters_per_degree_lon, (lat - self.origin_lat) * METERS_PER_DEGREE_LAT)

    def to_lon_lat(self, point: Point) -> list[float]:
        return [point.x / self.meters_per_degree_lon + self.origin_lon, point.y / METERS_PER_DEGREE_LAT + self.origin_lat]


def create_projector(bounds: dict) -> Projector:
    return Projector(bounds)


def feature_collection(features: list[Feature]) -> FeatureCollection:
    return {"type": "FeatureCollection", "features": features}


def camera_coverage_polygon(camera: dict, bounds: dict, step_degrees: float = 4) -> Feature:
    projector = create_projector(bounds)
    origin = projector.to_xy([camera["long"], camera["lat"]])
    half_fov = camera["fov_deg"] / 2
    steps = max(4, math.ceil(camera["fov_deg"] / step_degrees))
    coordinates = [[camera["long"], camera["lat"]]]
    for index in range(steps + 1):
        bearing = camera["orientation_deg"] - half_fov + (camera["fov_deg"] * index) / steps
        coordinates.append(projector.to_lon_lat(point_from_bearing(origin, bearing, camera["range_m"])))
    coordinates.append([camera["long"], camera["lat"]])
    return {
        "type": "Feature",
        "properties": {
            "camera": camera["camera"],
            "orientation_deg": camera["orientation_deg"],
            "fov_deg": camera["fov_deg"],
            "range_m": camera["range_m"],
        },
        "geometry": {"type": "Polygon", "coordinates": [coordinates]},
    }


def point_from_bearing(origin: Point, bearing_degrees: float, distance_meters: float) -> Point:
    radians = math.radians(bearing_degrees)
    return Point(origin.x + math.sin(radians) * distance_meters, origin.y + math.cos(radians) * distance_meters)


def bearing_from_north(start: Point, end: Point) -> float:
    return normalize_degrees(math.degrees(math.atan2(end.x - start.x, end.y - start.y)))


def normalize_degrees(value: float) -> float:
    return ((value % 360) + 360) % 360


def angular_difference(a: float, b: float) -> float:
    return abs(((a - b + 540) % 360) - 180)


def distance(a: Point, b: Point) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def ring_area(ring: Ring) -> float:
    total = 0.0
    for index in range(len(ring) - 1):
        current = ring[index]
        nxt = ring[index + 1]
        total += current.x * nxt.y - nxt.x * current.y
    return total / 2


def wall_segments_for_polygon(polygon: Polygon) -> list[Segment]:
    outer = polygon[0] if polygon else []
    is_counter_clockwise = ring_area(outer) > 0
    segments = []
    for index in range(len(outer) - 1):
        start = outer[index]
        end = outer[index + 1]
        dx = end.x - start.x
        dy = end.y - start.y
        length = math.hypot(dx, dy)
        if length < 0.01:
            continue
        normal = Point(dy / length, -dx / length) if is_counter_clockwise else Point(-dy / length, dx / length)
        segments.append(Segment(start, end, Point((start.x + end.x) / 2, (start.y + end.y) / 2), normal, length))
    return segments


def feature_to_multi_polygon(feature: Feature, projector: Projector) -> MultiPolygon:
    geometry = feature.get("geometry")
    if not geometry:
        return []
    if geometry["type"] == "Polygon":
        return [coordinates_to_polygon(geometry["coordinates"], projector)]
    if geometry["type"] == "MultiPolygon":
        return [coordinates_to_polygon(polygon, projector) for polygon in geometry["coordinates"]]
    return []


def coordinates_to_polygon(coordinates: list, projector: Projector) -> Polygon:
    return [[projector.to_xy(coord) for coord in ring] for ring in coordinates]


def point_in_polygon(point: Point, polygon: Polygon) -> bool:
    outer = polygon[0] if polygon else None
    if not outer or not point_in_ring(point, outer):
        return False
    return not any(point_in_ring(point, hole) for hole in polygon[1:])


def point_in_multi_polygons(point: Point, polygons: list[MultiPolygon]) -> bool:
    return any(any(point_in_polygon(point, polygon) for polygon in multi) for multi in polygons)


def point_in_ring(point: Point, ring: Ring) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        current = ring[i]
        previous = ring[j]
        intersects = (current.y > point.y) != (previous.y > point.y) and point.x < (
            (previous.x - current.x) * (point.y - current.y) / (previous.y - current.y) + current.x
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def segment_intersects_polygons(start: Point, end: Point, polygons: list[MultiPolygon], ignore_endpoint: Point | None = None) -> bool:
    for multi in polygons:
        for polygon in multi:
            for ring in polygon:
                for index in range(len(ring) - 1):
                    intersection = segment_intersection(start, end, ring[index], ring[index + 1])
                    if not intersection:
                        continue
                    if ignore_endpoint and distance(intersection, ignore_endpoint) < 0.5:
                        continue
                    if distance(intersection, start) < 0.5 or distance(intersection, end) < 0.5:
                        continue
                    return True
    return False


def segment_intersection(a: Point, b: Point, c: Point, d: Point) -> Point | None:
    denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x)
    if abs(denominator) < 1e-9:
        return None
    t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / denominator
    u = -((a.x - b.x) * (a.y - c.y) - (a.y - b.y) * (a.x - c.x)) / denominator
    if t < 0 or t > 1 or u < 0 or u > 1:
        return None
    return Point(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y))


def bbox_polygon(bounds: dict) -> Feature:
    return {
        "type": "Feature",
        "properties": {},
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [bounds["west"], bounds["south"]],
                    [bounds["east"], bounds["south"]],
                    [bounds["east"], bounds["north"]],
                    [bounds["west"], bounds["north"]],
                    [bounds["west"], bounds["south"]],
                ]
            ],
        },
    }
