import { sql } from "./db";
import { migrate } from "./migrate";
import { createScenario, upsertBuildings } from "./repository";
import type { BoundsInput, CameraInput, Region } from "../shared/types";

const seedRegion = {
  name: "Seeded Connaught Place",
  north: 28.6342,
  south: 28.6287,
  east: 77.2224,
  west: 77.216,
} satisfies BoundsInput & { name: string };

const seedCameras: CameraInput[] = [
  { camera: "CP-CAM-01", lat: 28.63155, long: 77.21735, orientation_deg: 92, fov_deg: 80, range_m: 130 },
  { camera: "CP-CAM-02", lat: 28.6327, long: 77.2192, orientation_deg: 182, fov_deg: 90, range_m: 120 },
  { camera: "CP-CAM-03", lat: 28.6302, long: 77.22095, orientation_deg: 315, fov_deg: 75, range_m: 110 },
];

const seedBuildings = [
  rectangleBuilding("seed-block-a", [
    [77.2177, 28.63255],
    [77.21855, 28.63255],
    [77.21855, 28.63185],
    [77.2177, 28.63185],
  ]),
  rectangleBuilding("seed-block-b", [
    [77.21945, 28.6318],
    [77.22035, 28.6318],
    [77.22035, 28.63095],
    [77.21945, 28.63095],
  ]),
  rectangleBuilding("seed-block-c", [
    [77.21825, 28.63035],
    [77.21905, 28.63035],
    [77.21905, 28.62965],
    [77.21825, 28.62965],
  ]),
];

export async function seed() {
  await migrate();
  const region = await upsertSeedRegion();
  await upsertBuildings(region.id, seedBuildings);
  await replaceSeedScenario(region.id);
  console.log(`seeded region ${region.id}: ${region.name}`);
}

async function upsertSeedRegion(): Promise<Region> {
  const existing = await sql<Region[]>`
    select id::int, name, north, south, east, west, created_at::text
    from regions
    where name = ${seedRegion.name}
    order by id
    limit 1
  `;

  if (existing[0]) {
    const rows = await sql<Region[]>`
      update regions
      set
        north = ${seedRegion.north},
        south = ${seedRegion.south},
        east = ${seedRegion.east},
        west = ${seedRegion.west},
        bbox = ST_MakeEnvelope(${seedRegion.west}, ${seedRegion.south}, ${seedRegion.east}, ${seedRegion.north}, 4326)
      where id = ${existing[0].id}
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

async function replaceSeedScenario(regionId: number) {
  await sql`
    delete from camera_sets
    where region_id = ${regionId}
      and name = ${"Seeded cameras"}
      and source = ${"db"}
  `;
  await createScenario(regionId, "Seeded cameras", "db", seedCameras);
}

function rectangleBuilding(sourceId: string, corners: Array<[number, number]>) {
  const ring = [...corners, corners[0]!] as Array<[number, number]>;
  return {
    sourceType: "seed",
    sourceId,
    tags: { building: "yes", source: "seed" },
    geometry: {
      type: "MultiPolygon",
      coordinates: [[ring]],
    } satisfies GeoJSON.MultiPolygon,
  };
}

if (import.meta.main) {
  await seed();
  await sql.close();
}
