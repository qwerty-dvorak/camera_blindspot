import * as Cesium from "cesium";
import type { Region } from "../shared/types";

export const mapLayerStyles = {
  region: {
    material: new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString("#263238").withAlpha(0)),
    outlineColor: Cesium.Color.fromCssColorString("#263238"),
    outlineWidth: 2,
  },
  building: {
    fill: Cesium.Color.fromCssColorString("#8d6e63").withAlpha(0.45),
    stroke: Cesium.Color.fromCssColorString("#5d4037"),
    strokeWidth: 1,
  },
  coverage: {
    fill: Cesium.Color.fromCssColorString("#42a5f5").withAlpha(0.22),
    stroke: Cesium.Color.fromCssColorString("#1976d2"),
    strokeWidth: 1,
  },
  groundBlindspot: {
    fill: Cesium.Color.fromCssColorString("#ef5350").withAlpha(0.35),
    stroke: Cesium.Color.fromCssColorString("#d32f2f"),
    strokeWidth: 0.5,
  },
  wallBlindspot: {
    stroke: Cesium.Color.fromCssColorString("#b71c1c"),
    strokeWidth: 4,
  },
  wallNormal: {
    stroke: Cesium.Color.fromCssColorString("#00897b"),
    strokeWidth: 1,
  },
} as const;

export function createOpenStreetMapBaseLayer(): Cesium.ImageryLayer {
  return new Cesium.ImageryLayer(
    new Cesium.OpenStreetMapImageryProvider({
      url: "https://tile.openstreetmap.org/",
    }),
  );
}

export function regionFeature(region: Region): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { id: region.id, name: region.name },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [region.west, region.south],
          [region.east, region.south],
          [region.east, region.north],
          [region.west, region.north],
          [region.west, region.south],
        ],
      ],
    },
  };
}
