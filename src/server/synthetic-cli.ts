import {
  buildGroundBlindspots,
  buildWallBlindspots,
  buildWallNormals,
} from "./analysis";
import { createProjector, featureToMultiPolygon } from "../shared/geo";
import type { CameraInput, Region } from "../shared/types";

const region: Region = {
  id: 0,
  name: "Synthetic square region",
  north: 0.001,
  south: -0.001,
  east: 0.001,
  west: -0.001,
  created_at: new Date(0).toISOString(),
};

const buildingFeature: GeoJSON.Feature = {
  type: "Feature",
  properties: { id: 1, name: "Synthetic rectangle" },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-0.00025, -0.00025],
        [0.00025, -0.00025],
        [0.00025, 0.00025],
        [-0.00025, 0.00025],
        [-0.00025, -0.00025],
      ],
    ],
  },
};

const cameras: CameraInput[] = [
  {
    camera: "SYN-SOUTH-LOOK-NORTH",
    lat: -0.00072,
    long: 0,
    orientation_deg: 0,
    fov_deg: 80,
    range_m: 140,
  },
];

export function runSyntheticScenario() {
  const projector = createProjector(region);
  const building = {
    id: 1,
    multiPolygon: featureToMultiPolygon(buildingFeature, projector),
  };
  const wallNormals = buildWallNormals(region, [building]);
  const wallBlindspots = buildWallBlindspots(region, cameras, [building]);
  const ground = buildGroundBlindspots(region, cameras, [building.multiPolygon]);

  return {
    region,
    cameraCount: cameras.length,
    buildingCount: 1,
    wallCount: wallNormals.features.length,
    wallBlindspotCount: wallBlindspots.features.length,
    groundBlindspotCount: ground.groundBlindspots.features.length,
    groundCellSizeM: ground.cellSizeM,
  };
}

if (import.meta.main) {
  const result = runSyntheticScenario();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result));
  } else {
    console.log(`Synthetic rectangle scenario`);
    console.log(`cameras: ${result.cameraCount}`);
    console.log(`buildings: ${result.buildingCount}`);
    console.log(`walls: ${result.wallCount}`);
    console.log(`wall blindspots: ${result.wallBlindspotCount}`);
    console.log(`ground blindspot cells: ${result.groundBlindspotCount}`);
    console.log(`ground cell size m: ${result.groundCellSizeM}`);
  }
}
