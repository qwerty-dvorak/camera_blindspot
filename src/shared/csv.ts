import type { CameraInput } from "./types";
import { normalizeCameraInput } from "./validation";

const requiredColumns = ["camera", "lat", "long", "orientation_deg", "fov_deg", "range_m"] as const;

export function parseCameraCsv(text: string): CameraInput[] {
  const rows = parseCsvRows(text.trim());
  if (rows.length < 2) {
    throw new Error("CSV must include a header row and at least one camera row.");
  }

  const headers = rows[0]!.map((header) => header.trim());
  const missing = requiredColumns.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required column(s): ${missing.join(", ")}.`);
  }

  return rows.slice(1).map((row, index) => {
    const record = Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] ?? ""]));
    try {
      return normalizeCameraInput({
        camera: String(record.camera ?? "").trim(),
        lat: Number(record.lat),
        long: Number(record.long),
        orientation_deg: Number(record.orientation_deg),
        fov_deg: Number(record.fov_deg),
        range_m: Number(record.range_m),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid camera row.";
      throw new Error(`CSV row ${index + 2}: ${message}`);
    }
  });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  row.push(value);
  rows.push(row);
  return rows.filter((candidate) => candidate.some((cell) => cell.trim() !== ""));
}
