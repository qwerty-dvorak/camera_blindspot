import type { BoundsInput, CameraInput } from "./types";

export function normalizeBounds(input: BoundsInput): BoundsInput {
  const north = numberInRange(input.north, -90, 90, "north");
  const south = numberInRange(input.south, -90, 90, "south");
  const east = numberInRange(input.east, -180, 180, "east");
  const west = numberInRange(input.west, -180, 180, "west");

  if (north <= south) {
    throw new Error("north must be greater than south.");
  }
  if (east <= west) {
    throw new Error("east must be greater than west.");
  }

  return { north, south, east, west };
}

export function normalizeCameraInput(input: CameraInput): CameraInput {
  const camera = input.camera.trim();
  if (!camera) {
    throw new Error("camera is required.");
  }

  const orientation = Number(input.orientation_deg);
  const normalizedOrientation = ((orientation % 360) + 360) % 360;
  return {
    camera,
    lat: numberInRange(input.lat, -90, 90, "lat"),
    long: numberInRange(input.long, -180, 180, "long"),
    orientation_deg: finiteNumber(normalizedOrientation, "orientation_deg"),
    fov_deg: numberInRange(input.fov_deg, 1, 360, "fov_deg"),
    range_m: positiveNumber(input.range_m, "range_m"),
  };
}

export function finiteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return value;
}

function numberInRange(value: number, min: number, max: number, name: string): number {
  const number = finiteNumber(value, name);
  if (number < min || number > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return number;
}

function positiveNumber(value: number, name: string): number {
  const number = finiteNumber(value, name);
  if (number <= 0) {
    throw new Error(`${name} must be greater than 0.`);
  }
  return number;
}
