import json

from django.http import HttpRequest, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt

from .lib.analysis import analyze_scenario, optimize_scenario
from .lib.csv_parser import parse_camera_csv
from .lib.errors import HttpError
from .lib.osm import fetch_osm_buildings
from .lib.repository import (
    create_region,
    create_scenario,
    get_building_feature_rows,
    get_buildings,
    get_region,
    get_scenario,
    list_regions,
    list_scenarios,
    upsert_buildings,
)
from .lib.validation import normalize_bounds, normalize_camera_input, number_in_range, positive_number


def index(request: HttpRequest):
    return render(request, "blindspot/index.html")


def health(request: HttpRequest):
    return json_response({"ok": True})


@csrf_exempt
def regions(request: HttpRequest):
    if request.method == "GET":
        return json_response(list_regions())
    if request.method == "POST":
        data = parse_json_body(request)
        bounds = normalize_bounds(data)
        name = str(data.get("name") or "Region").strip() or "Region"
        return json_response(create_region(name, bounds), status=201)
    return method_not_allowed()


@csrf_exempt
def import_buildings(request: HttpRequest, region_id: int):
    if request.method != "POST":
        return method_not_allowed()
    region = get_region(region_id)
    buildings = fetch_osm_buildings(region)
    upsert_buildings(region["id"], buildings)
    return json_response({"imported": len(buildings), "buildings": get_buildings(region["id"])})


@csrf_exempt
def scenarios(request: HttpRequest, region_id: int):
    if request.method == "GET":
        return json_response(list_scenarios(region_id))
    if request.method == "POST":
        data = parse_json_body(request)
        cameras = [normalize_camera_input(camera) for camera in data.get("cameras", [])]
        if not cameras:
            raise HttpError(400, "At least one camera is required.")
        return json_response(create_scenario(region_id, str(data.get("name") or "Manual camera set").strip(), "db", cameras), status=201)
    return method_not_allowed()


@csrf_exempt
def upload_csv(request: HttpRequest, region_id: int):
    if request.method != "POST":
        return method_not_allowed()
    name = request.GET.get("name", "CSV camera set").strip() or "CSV camera set"
    cameras = parse_camera_csv(request.body.decode("utf-8"))
    return json_response(create_scenario(region_id, name, "csv", cameras), status=201)


@csrf_exempt
def optimize(request: HttpRequest, region_id: int):
    if request.method != "POST":
        return method_not_allowed()
    data = parse_json_body(request)
    fov_deg = number_in_range(data.get("fov_deg"), 1, 360, "fov_deg")
    range_m = positive_number(data.get("range_m"), "range_m")
    max_cameras = int(number_in_range(data.get("max_cameras", 24), 1, 200, "max_cameras"))
    if not get_building_feature_rows(region_id):
        region = get_region(region_id)
        upsert_buildings(region["id"], fetch_osm_buildings(region))
    return json_response(optimize_scenario(region_id, fov_deg, range_m, max_cameras), status=201)


def scenario(request: HttpRequest, scenario_id: int):
    if request.method != "GET":
        return method_not_allowed()
    return json_response(get_scenario(scenario_id))


def buildings(request: HttpRequest, region_id: int):
    if request.method != "GET":
        return method_not_allowed()
    return json_response(get_buildings(region_id))


@csrf_exempt
def analyze(request: HttpRequest, scenario_id: int):
    if request.method != "POST":
        return method_not_allowed()
    return json_response(analyze_scenario(scenario_id))


def parse_json_body(request: HttpRequest) -> dict:
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise HttpError(400, "Invalid JSON body.") from exc


def json_response(payload, status=200):
    return JsonResponse(payload, status=status, safe=False)


def method_not_allowed():
    return json_response({"error": "Method not allowed."}, status=405)

# Create your views here.
