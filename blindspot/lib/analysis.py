import math
from datetime import datetime
from typing import Any

from .geo import (
    Point,
    angular_difference,
    bearing_from_north,
    camera_coverage_polygon,
    create_projector,
    distance,
    feature_collection,
    feature_to_multi_polygon,
    point_in_multi_polygons,
    segment_intersects_polygons,
    wall_segments_for_polygon,
)
from .repository import (
    create_analysis_run,
    create_scenario,
    get_building_feature_rows,
    get_buildings,
    get_camera_feature_collection,
    get_cameras,
    get_region,
    get_scenario,
)


def analyze_scenario(scenario_id: int) -> dict:
    scenario = get_scenario(scenario_id)
    region = get_region(scenario["region_id"])
    cameras = get_cameras(scenario_id)
    layers = build_analysis_layers(region, scenario_id, cameras, persist=True)
    return {**layers, "scenario": scenario, "cameras": get_camera_feature_collection(scenario_id)}


def optimize_scenario(region_id: int, fov_deg: float, range_m: float, max_cameras: int = 24) -> dict:
    region = get_region(region_id)
    building_rows = get_building_feature_rows(region["id"])
    building_features = [row["feature"] for row in building_rows]
    candidates = generate_candidates(region, building_features, fov_deg, range_m)
    selected = select_greedy_cameras(region, building_features, candidates, max_cameras)
    if not selected:
        raise ValueError("No feasible optimized camera placements were found for this region and range.")
    scenario = create_scenario(
        region["id"],
        f"Optimized {datetime.utcnow().isoformat(timespec='seconds').replace('T', ' ')}",
        "optimized",
        selected,
    )
    layers = build_analysis_layers(region, scenario["id"], selected, persist=True)
    return {**layers, "scenario": scenario, "cameras": get_camera_feature_collection(scenario["id"])}


def build_analysis_layers(region: dict, scenario_id: int, cameras: list[dict], persist: bool = False) -> dict:
    building_rows = get_building_feature_rows(region["id"])
    buildings = get_buildings(region["id"])
    projector = create_projector(region)
    building_polygons = [{"id": row["id"], "multiPolygon": feature_to_multi_polygon(row["feature"], projector)} for row in building_rows]
    all_building_polygons = [building["multiPolygon"] for building in building_polygons]
    coverage = feature_collection([camera_coverage_polygon(camera, region) for camera in cameras])
    wall_normals = build_wall_normals(region, building_polygons)
    wall_blindspots = build_wall_blindspots(region, cameras, building_polygons)
    ground = build_ground_blindspots(region, cameras, all_building_polygons)
    if persist:
        run = create_analysis_run(
            {
                "regionId": region["id"],
                "scenarioId": scenario_id,
                "groundCellSizeM": ground["cellSizeM"],
                "coverage": coverage,
                "wallNormals": wall_normals,
                "wallBlindspots": wall_blindspots,
                "groundBlindspots": ground["groundBlindspots"],
            }
        )
    else:
        run = {"id": 0, "scenario_id": scenario_id, "created_at": datetime.utcnow().isoformat(), "ground_cell_size_m": ground["cellSizeM"]}
    return {
        "analysis": run,
        "region": region,
        "buildings": buildings,
        "coverage": coverage,
        "wallNormals": wall_normals,
        "wallBlindspots": wall_blindspots,
        "groundBlindspots": ground["groundBlindspots"],
    }


def build_wall_normals(region: dict, buildings: list[dict]) -> dict:
    projector = create_projector(region)
    features = []
    for building in buildings:
        for polygon in building["multiPolygon"]:
            for segment in wall_segments_for_polygon(polygon):
                length = min(12, max(5, segment.length * 0.25))
                normal_end = Point(segment.midpoint.x + segment.normal.x * length, segment.midpoint.y + segment.normal.y * length)
                features.append(
                    {
                        "type": "Feature",
                        "properties": {"building_id": building["id"], "length_m": segment.length},
                        "geometry": {"type": "LineString", "coordinates": [projector.to_lon_lat(segment.midpoint), projector.to_lon_lat(normal_end)]},
                    }
                )
    return feature_collection(features)


