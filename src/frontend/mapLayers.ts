import type { Region } from "../shared/types";

export const mapLayerStyles = {
  region: { color: "#263238", weight: 2, fillOpacity: 0 },
  building: { color: "#5d4037", weight: 1, fillColor: "#8d6e63", fillOpacity: 0.45 },
  coverage: { color: "#1976d2", weight: 1, fillColor: "#42a5f5", fillOpacity: 0.22 },
  groundBlindspot: { color: "#d32f2f", weight: 0.5, fillColor: "#ef5350", fillOpacity: 0.35 },
  wallBlindspot: { color: "#b71c1c", weight: 4, opacity: 0.9 },
  wallNormal: { color: "#00897b", weight: 1, opacity: 0.65 },
} as const;

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
