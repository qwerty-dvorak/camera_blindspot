# cam_blindspot

Dockerized Bun app for CCTV coverage and blindspot analysis against OpenStreetMap building footprints.

The app has three camera workflows:

- Saved camera scenarios stored in PostGIS.
- CSV upload scenarios stored in PostGIS.
- Optimized placement scenarios generated from only region bounds, camera FOV, camera range, and a max camera count.

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

## Workflows

- Create a region from north, south, east, and west coordinates.
- Import building footprints from OpenStreetMap Overpass into PostGIS.
- Analyze a saved camera scenario.
- Upload camera CSV and persist it as a scenario.
- Optimize camera placement from only FOV, range, max cameras, and region bounds.

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

The seed does not create synthetic hardcoded building rectangles. If Overpass has no building footprints for a region or is unavailable, the region and cameras are still seeded, and buildings can be imported later from the UI.

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

## Map Layers

- Buildings are brown filled polygons with darker brown outlines.
- Camera FOV/range is shown as translucent blue wedge polygons.
- Cameras are yellow circular markers with a black orientation pointer.
- Wall blindspots are thick dark red line segments on building exteriors.
- Outdoor ground blindspots are translucent red square cells.
- Wall normals are thin teal line segments pointing outward from exterior walls.

The analysis ignores building interiors as required coverage. Cameras only need to cover outdoor ground and outward-facing exterior wall segments; they do not need to see inside buildings.

## Bun commands

```bash
bun install
bun run dev
bun run migrate
bun run seed
bun run scenario:rectangle
bun test
bun run build
```

`bun run scenario:rectangle` runs a CLI-only synthetic square-region/rectangle-building example and prints wall/ground blindspot counts. The same geometry is covered by `bun test`.

Set `DATABASE_URL` if running the app outside Docker:

```bash
DATABASE_URL=postgres://cam_blindspot:cam_blindspot@localhost:5432/cam_blindspot
```
