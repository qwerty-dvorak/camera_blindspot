import { sql } from "./db";
import { migrate } from "./migrate";
import { fetchOsmBuildings } from "./osm";
import { createScenario, upsertBuildings } from "./repository";
import type { BoundsInput, CameraInput, Region } from "../shared/types";

type SeedRegion = BoundsInput & {
  name: string;
  cameras: CameraInput[];
};

const seedRegions: SeedRegion[] = [
  {
    name: "Seeded Connaught Place",
    north: 28.6342,
    south: 28.6287,
    east: 77.2224,
    west: 77.216,
    cameras: [
      { camera: "CP-CAM-01", lat: 28.63155, long: 77.21735, orientation_deg: 92, fov_deg: 80, range_m: 230 },
      { camera: "CP-CAM-02", lat: 28.6327, long: 77.2192, orientation_deg: 182, fov_deg: 95, range_m: 210 },
      { camera: "CP-CAM-03", lat: 28.6302, long: 77.22095, orientation_deg: 315, fov_deg: 85, range_m: 240 },
      { camera: "CP-CAM-04", lat: 28.6297, long: 77.2179, orientation_deg: 38, fov_deg: 100, range_m: 220 },
      { camera: "CP-CAM-05", lat: 28.63325, long: 77.22135, orientation_deg: 230, fov_deg: 75, range_m: 260 },
    ],
  },
  {
    name: "Seeded Times Square",
    north: 40.7606,
    south: 40.7554,
    east: -73.9822,
    west: -73.9894,
    cameras: [
      { camera: "TS-CAM-01", lat: 40.7589, long: -73.9872, orientation_deg: 55, fov_deg: 85, range_m: 260 },
      { camera: "TS-CAM-02", lat: 40.7568, long: -73.9854, orientation_deg: 25, fov_deg: 70, range_m: 240 },
      { camera: "TS-CAM-03", lat: 40.7598, long: -73.9845, orientation_deg: 205, fov_deg: 90, range_m: 230 },
      { camera: "TS-CAM-04", lat: 40.7572, long: -73.9829, orientation_deg: 285, fov_deg: 95, range_m: 250 },
      { camera: "TS-CAM-05", lat: 40.7601, long: -73.9884, orientation_deg: 122, fov_deg: 80, range_m: 280 },
    ],
  },
  {
    name: "Seeded Trafalgar Square",
    north: 51.5104,
    south: 51.5066,
    east: -0.1242,
    west: -0.1306,
    cameras: [
      { camera: "TR-CAM-01", lat: 51.5082, long: -0.1294, orientation_deg: 82, fov_deg: 85, range_m: 220 },
      { camera: "TR-CAM-02", lat: 51.5095, long: -0.1272, orientation_deg: 172, fov_deg: 90, range_m: 200 },
      { camera: "TR-CAM-03", lat: 51.5075, long: -0.1253, orientation_deg: 306, fov_deg: 85, range_m: 230 },
      { camera: "TR-CAM-04", lat: 51.5089, long: -0.1248, orientation_deg: 248, fov_deg: 75, range_m: 210 },
    ],
  },
];

export async function seed() {
  await migrate();

  for (const seedRegion of seedRegions) {
    const region = await upsertSeedRegion(seedRegion);
    await deleteOldHardcodedBuildings(region.id);
    await importSeedBuildings(region, seedRegion);
    await replaceSeedScenario(region.id, seedRegion.cameras);
    console.log(`seeded region ${region.id}: ${region.name}`);
  }
}

async function upsertSeedRegion(seedRegion: SeedRegion): Promise<Region> {
  const existing = await sql<Region[]>`
    select id::int, name, north, south, east, west, created_at::text
    from regions
    where name = ${seedRegion.name}
    order by id
  `;

  if (existing[0]) {
    const canonical = existing[0];
    for (const duplicate of existing.slice(1)) {
      await sql`delete from regions where id = ${duplicate.id}`;
      console.log(`removed duplicate seeded region ${duplicate.id}: ${duplicate.name}`);
    }

    const rows = await sql<Region[]>`
      update regions
      set
        north = ${seedRegion.north},
        south = ${seedRegion.south},
        east = ${seedRegion.east},
        west = ${seedRegion.west},
        bbox = ST_MakeEnvelope(${seedRegion.west}, ${seedRegion.south}, ${seedRegion.east}, ${seedRegion.north}, 4326)
      where id = ${canonical.id}
      returning id::int, name, north, south, east, west, created_at::text
    `;
    return rows[0]!;
  }

  const rows = await sql<Region[]>`
    insert into regions (name, north, south, east, west, bbox)
    values (
      ${seedRegion.name},
      ${seedRegion.north},
      ${seedRegion.south},
      ${seedRegion.east},
      ${seedRegion.west},
      ST_MakeEnvelope(${seedRegion.west}, ${seedRegion.south}, ${seedRegion.east}, ${seedRegion.north}, 4326)
    )
    returning id::int, name, north, south, east, west, created_at::text
  `;
  return rows[0]!;
}

async function importSeedBuildings(region: Region, seedRegion: SeedRegion) {
  const existingOsmBuildings = await sql<Array<{ count: number }>>`
    select count(*)::int as count
    from buildings
    where region_id = ${region.id}
      and source_osm_type in ('way', 'relation')
  `;
  if ((existingOsmBuildings[0]?.count ?? 0) > 0) return;

  try {
    const buildings = await fetchOsmBuildings(seedRegion);
    if (buildings.length === 0) {
      console.warn(`OpenStreetMap returned no buildings for ${seedRegion.name}; try importing from the UI later.`);
      return;
    }
    await upsertBuildings(region.id, buildings);
    console.log(`imported ${buildings.length} OSM building(s) for ${seedRegion.name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Overpass error";
    console.warn(`Could not import OSM buildings for ${seedRegion.name}: ${message}`);
  }
}

async function deleteOldHardcodedBuildings(regionId: number) {
  await sql`
    delete from buildings
    where region_id = ${regionId}
      and source_osm_type = ${"seed"}
  `;
}

async function replaceSeedScenario(regionId: number, cameras: CameraInput[]) {
  await sql`
    delete from camera_sets
    where region_id = ${regionId}
      and name = ${"Seeded cameras"}
      and source = ${"db"}
  `;
  await createScenario(regionId, "Seeded cameras", "db", cameras);
}

if (import.meta.main) {
  await seed();
  await sql.close();
}
