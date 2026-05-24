import json
from contextlib import contextmanager
from typing import Any

from django.db import connection, transaction

from .geo import feature_collection
from .errors import HttpError


@contextmanager
def cursor():
    with connection.cursor() as cur:
        yield cur


def rows_to_dicts(cur) -> list[dict[str, Any]]:
    columns = [column[0] for column in cur.description]
    return [dict(zip(columns, row, strict=False)) for row in cur.fetchall()]


def one_or_404(rows: list[dict], message: str) -> dict:
    if not rows:
        raise HttpError(404, message)
    return rows[0]


def list_regions() -> list[dict]:
    with cursor() as cur:
        cur.execute(
            """
            select id::int, name, north, south, east, west, created_at::text
            from regions
            order by case when name like 'Seeded %%' then 0 else 1 end, id asc
            """
        )
        return rows_to_dicts(cur)


def get_region(region_id: int) -> dict:
    with cursor() as cur:
        cur.execute(
            "select id::int, name, north, south, east, west, created_at::text from regions where id = %s",
            [region_id],
        )
        return one_or_404(rows_to_dicts(cur), "Region not found.")


def create_region(name: str, bounds: dict) -> dict:
    with cursor() as cur:
        cur.execute(
            """
            insert into regions (name, north, south, east, west, bbox)
            values (%s, %s, %s, %s, %s, ST_MakeEnvelope(%s, %s, %s, %s, 4326))
            returning id::int, name, north, south, east, west, created_at::text
            """,
            [
                name,
                bounds["north"],
                bounds["south"],
                bounds["east"],
                bounds["west"],
                bounds["west"],
                bounds["south"],
                bounds["east"],
                bounds["north"],
            ],
        )
        return rows_to_dicts(cur)[0]


def list_scenarios(region_id: int) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            """
            select cs.id::int, cs.region_id::int, cs.name, cs.source, cs.created_at::text, count(c.id)::int as camera_count
            from camera_sets cs
            left join cameras c on c.camera_set_id = cs.id
            where cs.region_id = %s
            group by cs.id
            order by cs.created_at desc
            """,
            [region_id],
        )
        return rows_to_dicts(cur)


def get_scenario(scenario_id: int) -> dict:
    with cursor() as cur:
        cur.execute(
            "select id::int, region_id::int, name, source, created_at::text from camera_sets where id = %s",
            [scenario_id],
        )
        return one_or_404(rows_to_dicts(cur), "Scenario not found.")


def create_scenario(region_id: int, name: str, source: str, cameras: list[dict]) -> dict:
    with transaction.atomic():
        with cursor() as cur:
            cur.execute(
                """
                insert into camera_sets (region_id, name, source)
                values (%s, %s, %s)
                returning id::int, region_id::int, name, source, created_at::text
                """,
                [region_id, name, source],
            )
            scenario = rows_to_dicts(cur)[0]
            for camera in cameras:
                cur.execute(
                    """
                    insert into cameras (camera_set_id, camera, lat, long, orientation_deg, fov_deg, range_m, geom)
                    values (%s, %s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
                    """,
                    [
                        scenario["id"],
                        camera["camera"],
                        camera["lat"],
                        camera["long"],
                        camera["orientation_deg"],
                        camera["fov_deg"],
                        camera["range_m"],
                        camera["long"],
                        camera["lat"],
                    ],
                )
            scenario["camera_count"] = len(cameras)
            return scenario


def get_cameras(scenario_id: int) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            """
            select id::int, camera, lat, long, orientation_deg, fov_deg, range_m
            from cameras
            where camera_set_id = %s
            order by id
            """,
            [scenario_id],
        )
        return rows_to_dicts(cur)


def get_camera_feature_collection(scenario_id: int) -> dict:
    with cursor() as cur:
        cur.execute(
            """
            select jsonb_build_object(
              'type', 'Feature',
              'properties', jsonb_build_object(
                'id', id::int,
                'camera', camera,
                'orientation_deg', orientation_deg,
                'fov_deg', fov_deg,
                'range_m', range_m
              ),
              'geometry', ST_AsGeoJSON(geom)::jsonb
            ) as feature
            from cameras
            where camera_set_id = %s
            order by id
            """,
            [scenario_id],
        )
        return feature_collection([row["feature"] for row in rows_to_dicts(cur)])


def get_building_feature_rows(region_id: int) -> list[dict]:
    with cursor() as cur:
        cur.execute(
            """
            select id::int, jsonb_build_object(
              'type', 'Feature',
              'properties', jsonb_build_object('id', id::int, 'tags', tags, 'source_osm_type', source_osm_type, 'source_osm_id', source_osm_id),
              'geometry', ST_AsGeoJSON(geom)::jsonb
            ) as feature
            from buildings
            where region_id = %s
            order by id
            """,
            [region_id],
        )
        return rows_to_dicts(cur)


def get_buildings(region_id: int) -> dict:
    return feature_collection([row["feature"] for row in get_building_feature_rows(region_id)])


def upsert_buildings(region_id: int, buildings: list[dict]) -> None:
    with cursor() as cur:
        for building in buildings:
            cur.execute(
                """
                insert into buildings (region_id, source_osm_type, source_osm_id, tags, geom)
                values (%s, %s, %s, %s::jsonb, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
                on conflict (region_id, source_osm_type, source_osm_id)
                do update set tags = excluded.tags, geom = excluded.geom, imported_at = now()
                """,
                [
                    region_id,
                    building["sourceType"],
                    building["sourceId"],
                    json.dumps(building["tags"]),
                    json.dumps(building["geometry"]),
                ],
            )


def create_analysis_run(data: dict) -> dict:
    with transaction.atomic():
        with cursor() as cur:
            cur.execute(
                """
                insert into analysis_runs (camera_set_id, region_id, ground_cell_size_m, coverage_geojson, wall_normals_geojson)
                values (%s, %s, %s, %s::jsonb, %s::jsonb)
                returning id::int, camera_set_id::int as scenario_id, created_at::text, ground_cell_size_m
                """,
                [
                    data["scenarioId"],
                    data["regionId"],
                    data["groundCellSizeM"],
                    json.dumps(data["coverage"]),
                    json.dumps(data["wallNormals"]),
                ],
            )
            run = rows_to_dicts(cur)[0]
            for feature in data["wallBlindspots"]["features"]:
                cur.execute(
                    """
                    insert into wall_blindspots (analysis_run_id, building_id, length_m, geom)
                    values (%s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
                    """,
                    [
                        run["id"],
                        feature.get("properties", {}).get("building_id"),
                        float(feature.get("properties", {}).get("length_m", 0)),
                        json.dumps(feature["geometry"]),
                    ],
                )
            for feature in data["groundBlindspots"]["features"]:
                cur.execute(
                    """
                    insert into ground_blindspots (analysis_run_id, geom)
                    values (%s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
                    """,
                    [run["id"], json.dumps(feature["geometry"])],
                )
            return run
