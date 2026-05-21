import type { BoundsInput } from "../shared/types";

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: Array<{ type: string; ref: number; role: string }>;
  tags?: Record<string, unknown>;
};

type ImportedBuilding = {
  sourceType: string;
  sourceId: string;
  tags: Record<string, unknown>;
  geometry: GeoJSON.MultiPolygon;
};

export async function fetchOsmBuildings(bounds: BoundsInput): Promise<ImportedBuilding[]> {
  const query = `
    [out:json][timeout:25];
    (
      way["building"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      relation["building"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
    );
    out body;
    >;
    out skel qt;
  `;

  const response = await fetch(process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed with ${response.status}.`);
  }

  const payload = (await response.json()) as { elements?: OverpassElement[] };
  return parseOverpassBuildings(payload.elements ?? []);
}

export function parseOverpassBuildings(elements: OverpassElement[]): ImportedBuilding[] {
  const nodes = new Map<number, [number, number]>();
  const ways = new Map<number, OverpassElement>();
  const buildings: ImportedBuilding[] = [];

  for (const element of elements) {
    if (element.type === "node" && element.lat !== undefined && element.lon !== undefined) {
      nodes.set(element.id, [element.lon, element.lat]);
    } else if (element.type === "way") {
      ways.set(element.id, element);
    }
  }

  for (const way of ways.values()) {
    if (!way.tags?.building || !way.nodes) continue;
    const ring = nodesForWay(way, nodes);
    if (!ring || !isClosedRing(ring)) continue;
    buildings.push({
      sourceType: "way",
      sourceId: String(way.id),
      tags: way.tags,
      geometry: { type: "MultiPolygon", coordinates: [[ring]] },
    });
  }

  for (const relation of elements.filter((element) => element.type === "relation" && element.tags?.building)) {
    const outerWays = relation.members
      ?.filter((member) => member.type === "way" && member.role !== "inner")
      .map((member) => ways.get(member.ref))
      .filter((way): way is OverpassElement => Boolean(way)) ?? [];
    const rings = stitchOuterRings(outerWays, nodes);
    if (rings.length === 0) continue;
    buildings.push({
      sourceType: "relation",
      sourceId: String(relation.id),
      tags: relation.tags ?? {},
      geometry: { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) },
    });
  }

  return buildings;
}

function nodesForWay(way: OverpassElement, nodes: Map<number, [number, number]>): [number, number][] | null {
  const coordinates = (way.nodes ?? []).map((nodeId) => nodes.get(nodeId));
  if (coordinates.some((coord) => !coord)) return null;
  return coordinates as [number, number][];
}

function stitchOuterRings(ways: OverpassElement[], nodes: Map<number, [number, number]>): [number, number][][] {
  const remaining = ways.reduce<Array<[number, number][]>>((accumulator, way) => {
    const ring = nodesForWay(way, nodes);
    if (ring && ring.length >= 2) accumulator.push(ring);
    return accumulator;
  }, []);
  const closed = remaining.filter(isClosedRing);
  const open = remaining.filter((ring) => !isClosedRing(ring));
  const rings = [...closed];

  while (open.length > 0) {
    const seed = open.shift()!;
    let current = [...seed];
    let changed = true;
    while (!isClosedRing(current) && changed) {
      changed = false;
      for (let i = 0; i < open.length; i += 1) {
        const candidate = open[i]!;
        const merged = tryMerge(current, candidate);
        if (merged) {
          current = merged;
          open.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    if (isClosedRing(current)) rings.push(current);
  }

  return rings;
}

function tryMerge(a: [number, number][], b: [number, number][]): [number, number][] | null {
  const aStart = coordKey(a[0]!);
  const aEnd = coordKey(a[a.length - 1]!);
  const bStart = coordKey(b[0]!);
  const bEnd = coordKey(b[b.length - 1]!);
  if (aEnd === bStart) return [...a, ...b.slice(1)];
  if (aEnd === bEnd) return [...a, ...b.slice(0, -1).reverse()];
  if (aStart === bEnd) return [...b, ...a.slice(1)];
  if (aStart === bStart) return [...b.reverse(), ...a.slice(1)];
  return null;
}

function isClosedRing(ring: [number, number][]): boolean {
  return ring.length >= 4 && coordKey(ring[0]!) === coordKey(ring[ring.length - 1]!);
}

function coordKey(coord: [number, number]): string {
  return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
}
