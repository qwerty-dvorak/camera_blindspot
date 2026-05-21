import { sql } from "./db";
import type { BoundsInput, CameraInput, CameraScenario, Region } from "../shared/types";

type DbRegion = Region;
type DbScenario = CameraScenario;

export async function listRegions(): Promise<Region[]> {
  return sql<DbRegion[]>`select id::int, name, north, south, east, west, created_at::text from regions order by created_at desc`;
}

export async function getRegion(id: number): Promise<Region> {
  const rows = await sql<DbRegion[]>`
    select id::int, name, north, south, east, west, created_at::text
    from regions
    where id = ${id}
  `;
  const region = rows[0];
  if (!region) throw new HttpError(404, "Region not found.");
  return region;
}

export async function createRegion(name: string, bounds: BoundsInput): Promise<Region> {
  const rows = await sql<DbRegion[]>`
    insert into regions (name, north, south, east, west, bbox)
    values (
      ${name},
      ${bounds.north},
      ${bounds.south},
      ${bounds.east},
      ${bounds.west},
      ST_MakeEnvelope(${bounds.west}, ${bounds.south}, ${bounds.east}, ${bounds.north}, 4326)
    )
    returning id::int, name, north, south, east, west, created_at::text
  `;
  return rows[0]!;
}

export async function listScenarios(regionId: number): Promise<CameraScenario[]> {
  return sql<DbScenario[]>`
    select cs.id::int, cs.region_id::int, cs.name, cs.source, cs.created_at::text, count(c.id)::int as camera_count
    from camera_sets cs
    left join cameras c on c.camera_set_id = cs.id
    where cs.region_id = ${regionId}
    group by cs.id
    order by cs.created_at desc
  `;
}

export async function getScenario(id: number): Promise<CameraScenario> {
  const rows = await sql<DbScenario[]>`
    select id::int, region_id::int, name, source, created_at::text
    from camera_sets
    where id = ${id}
  `;
  const scenario = rows[0];
  if (!scenario) throw new HttpError(404, "Scenario not found.");
  return scenario;
}

export async function createScenario(
  regionId: number,
  name: string,
  source: CameraScenario["source"],
  cameras: CameraInput[],
): Promise<CameraScenario> {
  return sql.begin(async (tx) => {
    const scenarios = await tx<DbScenario[]>`
      insert into camera_sets (region_id, name, source)
      values (${regionId}, ${name}, ${source})
      returning id::int, region_id::int, name, source, created_at::text
    `;
    const scenario = scenarios[0]!;

    for (const camera of cameras) {
      await tx`
        insert into cameras (camera_set_id, camera, lat, long, orientation_deg, fov_deg, range_m, geom)
        values (
          ${scenario.id},
          ${camera.camera},
          ${camera.lat},
          ${camera.long},
          ${camera.orientation_deg},
          ${camera.fov_deg},
          ${camera.range_m},
          ST_SetSRID(ST_MakePoint(${camera.long}, ${camera.lat}), 4326)
        )
      `;
    }

    return { ...scenario, camera_count: cameras.length };
  });
}

export async function getCameras(scenarioId: number): Promise<Array<CameraInput & { id: number }>> {
  return sql<Array<CameraInput & { id: number }>>`
    select id::int, camera, lat, long, orientation_deg, fov_deg, range_m
    from cameras
    where camera_set_id = ${scenarioId}
    order by id
  `;
}

export async function getCameraFeatureCollection(scenarioId: number): Promise<GeoJSON.FeatureCollection> {
  const rows = await sql<Array<{ feature: GeoJSON.Feature }>>`
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
    where camera_set_id = ${scenarioId}
    order by id
  `;
  return featureCollection(rows.map((row) => row.feature));
}

export async function getBuildingFeatureRows(regionId: number): Promise<Array<{ id: number; feature: GeoJSON.Feature }>> {
  return sql<Array<{ id: number; feature: GeoJSON.Feature }>>`
    select id::int, jsonb_build_object(
      'type', 'Feature',
      'properties', jsonb_build_object('id', id::int, 'tags', tags, 'source_osm_type', source_osm_type, 'source_osm_id', source_osm_id),
      'geometry', ST_AsGeoJSON(geom)::jsonb
    ) as feature
    from buildings
    where region_id = ${regionId}
    order by id
  `;
}

export async function getBuildings(regionId: number): Promise<GeoJSON.FeatureCollection> {
  const rows = await getBuildingFeatureRows(regionId);
  return featureCollection(rows.map((row) => row.feature));
}

export async function upsertBuildings(
  regionId: number,
  buildings: Array<{ sourceType: string; sourceId: string; tags: Record<string, unknown>; geometry: GeoJSON.MultiPolygon }>,
) {
  for (const building of buildings) {
    await sql`
      insert into buildings (region_id, source_osm_type, source_osm_id, tags, geom)
      values (
        ${regionId},
        ${building.sourceType},
        ${building.sourceId},
        ${JSON.stringify(building.tags)}::jsonb,
        ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(building.geometry)}), 4326)
      )
      on conflict (region_id, source_osm_type, source_osm_id)
      do update set tags = excluded.tags, geom = excluded.geom, imported_at = now()
    `;
  }
}

export async function createAnalysisRun(input: {
  regionId: number;
  scenarioId: number;
  groundCellSizeM: number;
  coverage: GeoJSON.FeatureCollection;
  wallNormals: GeoJSON.FeatureCollection;
  wallBlindspots: GeoJSON.FeatureCollection;
  groundBlindspots: GeoJSON.FeatureCollection;
}) {
  return sql.begin(async (tx) => {
    const runs = await tx<Array<{ id: number; scenario_id: number; created_at: string; ground_cell_size_m: number }>>`
      insert into analysis_runs (camera_set_id, region_id, ground_cell_size_m, coverage_geojson, wall_normals_geojson)
      values (
        ${input.scenarioId},
        ${input.regionId},
        ${input.groundCellSizeM},
        ${JSON.stringify(input.coverage)}::jsonb,
        ${JSON.stringify(input.wallNormals)}::jsonb
      )
      returning id::int, camera_set_id::int as scenario_id, created_at::text, ground_cell_size_m
    `;
    const run = runs[0]!;

    for (const feature of input.wallBlindspots.features) {
      await tx`
        insert into wall_blindspots (analysis_run_id, building_id, length_m, geom)
        values (
          ${run.id},
          ${(feature.properties?.building_id as number | undefined) ?? null},
          ${Number(feature.properties?.length_m ?? 0)},
          ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}), 4326)
        )
      `;
    }

    for (const feature of input.groundBlindspots.features) {
      await tx`
        insert into ground_blindspots (analysis_run_id, geom)
        values (${run.id}, ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)}), 4326))
      `;
    }

    return run;
  });
}

export function featureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
