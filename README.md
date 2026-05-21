# cam_blindspot

Dockerized Bun app for CCTV coverage and blindspot analysis against OpenStreetMap building footprints.

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

CSV format:

```csv
camera,lat,long,orientation_deg,fov_deg,range_m
CAM-1,28.6146,77.2288,70,75,90
```

Bearings are degrees clockwise from true north.

## Bun commands

```bash
bun install
bun run dev
bun run migrate
bun run seed
bun test
bun run build
```

Set `DATABASE_URL` if running the app outside Docker:

```bash
DATABASE_URL=postgres://cam_blindspot:cam_blindspot@localhost:5432/cam_blindspot
```
