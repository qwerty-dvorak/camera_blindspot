import { describe, expect, test } from "bun:test";
import { parseOverpassBuildings } from "./osm";

describe("parseOverpassBuildings", () => {
  test("converts closed building ways into multipolygons", () => {
    const buildings = parseOverpassBuildings([
      { type: "way", id: 10, nodes: [1, 2, 3, 4, 1], tags: { building: "yes" } },
      { type: "node", id: 1, lon: 77, lat: 28 },
      { type: "node", id: 2, lon: 77.001, lat: 28 },
      { type: "node", id: 3, lon: 77.001, lat: 28.001 },
      { type: "node", id: 4, lon: 77, lat: 28.001 },
    ]);
    expect(buildings).toHaveLength(1);
    expect(buildings[0]!.geometry.type).toBe("MultiPolygon");
    expect(buildings[0]!.geometry.coordinates[0]![0]).toHaveLength(5);
  });
});
