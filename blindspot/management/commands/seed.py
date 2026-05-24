from django.core.management.base import BaseCommand

from blindspot.lib.osm import fetch_osm_buildings
from blindspot.lib.repository import create_scenario, get_building_feature_rows, list_regions, upsert_buildings
from blindspot.lib.repository import create_region


SEED_REGIONS = [
    {
        "name": "Seeded Connaught Place",
        "north": 28.6342,
        "south": 28.6287,
        "east": 77.2224,
        "west": 77.216,
        "cameras": [
            {"camera": "CP-CAM-01", "lat": 28.63155, "long": 77.21735, "orientation_deg": 92, "fov_deg": 80, "range_m": 230},
            {"camera": "CP-CAM-02", "lat": 28.6327, "long": 77.2192, "orientation_deg": 182, "fov_deg": 95, "range_m": 210},
            {"camera": "CP-CAM-03", "lat": 28.6302, "long": 77.22095, "orientation_deg": 315, "fov_deg": 85, "range_m": 240},
            {"camera": "CP-CAM-04", "lat": 28.6297, "long": 77.2179, "orientation_deg": 38, "fov_deg": 100, "range_m": 220},
            {"camera": "CP-CAM-05", "lat": 28.63325, "long": 77.22135, "orientation_deg": 230, "fov_deg": 75, "range_m": 260},
        ],
    },
    {
        "name": "Seeded Times Square",
        "north": 40.7606,
        "south": 40.7554,
        "east": -73.9822,
        "west": -73.9894,
        "cameras": [
            {"camera": "TS-CAM-01", "lat": 40.7589, "long": -73.9872, "orientation_deg": 55, "fov_deg": 85, "range_m": 260},
            {"camera": "TS-CAM-02", "lat": 40.7568, "long": -73.9854, "orientation_deg": 25, "fov_deg": 70, "range_m": 240},
            {"camera": "TS-CAM-03", "lat": 40.7598, "long": -73.9845, "orientation_deg": 205, "fov_deg": 90, "range_m": 230},
            {"camera": "TS-CAM-04", "lat": 40.7572, "long": -73.9829, "orientation_deg": 285, "fov_deg": 95, "range_m": 250},
            {"camera": "TS-CAM-05", "lat": 40.7601, "long": -73.9884, "orientation_deg": 122, "fov_deg": 80, "range_m": 280},
        ],
    },
    {
        "name": "Seeded Trafalgar Square",
        "north": 51.5104,
        "south": 51.5066,
        "east": -0.1242,
        "west": -0.1306,
        "cameras": [
            {"camera": "TR-CAM-01", "lat": 51.5082, "long": -0.1294, "orientation_deg": 82, "fov_deg": 85, "range_m": 220},
            {"camera": "TR-CAM-02", "lat": 51.5095, "long": -0.1272, "orientation_deg": 172, "fov_deg": 90, "range_m": 200},
            {"camera": "TR-CAM-03", "lat": 51.5075, "long": -0.1253, "orientation_deg": 306, "fov_deg": 85, "range_m": 230},
            {"camera": "TR-CAM-04", "lat": 51.5089, "long": -0.1248, "orientation_deg": 248, "fov_deg": 75, "range_m": 210},
        ],
    },
]


class Command(BaseCommand):
    help = "Seed demo regions and camera scenarios."

    def handle(self, *args, **options):
        existing = {region["name"]: region for region in list_regions()}
        for seed in SEED_REGIONS:
            region = existing.get(seed["name"]) or create_region(seed["name"], seed)
            if not get_building_feature_rows(region["id"]):
                try:
                    upsert_buildings(region["id"], fetch_osm_buildings(region))
                except Exception as exc:
                    self.stderr.write(f"OSM import skipped for {region['name']}: {exc}")
            create_scenario(region["id"], "Seeded cameras", "db", seed["cameras"])
            self.stdout.write(f"seeded region {region['id']}: {region['name']}")