def build_wall_blindspots(region: dict, cameras: list[dict], buildings: list[dict]) -> dict:
    projector = create_projector(region)
    all_building_polygons = [building["multiPolygon"] for building in buildings]
    camera_points = [{"camera": camera, "point": projector.to_xy([camera["long"], camera["lat"]])} for camera in cameras]
    features = []
    for building in buildings:
        for polygon in building["multiPolygon"]:
            for segment in wall_segments_for_polygon(polygon):
                visible = False
                for camera_point in camera_points:
                    to_camera = Point(camera_point["point"].x - segment.midpoint.x, camera_point["point"].y - segment.midpoint.y)
                    camera_faces_wall = to_camera.x * segment.normal.x + to_camera.y * segment.normal.y > 0
                    if camera_faces_wall and camera_sees_point(camera_point["camera"], camera_point["point"], segment.midpoint, all_building_polygons, segment.midpoint):
                        visible = True
                        break
                if not visible:
                    features.append(
                        {
                            "type": "Feature",
                            "properties": {"building_id": building["id"], "length_m": segment.length},
                            "geometry": {"type": "LineString", "coordinates": [projector.to_lon_lat(segment.start), projector.to_lon_lat(segment.end)]},
                        }
                    )
    return feature_collection(features)


def build_ground_blindspots(region: dict, cameras: list[dict], buildings: list) -> dict:
    projector = create_projector(region)
    southwest = projector.to_xy([region["west"], region["south"]])
    northeast = projector.to_xy([region["east"], region["north"]])
    width = abs(northeast.x - southwest.x)
    height = abs(northeast.y - southwest.y)
    cell_size_m = max(25, math.ceil(math.sqrt((width * height) / 2200)))
    camera_points = [{"camera": camera, "point": projector.to_xy([camera["long"], camera["lat"]])} for camera in cameras]
    features = []
    min_x, max_x = sorted([southwest.x, northeast.x])
    min_y, max_y = sorted([southwest.y, northeast.y])
    x = min_x
    while x < max_x:
        y = min_y
        while y < max_y:
            center = Point(x + cell_size_m / 2, y + cell_size_m / 2)
            if not point_in_multi_polygons(center, buildings):
                covered = any(camera_sees_point(cp["camera"], cp["point"], center, buildings) for cp in camera_points)
                if not covered:
                    features.append(
                        {
                            "type": "Feature",
                            "properties": {"cell_size_m": cell_size_m},
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [
                                    [
                                        projector.to_lon_lat(Point(x, y)),
                                        projector.to_lon_lat(Point(x + cell_size_m, y)),
                                        projector.to_lon_lat(Point(x + cell_size_m, y + cell_size_m)),
                                        projector.to_lon_lat(Point(x, y + cell_size_m)),
                                        projector.to_lon_lat(Point(x, y)),
                                    ]
                                ],
                            },
                        }
                    )
            y += cell_size_m
        x += cell_size_m
    return {"groundBlindspots": feature_collection(features), "cellSizeM": cell_size_m}


def generate_candidates(region: dict, building_features: list[dict], fov_deg: float, range_m: float) -> list[dict]:
    projector = create_projector(region)
    buildings = [feature_to_multi_polygon(feature, projector) for feature in building_features]
    candidates: list[dict] = []
    seen = set()
    for multi in buildings:
        for polygon in multi:
            for segment in wall_segments_for_polygon(polygon):
                for setback in [8, min(range_m * 0.35, 35)]:
                    position = Point(segment.midpoint.x + segment.normal.x * setback, segment.midpoint.y + segment.normal.y * setback)
                    lon_lat = projector.to_lon_lat(position)
                    if not inside_bounds(lon_lat[0], lon_lat[1], region) or point_in_multi_polygons(position, buildings):
                        continue
                    orientation = bearing_from_north(position, segment.midpoint)
                    key = f"{lon_lat[0]:.5f},{lon_lat[1]:.5f},{round(orientation / 10) * 10}"
                    if key in seen:
                        continue
                    seen.add(key)
                    candidates.append(camera_input(f"OPT-{len(candidates) + 1}", lon_lat[1], lon_lat[0], orientation, fov_deg, range_m))

    southwest = projector.to_xy([region["west"], region["south"]])
    northeast = projector.to_xy([region["east"], region["north"]])
    spacing = max(20, range_m * 0.7)
    min_x, max_x = sorted([southwest.x, northeast.x])
    min_y, max_y = sorted([southwest.y, northeast.y])
    x = min_x + spacing / 2
    while x < max_x:
        y = min_y + spacing / 2
        while y < max_y:
            position = Point(x, y)
            if not point_in_multi_polygons(position, buildings):
                lon_lat = projector.to_lon_lat(position)
                for orientation in [0, 90, 180, 270]:
                    candidates.append(camera_input(f"OPT-{len(candidates) + 1}", lon_lat[1], lon_lat[0], orientation, fov_deg, range_m))
            y += spacing
        x += spacing
    return candidates[:1200]


