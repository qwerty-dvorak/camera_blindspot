# cam_blindspot

CCTV coverage and blindspot analysis tool against OpenStreetMap building footprints.

The frontend uses [CesiumJS](https://cesium.com/platform/cesiumjs/) in **2D mode** (`SceneMode.SCENE2D`) with OpenStreetMap tiles. The backend is a Bun server with PostGIS/PostgreSQL.

## Camera Workflows

- Saved camera scenarios stored in PostGIS.
- CSV upload scenarios stored in PostGIS.
- Optimized placement scenarios generated from region bounds, camera FOV, range, and max camera count.

## Run locally with Docker

```bash
docker compose up --build
```

Open http://localhost:3000.

If port `3000` is already in use:

```bash
APP_PORT=3001 docker compose up --build
```

The compose stack starts:

- Bun app on port `3000`
- PostGIS/PostgreSQL on port `5432`
- A persistent `postgis16-data` Docker volume

## SSH tunnel (acmvm)

If running on a remote host like acmvm:

```bash
ssh -L <local_port>:localhost:<remote_APP_PORT> acmvm
```

Example (remote on port 3001, forward to local port 3002):

```bash
ssh -L 3002:localhost:3001 acmvm
```

Then open http://localhost:3002.

See [docs/acmvm-deployment.md](docs/acmvm-deployment.md) for the full commit, pull, Docker rebuild, and port-forward procedure.

## Architecture

### Frontend (CesiumJS 2D)

- `src/frontend/App.tsx` — React app shell with sidebar controls and CesiumJS `Viewer` in `SCENE2D` mode.
- `src/frontend/mapLayers.ts` — CesiumJS-compatible layer styles and GeoJSON helpers.
- `src/frontend/styles.css` — Sidebar layout and map container styles.

CesiumJS static assets (workers, widgets CSS, images) are served from `node_modules/cesium/Build/Cesium/` at the `/cesium/` route. `window.CESIUM_BASE_URL` is set to `/cesium/` before Viewer initialization.

### Backend (Bun + PostGIS)

- `index.ts` — Server entry point with API and static asset routes.
- `src/server/api.ts` — Request routing for regions, scenarios, buildings, analysis.
- `src/server/analysis.ts` — Blindspot detection algorithm (wall segments, ground grid, camera FOV).
- `src/server/repository.ts` — PostGIS queries for regions, scenarios, cameras, analysis runs.
- `src/server/osm.ts` — OpenStreetMap Overpass API integration for building footprints.
- `src/server/db.ts` — Database connection.
- `src/server/migrate.ts` — SQL migration runner.

### Shared

- `src/shared/geo.ts` — Projection, bearing, polygon math, raycasting.
- `src/shared/types.ts` — TypeScript types for API responses.
- `src/shared/validation.ts` — Input normalization.
- `src/shared/csv.ts` — CSV camera parser.

## Map Layers

- Buildings are brown filled polygons with darker brown outlines.
- Camera FOV/range is shown as translucent blue wedge polygons.
- Cameras are yellow circular markers with a black orientation pointer on canvas billboards.
- Wall blindspots are thick dark red line segments on building exteriors.
- Outdoor ground blindspots are translucent red square cells.
- Wall normals are thin teal line segments pointing outward from exterior walls.

The analysis ignores building interiors as required coverage. Cameras only need to cover outdoor ground and outward-facing exterior wall segments; they do not need to see inside buildings.

## Seed Data

Docker startup runs `bun run seed` before starting the web server. The seed is idempotent.

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
bun install
bun run dev        # Start with HMR at localhost:3000
bun run migrate    # Run pending SQL migrations
bun run seed       # Seed database with sample data
bun test           # Run tests
bun run build      # Server-side bundle
```

Set `DATABASE_URL` if running the app outside Docker:

```bash
DATABASE_URL=postgres://cam_blindspot:cam_blindspot@localhost:5432/cam_blindspot
```

## Tests

Tests are in `src/` alongside their modules:

| Test file | What it covers |
|-----------|---------------|
| `src/shared/geo.test.ts` | Projection, bearing, polygon normals |
| `src/shared/csv.test.ts` | CSV camera parsing |
| `src/frontend/mapLayers.test.ts` | Region polygon, CesiumJS color styles |
| `src/server/analysis.test.ts` | Wall normals, blindspot detection |
| `src/server/osm.test.ts` | Overpass fetching |
| `src/server/synthetic-cli.test.ts` | Synthetic rectangle scenario |
