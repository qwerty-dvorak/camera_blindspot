import type { CameraInput, Region } from "../shared/types";
import {
  angularDifference,
  bboxPolygon,
  bearingFromNorth,
  cameraCoveragePolygon,
  createProjector,
  distance,
  featureToMultiPolygon,
  pointInMultiPolygons,
  pointFromBearing,
  segmentIntersectsPolygons,
  wallSegmentsForPolygon,
  type MultiPolygon,
  type Point,
} from "../shared/geo";
import {
  createAnalysisRun,
  createScenario,
  featureCollection,
  getBuildingFeatureRows,
  getBuildings,
  getCameraFeatureCollection,
  getCameras,
  getRegion,
  getScenario,
} from "./repository";

type AnalysisBuildInput = {
  region: Region;
  scenarioId: number;
  cameras: Array<CameraInput & { id?: number }>;
  persist?: boolean;
};

type AnalysisBuildResult = Awaited<ReturnType<typeof buildAnalysisLayers>>;

export async function analyzeScenario(scenarioId: number) {
  const scenario = await getScenario(scenarioId);
  const region = await getRegion(scenario.region_id);
  const cameras = await getCameras(scenarioId);
  const layers = await buildAnalysisLayers({ region, scenarioId, cameras, persist: true });
  const cameraFeatures = await getCameraFeatureCollection(scenarioId);
  return { ...layers, scenario, cameras: cameraFeatures };
}