def select_greedy_cameras(region: dict, building_features: list[dict], candidates: list[dict], max_cameras: int) -> list[dict]:
    targets = create_optimization_targets(region, building_features)
    selected: list[dict] = []
    uncovered = set(range(len(targets)))
    projector = create_projector(region)
    buildings = [feature_to_multi_polygon(feature, projector) for feature in building_features]
    while uncovered and len(selected) < max_cameras:
        best: dict[str, Any] | None = None
        for candidate in candidates:
            if any(camera["camera"] == candidate["camera"] for camera in selected):
                continue
            camera_point = projector.to_xy([candidate["long"], candidate["lat"]])
            covered = []
            for target_index in uncovered:
                target = targets[target_index]
                if target.get("normal"):
                    to_camera = Point(camera_point.x - target["point"].x, camera_point.y - target["point"].y)
                    if to_camera.x * target["normal"].x + to_camera.y * target["normal"].y <= 0:
                        continue
                if camera_sees_point(candidate, camera_point, target["point"], buildings, target["point"]):
                    covered.append(target_index)
            score = sum(targets[index]["weight"] for index in covered)
            if not best or score > best["score"]:
                best = {"camera": candidate, "score": score, "covered": covered}
        if not best or best["score"] <= 0:
            break
        selected.append({**best["camera"], "camera": f"OPT-{len(selected) + 1}"})
        uncovered.difference_update(best["covered"])
    return selected


def create_optimization_targets(region: dict, building_features: list[dict]) -> list[dict]:
    projector = create_projector(region)
    buildings = [feature_to_multi_polygon(feature, projector) for feature in building_features]
    targets = []
    for multi in buildings:
        for polygon in multi:
            for segment in wall_segments_for_polygon(polygon):
                targets.append({"point": segment.midpoint, "normal": segment.normal, "weight": max(1, segment.length / 10)})
    southwest = projector.to_xy([region["west"], region["south"]])
    northeast = projector.to_xy([region["east"], region["north"]])
    cell = max(20, math.ceil(math.sqrt((abs(northeast.x - southwest.x) * abs(northeast.y - southwest.y)) / 400)))
    min_x, max_x = sorted([southwest.x, northeast.x])
    min_y, max_y = sorted([southwest.y, northeast.y])
    x = min_x + cell / 2
    while x < max_x:
        y = min_y + cell / 2
        while y < max_y:
            point = Point(x, y)
            if not point_in_multi_polygons(point, buildings):
                targets.append({"point": point, "weight": 1})
            y += cell
        x += cell
    return targets


def camera_sees_point(camera: dict, camera_point: Point, target: Point, buildings: list, ignore_endpoint: Point | None = None) -> bool:
    if distance(camera_point, target) > camera["range_m"]:
        return False
    bearing = bearing_from_north(camera_point, target)
    if camera["fov_deg"] < 360 and angular_difference(bearing, camera["orientation_deg"]) > camera["fov_deg"] / 2:
        return False
    return not segment_intersects_polygons(camera_point, target, buildings, ignore_endpoint)


def inside_bounds(lon: float, lat: float, region: dict) -> bool:
    return region["west"] <= lon <= region["east"] and region["south"] <= lat <= region["north"]


def camera_input(name: str, lat: float, lon: float, orientation: float, fov_deg: float, range_m: float) -> dict:
    return {"camera": name, "lat": lat, "long": lon, "orientation_deg": orientation, "fov_deg": fov_deg, "range_m": range_m}
