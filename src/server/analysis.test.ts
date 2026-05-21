import { describe, expect, test } from "bun:test";
import { buildGroundBlindspots, buildWallBlindspots } from "./analysis";
import { createProjector, featureToMultiPolygon } from "../shared/geo";
import type { CameraInput, Region } from "../shared/types";

const squareRegion: Region = {
  id: 1,
  name: "Square test region",
  north: 0.001,
  south: -0.001,
  east: 0.001,
  west: -0.001,
  created_at: "now",
};

const rectangleBuilding: GeoJSON.Feature = {
  type: "Feature",
  properties: { id: 10 },
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

function testBuilding() {
  const projector = createProjector(squareRegion);
  return {
    id: 10,
    multiPolygon: featureToMultiPolygon(rectangleBuilding, projector),
  };
}

describe("synthetic rectangle analysis", () => {
  test("counts only exterior wall faces as visible", () => {
    const outsideCamera: CameraInput = {
      camera: "outside",
      lat: -0.00072,
      long: 0,
      orientation_deg: 0,
      fov_deg: 80,
      range_m: 140,
    };
    const blindspots = buildWallBlindspots(squareRegion, [outsideCamera], [testBuilding()]);
    expect(blindspots.features.length).toBe(3);
  });

  test("does not require cameras inside buildings to see building interiors", () => {
    const insideCamera: CameraInput = {
      camera: "inside",
      lat: 0,
      long: 0,
      orientation_deg: 0,
      fov_deg: 360,
      range_m: 140,
    };
    const blindspots = buildWallBlindspots(squareRegion, [insideCamera], [testBuilding()]);
    expect(blindspots.features.length).toBe(4);
  });

  test("excludes indoor cells from ground blindspots", () => {
    const building = testBuilding();
    const noCameras: CameraInput[] = [];
    const ground = buildGroundBlindspots(squareRegion, noCameras, [building.multiPolygon]);
    const centersInsideBuilding = ground.groundBlindspots.features.filter((feature) => {
      const ring = (feature.geometry as GeoJSON.Polygon).coordinates[0]!;
      const first = ring[0]!;
      const opposite = ring[2]!;
      const lon = (first[0]! + opposite[0]!) / 2;
      const lat = (first[1]! + opposite[1]!) / 2;
      return lon > -0.00025 && lon < 0.00025 && lat > -0.00025 && lat < 0.00025;
    });
    expect(centersInsideBuilding).toHaveLength(0);
  });
});
