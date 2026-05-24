import csv
from io import StringIO

from .validation import normalize_camera_input

REQUIRED_COLUMNS = ["camera", "lat", "long", "orientation_deg", "fov_deg", "range_m"]


def parse_camera_csv(text: str) -> list[dict]:
    rows = list(csv.DictReader(StringIO(text.strip())))
    if not rows:
        raise ValueError("CSV must include a header row and at least one camera row.")
    headers = rows[0].keys()
    missing = [column for column in REQUIRED_COLUMNS if column not in headers]
    if missing:
        raise ValueError(f"CSV is missing required column(s): {', '.join(missing)}.")

    cameras = []
    for index, row in enumerate(rows, start=2):
        try:
            cameras.append(
                normalize_camera_input(
                    {
                        "camera": row.get("camera", ""),
                        "lat": row.get("lat"),
                        "long": row.get("long"),
                        "orientation_deg": row.get("orientation_deg"),
                        "fov_deg": row.get("fov_deg"),
                        "range_m": row.get("range_m"),
                    }
                )
            )
        except ValueError as exc:
            raise ValueError(f"CSV row {index}: {exc}") from exc
    return cameras
