import { describe, expect, test } from "bun:test";
import { bearingFromNorth, createProjector, wallSegmentsForPolygon } from "./geo";

describe("geo helpers", () => {
  test("uses true north bearing convention", () => {
    const projector = createProjector({ north: 1, south: -1, east: 1, west: -1 });
    const origin = projector.toXY([0, 0]);
    expect(Math.round(bearingFromNorth(origin, projector.toXY([0, 0.001])))).toBe(0);
    expect(Math.round(bearingFromNorth(origin, projector.toXY([0.001, 0])))).toBe(90);
    expect(Math.round(bearingFromNorth(origin, projector.toXY([0, -0.001])))).toBe(180);
    expect(Math.round(bearingFromNorth(origin, projector.toXY([-0.001, 0])))).toBe(270);
  });

  test("computes outward normals for a counter-clockwise ring", () => {
    const segments = wallSegmentsForPolygon([
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 },
      ],
    ]);
    expect(segments[0]!.normal.x).toBeCloseTo(0);
    expect(segments[0]!.normal.y).toBeCloseTo(-1);
  });
});
