import { describe, expect, test } from "bun:test";
import * as Cesium from "cesium";
import { createOpenStreetMapBaseLayer, mapLayerStyles, regionFeature } from "./mapLayers";
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
    expect(mapLayerStyles.building.stroke.toCssColorString()).toBe("rgb(93,64,55)");
    expect(mapLayerStyles.building.fill.toCssColorString()).toBe("rgba(141,110,99,0.45)");
  });

  test("creates an explicit OpenStreetMap base layer for Cesium Viewer", () => {
    const layer = createOpenStreetMapBaseLayer();
    expect(layer).toBeInstanceOf(Cesium.ImageryLayer);
    expect(layer.imageryProvider).toBeInstanceOf(Cesium.OpenStreetMapImageryProvider);
    expect(layer.imageryProvider.url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  });
});
