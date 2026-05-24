import math


def normalize_bounds(data: dict) -> dict:
    north = number_in_range(data.get("north"), -90, 90, "north")
    south = number_in_range(data.get("south"), -90, 90, "south")
    east = number_in_range(data.get("east"), -180, 180, "east")
    west = number_in_range(data.get("west"), -180, 180, "west")
    if north <= south:
        raise ValueError("north must be greater than south.")
    if east <= west:
        raise ValueError("east must be greater than west.")
    return {"north": north, "south": south, "east": east, "west": west}


def normalize_camera_input(data: dict) -> dict:
    camera = str(data.get("camera", "")).strip()
    if not camera:
        raise ValueError("camera is required.")
    orientation = finite_number(data.get("orientation_deg"), "orientation_deg") % 360
    return {
        "camera": camera,
        "lat": number_in_range(data.get("lat"), -90, 90, "lat"),
        "long": number_in_range(data.get("long"), -180, 180, "long"),
        "orientation_deg": orientation,
        "fov_deg": number_in_range(data.get("fov_deg"), 1, 360, "fov_deg"),
        "range_m": positive_number(data.get("range_m"), "range_m"),
    }


def finite_number(value, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = math.nan
    if not math.isfinite(number):
        raise ValueError(f"{name} must be a finite number.")
    return number


def number_in_range(value, minimum: float, maximum: float, name: str) -> float:
    number = finite_number(value, name)
    if number < minimum or number > maximum:
        raise ValueError(f"{name} must be between {minimum:g} and {maximum:g}.")
    return number


def positive_number(value, name: str) -> float:
    number = finite_number(value, name)
    if number <= 0:
        raise ValueError(f"{name} must be greater than 0.")
    return number
