import { describe, expect, test } from "bun:test";
import { mapLayerStyles, regionFeature } from "./mapLayers";
import type { Region } from "../shared/types";

describe("map UI layers", () => {
  test("renders a square region as a closed polygon", () => {
    const region: Region = {
      id: 1,
      name: "Square",
      north: 1,
      south: 0,
      east: 1,
      west: 0,
      created_at: "now",
    };
    const feature = regionFeature(region);
    expect(feature.geometry?.type).toBe("Polygon");
    expect((feature.geometry as GeoJSON.Polygon).coordinates[0]).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]);
  });

  test("marks buildings as brown filled footprints", () => {
    expect(mapLayerStyles.building.color).toBe("#5d4037");
    expect(mapLayerStyles.building.fillColor).toBe("#8d6e63");
    expect(mapLayerStyles.building.fillOpacity).toBeGreaterThan(0.3);
  });
});
