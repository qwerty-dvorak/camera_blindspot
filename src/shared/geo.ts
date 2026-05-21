import type { BoundsInput, CameraInput } from "./types";

export type LonLat = [number, number];
export type Point = { x: number; y: number };
export type Ring = Point[];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

const earthRadiusM = 6371008.8;
const metersPerDegreeLat = 111320;

export function createProjector(bounds: BoundsInput) {
  const originLat = (bounds.north + bounds.south) / 2;
  const originLon = (bounds.east + bounds.west) / 2;
  const cosLat = Math.cos((originLat * Math.PI) / 180);
  const metersPerDegreeLon = Math.max(0.000001, metersPerDegreeLat * cosLat);

  return {
    toXY([lon, lat]: LonLat): Point {
      return {
        x: (lon - originLon) * metersPerDegreeLon,
        y: (lat - originLat) * metersPerDegreeLat,
      };
    },
    toLonLat(point: Point): LonLat {
      return [point.x / metersPerDegreeLon + originLon, point.y / metersPerDegreeLat + originLat];
    },
    distanceMeters(a: LonLat, b: LonLat): number {
      const aPoint = this.toXY(a);
      const bPoint = this.toXY(b);
      return distance(aPoint, bPoint);
    },
  };
}

export function cameraCoveragePolygon(camera: CameraInput, bounds: BoundsInput, stepDegrees = 4): GeoJSON.Feature {
  const projector = createProjector(bounds);
  const origin = projector.toXY([camera.long, camera.lat]);
  const halfFov = camera.fov_deg / 2;
  const steps = Math.max(4, Math.ceil(camera.fov_deg / stepDegrees));
  const coordinates: LonLat[] = [[camera.long, camera.lat]];

  for (let i = 0; i <= steps; i += 1) {
    const bearing = camera.orientation_deg - halfFov + (camera.fov_deg * i) / steps;
    const point = pointFromBearing(origin, bearing, camera.range_m);
    coordinates.push(projector.toLonLat(point));
  }
  coordinates.push([camera.long, camera.lat]);

  return {
    type: "Feature",
    properties: {
      camera: camera.camera,
      orientation_deg: camera.orientation_deg,
      fov_deg: camera.fov_deg,
      range_m: camera.range_m,
    },
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
  };
}

export function pointFromBearing(origin: Point, bearingDegrees: number, distanceMetersValue: number): Point {
  const radians = (bearingDegrees * Math.PI) / 180;
  return {
    x: origin.x + Math.sin(radians) * distanceMetersValue,
    y: origin.y + Math.cos(radians) * distanceMetersValue,
  };
}

export function bearingFromNorth(from: Point, to: Point): number {
  return normalizeDegrees((Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI);
}

export function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function angularDifference(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function ringArea(ring: Ring): number {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const current = ring[i]!;
    const next = ring[i + 1]!;
    total += current.x * next.y - next.x * current.y;
  }
  return total / 2;
}

export function wallSegmentsForPolygon(polygon: Polygon) {
  const outer = polygon[0] ?? [];
  const area = ringArea(outer);
  const isCounterClockwise = area > 0;
  const segments: Array<{ start: Point; end: Point; midpoint: Point; normal: Point; length: number }> = [];

  for (let i = 0; i < outer.length - 1; i += 1) {
    const start = outer[i]!;
    const end = outer[i + 1]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) continue;

    const normal = isCounterClockwise
      ? { x: dy / length, y: -dx / length }
      : { x: -dy / length, y: dx / length };
    segments.push({
      start,
      end,
      midpoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      normal,
      length,
    });
  }

  return segments;
}

export function featureToMultiPolygon(feature: GeoJSON.Feature, projector: ReturnType<typeof createProjector>): MultiPolygon {
  const geometry = feature.geometry;
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return [coordinatesToPolygon(geometry.coordinates as LonLat[][], projector)];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as LonLat[][][]).map((polygon) => coordinatesToPolygon(polygon, projector));
  }
  return [];
}

function coordinatesToPolygon(coordinates: LonLat[][], projector: ReturnType<typeof createProjector>): Polygon {
  return coordinates.map((ring) => ring.map((coord) => projector.toXY(coord)));
}

export function pointInPolygon(point: Point, polygon: Polygon): boolean {
  const outer = polygon[0];
  if (!outer || !pointInRing(point, outer)) return false;
  return !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

export function pointInMultiPolygons(point: Point, polygons: MultiPolygon[]): boolean {
  return polygons.some((multi) => multi.some((polygon) => pointInPolygon(point, polygon)));
}

function pointInRing(point: Point, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const current = ring[i]!;
    const previous = ring[j]!;
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function segmentIntersectsPolygons(start: Point, end: Point, polygons: MultiPolygon[], ignoreEndpoint?: Point): boolean {
  for (const multi of polygons) {
    for (const polygon of multi) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i += 1) {
          const a = ring[i]!;
          const b = ring[i + 1]!;
          const intersection = segmentIntersection(start, end, a, b);
          if (!intersection) continue;
          if (ignoreEndpoint && distance(intersection, ignoreEndpoint) < 0.5) continue;
          if (distance(intersection, start) < 0.5 || distance(intersection, end) < 0.5) continue;
          return true;
        }
      }
    }
  }
  return false;
}

function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) < 1e-9) return null;

  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / denominator;
  const u = -((a.x - b.x) * (a.y - c.y) - (a.y - b.y) * (a.x - c.x)) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
  };
}

export function bboxPolygon(bounds: BoundsInput): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [bounds.west, bounds.south],
          [bounds.east, bounds.south],
          [bounds.east, bounds.north],
          [bounds.west, bounds.north],
          [bounds.west, bounds.south],
        ],
      ],
    },
  };
}

export function metersBetweenLatLon(a: LonLat, b: LonLat): number {
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const deltaLat = ((b[1] - a[1]) * Math.PI) / 180;
  const deltaLon = ((b[0] - a[0]) * Math.PI) / 180;
  const h =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  return 2 * earthRadiusM * Math.asin(Math.sqrt(h));
}
