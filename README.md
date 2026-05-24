# cam_blindspot

CCTV coverage and blindspot analysis tool against OpenStreetMap building footprints.

The frontend uses [CesiumJS](https://cesium.com/platform/cesiumjs/) with a **top-down orthographic 3D scene** (`SceneMode.SCENE3D`) and OpenStreetMap tiles. The backend is Django with PostGIS/PostgreSQL.

## Camera Workflows

- Saved camera scenarios stored in PostGIS.
- CSV upload scenarios stored in PostGIS.
- Optimized placement scenarios generated from region bounds, camera FOV, range, and max camera count.

## Run locally with Docker

```bash
docker compose up --build
```

Open http://localhost:8000.

If port `8000` is already in use:

```bash
APP_PORT=8001 docker compose up --build
```

The compose stack starts:

- Django app on port `8000`
- PostGIS/PostgreSQL on port `5432`
- A persistent `postgis16-data` Docker volume

## SSH tunnel (acmvm)

If running on a remote host like acmvm:

```bash
ssh -L <local_port>:localhost:<remote_APP_PORT> acmvm
```

Example (remote on port 8001, forward to local port 8002):

```bash
ssh -L 8002:localhost:8001 acmvm
```

Then open http://localhost:8002.

See [docs/acmvm-deployment.md](docs/acmvm-deployment.md) for the full commit, pull, Docker rebuild, and port-forward procedure.

## Architecture

### Frontend (CesiumJS top-down map)

- `blindspot/static/blindspot/app.js` — Vanilla JS app shell with sidebar controls and CesiumJS `Viewer` in `SCENE3D` mode with an orthographic top-down camera.
- `blindspot/static/blindspot/styles.css` — Sidebar layout and map container styles.

CesiumJS static assets (workers, widgets CSS, images) are fetched via `scripts/fetch-cesium.sh` into `blindspot/static/vendor/cesium/` and served by Django's static file system at the `/static/vendor/cesium/` route. `window.CESIUM_BASE_URL` is set to `/static/vendor/cesium/` before Viewer initialization.

### Backend (Django + PostGIS)

- `blindspot/templates/blindspot/index.html` — Django template with sidebar/map HTML.
- `blindspot/views.py` — View handlers for regions, scenarios, buildings, analysis.
- `blindspot/lib/analysis.py` — Blindspot detection algorithm (wall segments, ground grid, camera FOV).
- `blindspot/lib/repository.py` — PostGIS queries for regions, scenarios, cameras, analysis runs.
- `blindspot/lib/osm.py` — OpenStreetMap Overpass API integration for building footprints.
- `blindspot/lib/geo.py` — Projection, bearing, polygon math, raycasting.
- `blindspot/lib/validation.py` — Input normalization.
- `blindspot/lib/csv_parser.py` — CSV camera parser.

## Map Layers

- Buildings are brown filled polygons with darker brown outlines.
- Camera FOV/range is shown as translucent blue wedge polygons.
- Cameras are yellow circular markers with a black orientation pointer on canvas billboards.
- Wall blindspots are thick dark red line segments on building exteriors.
- Outdoor ground blindspots are translucent red square cells.
- Wall normals are thin teal line segments pointing outward from exterior walls.

The analysis ignores building interiors as required coverage. Cameras only need to cover outdoor ground and outward-facing exterior wall segments; they do not need to see inside buildings.

## Tile Server

The map uses a tile server for base imagery. The URL is configured via the `TILE_SERVER_URL` environment variable.

### Option A: External tile server

Set `TILE_SERVER_URL` to any standard XYZ tile server URL with `{z}/{x}/{y}` placeholders:

```
TILE_SERVER_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

This is the default and works out of the box.

### Option B: Self-hosted Docker tile server

The docker-compose includes a `tileserver` service (profile `tileserver`) using [`overv/openstreetmap-tile-server`](https://github.com/Overv/openstreetmap-tile-server) with a local `.osm.pbf` file from `pbf_files/`.

First import your PBF data (one-time):

```bash
docker compose run --rm tileserver import
```

Then start with the tile server:

```bash
docker compose --profile tileserver up -d
```

The tile server runs on port `8080` (configurable via `TILESERVER_PORT`). Set the app's `TILE_SERVER_URL` accordingly:

```
TILE_SERVER_URL=http://localhost:8080/tile/{z}/{x}/{y}.png
```

## Seed Data

Docker startup runs `python manage.py seed` before starting the web server. The seed is idempotent.

Seeded regions:

- `Seeded Connaught Place`
- `Seeded Times Square`
- `Seeded Trafalgar Square`

For each region, the seed script:

- Creates or updates the region bounds.
- Fetches buildings from the public OpenStreetMap Overpass API.
- Stores returned OSM `way` and `relation` building footprints in PostGIS.
- Creates a larger sample camera scenario named `Seeded cameras`.

If Overpass has no building footprints for a region or is unavailable, the region and cameras are still seeded, and buildings can be imported later from the UI.

## Sample CSV

CSV columns:

```csv
camera,lat,long,orientation_deg,fov_deg,range_m
CP-CAM-01,28.63155,77.21735,92,80,230
CP-CAM-02,28.63270,77.21920,182,95,210
CP-CAM-03,28.63020,77.22095,315,85,240
CP-CAM-04,28.62970,77.21790,38,100,220
CP-CAM-05,28.63325,77.22135,230,75,260
```

Bearings are degrees clockwise from true north.

## Development

```bash
pip install -r requirements.txt   # or uv sync
python manage.py migrate          # Run database migrations
python manage.py seed             # Seed database with sample data
bash scripts/fetch-cesium.sh      # Download CesiumJS static assets
python manage.py runserver        # Start at localhost:8000
```

Set `DATABASE_URL` if running the app outside Docker:

```bash
DATABASE_URL=postgres://cam_blindspot:cam_blindspot@localhost:5432/cam_blindspot
```

## Tests

Tests are in Python alongside their modules:

| Test file | What it covers |
|-----------|---------------|
| Tests TBD — porting from bun test to pytest or Django test runner |

The original TypeScript test suite covered projection, CSV parsing, analysis, OSM fetching, and synthetic scenarios. These are being ported to Python.