export async function optimizeScenario(input: {
  regionId: number;
  fovDeg: number;
  rangeM: number;
  maxCameras?: number;
}) {
  const region = await getRegion(input.regionId);
  const buildingRows = await getBuildingFeatureRows(region.id);
  const candidates = generateCandidates(region, buildingRows.map((row) => row.feature), input.fovDeg, input.rangeM);
  const selected = selectGreedyCameras(region, buildingRows.map((row) => row.feature), candidates, input.maxCameras ?? 24);

  if (selected.length === 0) {
    throw new Error("No feasible optimized camera placements were found for this region and range.");
  }

  const scenario = await createScenario(
    region.id,
    `Optimized ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
    "optimized",
    selected,
  );
  const layers = await buildAnalysisLayers({ region, scenarioId: scenario.id, cameras: selected, persist: true });
  const cameraFeatures = await getCameraFeatureCollection(scenario.id);
  return { ...layers, scenario, cameras: cameraFeatures };
}

async function buildAnalysisLayers(input: AnalysisBuildInput) {
  const buildingRows = await getBuildingFeatureRows(input.region.id);
  const buildings = await getBuildings(input.region.id);
  const projector = createProjector(input.region);
  const buildingPolygons = buildingRows.map((row) => ({
    id: row.id,
    multiPolygon: featureToMultiPolygon(row.feature, projector),
  }));
  const allBuildingPolygons = buildingPolygons.map((building) => building.multiPolygon);

  const coverage = featureCollection(input.cameras.map((camera) => cameraCoveragePolygon(camera, input.region)));
  const wallNormals = buildWallNormals(input.region, buildingPolygons);
  const wallBlindspots = buildWallBlindspots(input.region, input.cameras, buildingPolygons);
  const { groundBlindspots, cellSizeM } = buildGroundBlindspots(input.region, input.cameras, allBuildingPolygons);

  const run = input.persist
    ? await createAnalysisRun({
        regionId: input.region.id,
        scenarioId: input.scenarioId,
        groundCellSizeM: cellSizeM,
        coverage,
        wallNormals,
        wallBlindspots,
        groundBlindspots,
      })
    : {
        id: 0,
        scenario_id: input.scenarioId,
        created_at: new Date().toISOString(),
        ground_cell_size_m: cellSizeM,
      };

  return {
    analysis: run,
    region: input.region,
    buildings,
    coverage,
    wallNormals,
    wallBlindspots,
    groundBlindspots,
  };
}

function buildWallNormals(
  region: Region,
  buildings: Array<{ id: number; multiPolygon: MultiPolygon }>,
): GeoJSON.FeatureCollection {
  const projector = createProjector(region);
  const features: GeoJSON.Feature[] = [];

  for (const building of buildings) {
    for (const polygon of building.multiPolygon) {
      for (const segment of wallSegmentsForPolygon(polygon)) {
        const normalEnd = {
          x: segment.midpoint.x + segment.normal.x * Math.min(12, Math.max(5, segment.length * 0.25)),
          y: segment.midpoint.y + segment.normal.y * Math.min(12, Math.max(5, segment.length * 0.25)),
        };
        features.push({
          type: "Feature",
          properties: { building_id: building.id, length_m: segment.length },
          geometry: {
            type: "LineString",
            coordinates: [projector.toLonLat(segment.midpoint), projector.toLonLat(normalEnd)],
          },
        });
      }
    }
  }

  return featureCollection(features);
}

function buildWallBlindspots(
  region: Region,
  cameras: CameraInput[],
  buildings: Array<{ id: number; multiPolygon: MultiPolygon }>,
): GeoJSON.FeatureCollection {
  const projector = createProjector(region);
  const allBuildingPolygons = buildings.map((building) => building.multiPolygon);
  const cameraPoints = cameras.map((camera) => ({ camera, point: projector.toXY([camera.long, camera.lat]) }));
  const features: GeoJSON.Feature[] = [];

  for (const building of buildings) {
    for (const polygon of building.multiPolygon) {
      for (const segment of wallSegmentsForPolygon(polygon)) {
        const visible = cameraPoints.some(({ camera, point }) => {
          const toCamera = { x: point.x - segment.midpoint.x, y: point.y - segment.midpoint.y };
          const cameraFacesWall = toCamera.x * segment.normal.x + toCamera.y * segment.normal.y > 0;
          return cameraFacesWall && cameraSeesPoint(camera, point, segment.midpoint, allBuildingPolygons, segment.midpoint);
        });

        if (!visible) {
          features.push({
            type: "Feature",
            properties: { building_id: building.id, length_m: segment.length },
            geometry: {
              type: "LineString",
              coordinates: [projector.toLonLat(segment.start), projector.toLonLat(segment.end)],
            },
          });
        }
      }
    }
  }

  return featureCollection(features);
}

function buildGroundBlindspots(region: Region, cameras: CameraInput[], buildings: MultiPolygon[]) {
  const projector = createProjector(region);
  const southwest = projector.toXY([region.west, region.south]);
  const northeast = projector.toXY([region.east, region.north]);
  const width = Math.abs(northeast.x - southwest.x);
  const height = Math.abs(northeast.y - southwest.y);
  const baseCell = 25;
  const cellSizeM = Math.max(baseCell, Math.ceil(Math.sqrt((width * height) / 2200)));
  const cameraPoints = cameras.map((camera) => ({ camera, point: projector.toXY([camera.long, camera.lat]) }));
  const features: GeoJSON.Feature[] = [];

  for (let x = Math.min(southwest.x, northeast.x); x < Math.max(southwest.x, northeast.x); x += cellSizeM) {
    for (let y = Math.min(southwest.y, northeast.y); y < Math.max(southwest.y, northeast.y); y += cellSizeM) {
      const center = { x: x + cellSizeM / 2, y: y + cellSizeM / 2 };
      if (pointInMultiPolygons(center, buildings)) continue;
      const covered = cameraPoints.some(({ camera, point }) => cameraSeesPoint(camera, point, center, buildings));
      if (covered) continue;

      features.push({
        type: "Feature",
        properties: { cell_size_m: cellSizeM },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              projector.toLonLat({ x, y }),
              projector.toLonLat({ x: x + cellSizeM, y }),
              projector.toLonLat({ x: x + cellSizeM, y: y + cellSizeM }),
              projector.toLonLat({ x, y: y + cellSizeM }),
              projector.toLonLat({ x, y }),
            ],
          ],
        },
      });
    }
  }

  return { groundBlindspots: featureCollection(features), cellSizeM };
}

function generateCandidates(
  region: Region,
  buildingFeatures: GeoJSON.Feature[],
  fovDeg: number,
  rangeM: number,
): CameraInput[] {
  const projector = createProjector(region);
  const buildings = buildingFeatures.map((feature) => featureToMultiPolygon(feature, projector));
  const candidates: CameraInput[] = [];
  const seen = new Set<string>();

  for (const multi of buildings) {
    for (const polygon of multi) {
      for (const segment of wallSegmentsForPolygon(polygon)) {
        for (const setback of [8, Math.min(rangeM * 0.35, 35)]) {
          const position = {
            x: segment.midpoint.x + segment.normal.x * setback,
            y: segment.midpoint.y + segment.normal.y * setback,
          };
          const lonLat = projector.toLonLat(position);
          if (!insideBounds(lonLat[0], lonLat[1], region) || pointInMultiPolygons(position, buildings)) continue;
          const orientation = bearingFromNorth(position, segment.midpoint);
          const key = `${lonLat[0].toFixed(5)},${lonLat[1].toFixed(5)},${Math.round(orientation / 10) * 10}`;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({
            camera: `OPT-${candidates.length + 1}`,
            lat: lonLat[1],
            long: lonLat[0],
            orientation_deg: orientation,
            fov_deg: fovDeg,
            range_m: rangeM,
          });
        }
      }
    }
  }

  const southwest = projector.toXY([region.west, region.south]);
  const northeast = projector.toXY([region.east, region.north]);
  const spacing = Math.max(20, rangeM * 0.7);
  for (let x = Math.min(southwest.x, northeast.x) + spacing / 2; x < Math.max(southwest.x, northeast.x); x += spacing) {
    for (let y = Math.min(southwest.y, northeast.y) + spacing / 2; y < Math.max(southwest.y, northeast.y); y += spacing) {
      const position = { x, y };
      if (pointInMultiPolygons(position, buildings)) continue;
      for (const orientation of [0, 90, 180, 270]) {
        const lonLat = projector.toLonLat(position);
        candidates.push({
          camera: `OPT-${candidates.length + 1}`,
          lat: lonLat[1],
          long: lonLat[0],
          orientation_deg: orientation,
          fov_deg: fovDeg,
          range_m: rangeM,
        });
      }
    }
  }

  return candidates.slice(0, 1200);
}

function selectGreedyCameras(
  region: Region,
  buildingFeatures: GeoJSON.Feature[],
  candidates: CameraInput[],
  maxCameras: number,
): CameraInput[] {
  const targets = createOptimizationTargets(region, buildingFeatures);
  const selected: CameraInput[] = [];
  const uncovered = new Set(targets.map((_, index) => index));
  const projector = createProjector(region);
  const buildings = buildingFeatures.map((feature) => featureToMultiPolygon(feature, projector));

  while (uncovered.size > 0 && selected.length < maxCameras) {
    let best: { camera: CameraInput; score: number; covered: number[] } | null = null;

    for (const candidate of candidates) {
      if (selected.some((camera) => camera.camera === candidate.camera)) continue;
      const cameraPoint = projector.toXY([candidate.long, candidate.lat]);
      const covered = [...uncovered].filter((targetIndex) => {
        const target = targets[targetIndex]!;
        if (target.normal) {
          const toCamera = { x: cameraPoint.x - target.point.x, y: cameraPoint.y - target.point.y };
          if (toCamera.x * target.normal.x + toCamera.y * target.normal.y <= 0) return false;
        }
        return cameraSeesPoint(candidate, cameraPoint, target.point, buildings, target.point);
      });
      const score = covered.reduce((total, targetIndex) => total + targets[targetIndex]!.weight, 0);
      if (!best || score > best.score) best = { camera: candidate, score, covered };
    }

    if (!best || best.score <= 0) break;
    const cameraNumber = selected.length + 1;
    selected.push({ ...best.camera, camera: `OPT-${cameraNumber}` });
    best.covered.forEach((targetIndex) => uncovered.delete(targetIndex));
  }

  return selected;
}

function createOptimizationTargets(region: Region, buildingFeatures: GeoJSON.Feature[]) {
  const projector = createProjector(region);
  const buildings = buildingFeatures.map((feature) => featureToMultiPolygon(feature, projector));
  const targets: Array<{ point: Point; normal?: Point; weight: number }> = [];

  for (const multi of buildings) {
    for (const polygon of multi) {
      for (const segment of wallSegmentsForPolygon(polygon)) {
        targets.push({ point: segment.midpoint, normal: segment.normal, weight: Math.max(1, segment.length / 10) });
      }
    }
  }

  const southwest = projector.toXY([region.west, region.south]);
  const northeast = projector.toXY([region.east, region.north]);
  const cell = Math.max(20, Math.ceil(Math.sqrt((Math.abs(northeast.x - southwest.x) * Math.abs(northeast.y - southwest.y)) / 400)));
  for (let x = Math.min(southwest.x, northeast.x) + cell / 2; x < Math.max(southwest.x, northeast.x); x += cell) {
    for (let y = Math.min(southwest.y, northeast.y) + cell / 2; y < Math.max(southwest.y, northeast.y); y += cell) {
      const point = { x, y };
      if (!pointInMultiPolygons(point, buildings)) targets.push({ point, weight: 1 });
    }
  }

  return targets;
}

export function cameraSeesPoint(
  camera: CameraInput,
  cameraPoint: Point,
  target: Point,
  buildings: MultiPolygon[],
  ignoreEndpoint?: Point,
): boolean {
  const targetDistance = distance(cameraPoint, target);
  if (targetDistance > camera.range_m) return false;
  const bearing = bearingFromNorth(cameraPoint, target);
  if (camera.fov_deg < 360 && angularDifference(bearing, camera.orientation_deg) > camera.fov_deg / 2) return false;
  return !segmentIntersectsPolygons(cameraPoint, target, buildings, ignoreEndpoint);
}

function insideBounds(lon: number, lat: number, region: Region): boolean {
  return lon >= region.west && lon <= region.east && lat >= region.south && lat <= region.north;
}

export { bboxPolygon };
