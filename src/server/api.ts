import { analyzeScenario, optimizeScenario } from "./analysis";
import { fetchOsmBuildings } from "./osm";
import {
  createRegion,
  createScenario,
  featureCollection,
  getBuildingFeatureRows,
  getBuildings,
  getRegion,
  getScenario,
  HttpError,
  listRegions,
  listScenarios,
  upsertBuildings,
} from "./repository";
import { parseCameraCsv } from "../shared/csv";
import { normalizeBounds, normalizeCameraInput } from "../shared/validation";
import type { BoundsInput, CameraInput } from "../shared/types";

export async function handleApiRequest(req: Request, url: URL): Promise<Response> {
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json({ ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/regions") {
      return json(await listRegions());
    }

    if (req.method === "POST" && url.pathname === "/api/regions") {
      const body = (await req.json()) as BoundsInput & { name?: string };
      const bounds = normalizeBounds(body);
      const name = body.name?.trim() || `Region ${new Date().toISOString().slice(0, 10)}`;
      return json(await createRegion(name, bounds), 201);
    }

    const regionImportMatch = match(url.pathname, /^\/api\/regions\/(\d+)\/import-buildings$/);
    if (req.method === "POST" && regionImportMatch) {
      const region = await getRegion(Number(regionImportMatch[1]));
      const buildings = await fetchOsmBuildings(region);
      await upsertBuildings(region.id, buildings);
      return json({ imported: buildings.length, buildings: await getBuildings(region.id) });
    }

    const scenariosMatch = match(url.pathname, /^\/api\/regions\/(\d+)\/scenarios$/);
    if (req.method === "GET" && scenariosMatch) {
      return json(await listScenarios(Number(scenariosMatch[1])));
    }

    if (req.method === "POST" && scenariosMatch) {
      const regionId = Number(scenariosMatch[1]);
      const body = (await req.json()) as { name?: string; cameras?: CameraInput[] };
      const cameras = (body.cameras ?? []).map(normalizeCameraInput);
      if (cameras.length === 0) throw new HttpError(400, "At least one camera is required.");
      return json(await createScenario(regionId, body.name?.trim() || "Manual camera set", "db", cameras), 201);
    }

    const csvMatch = match(url.pathname, /^\/api\/regions\/(\d+)\/scenarios\/upload-csv$/);
    if (req.method === "POST" && csvMatch) {
      const regionId = Number(csvMatch[1]);
      const text = await req.text();
      const name = url.searchParams.get("name")?.trim() || "CSV camera set";
      const cameras = parseCameraCsv(text);
      return json(await createScenario(regionId, name, "csv", cameras), 201);
    }

    const optimizeMatch = match(url.pathname, /^\/api\/regions\/(\d+)\/optimize$/);
    if (req.method === "POST" && optimizeMatch) {
      const regionId = Number(optimizeMatch[1]);
      const body = (await req.json()) as { fov_deg?: number; range_m?: number; max_cameras?: number };
      const fovDeg = numberInRange(body.fov_deg, 1, 360, "fov_deg");
      const rangeM = positiveNumber(body.range_m, "range_m");
      const maxCameras = body.max_cameras === undefined ? 24 : Math.floor(numberInRange(body.max_cameras, 1, 200, "max_cameras"));
      const buildingRows = await getBuildingFeatureRows(regionId);
      if (buildingRows.length === 0) {
        const region = await getRegion(regionId);
        const buildings = await fetchOsmBuildings(region);
        await upsertBuildings(region.id, buildings);
      }
      return json(await optimizeScenario({ regionId, fovDeg, rangeM, maxCameras }), 201);
    }

    const analyzeMatch = match(url.pathname, /^\/api\/scenarios\/(\d+)\/analyze$/);
    if (req.method === "POST" && analyzeMatch) {
      return json(await analyzeScenario(Number(analyzeMatch[1])));
    }

    const scenarioMatch = match(url.pathname, /^\/api\/scenarios\/(\d+)$/);
    if (req.method === "GET" && scenarioMatch) {
      return json(await getScenario(Number(scenarioMatch[1])));
    }

    const buildingsMatch = match(url.pathname, /^\/api\/regions\/(\d+)\/buildings$/);
    if (req.method === "GET" && buildingsMatch) {
      return json(await getBuildings(Number(buildingsMatch[1])));
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status);
    }
    const message = error instanceof Error ? error.message : "Unexpected error.";
    console.error(error);
    return json({ error: message }, 500);
  }
}

function match(pathname: string, regex: RegExp): RegExpMatchArray | null {
  return pathname.match(regex);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function numberInRange(value: unknown, min: number, max: number, name: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, `${name} must be between ${min} and ${max}.`);
  }
  return number;
}

function positiveNumber(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new HttpError(400, `${name} must be greater than 0.`);
  }
  return number;
}
