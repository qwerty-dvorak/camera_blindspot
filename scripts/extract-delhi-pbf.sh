#!/usr/bin/env bash
set -euo pipefail

# Extract a small Delhi-area PBF from a larger regional PBF using osmium.
#
# The bounding box is derived from the "Seeded Connaught Place" region in
# blindspot/management/commands/seed.py and extended ~15km outward to cover
# a usable test area.  Seed.py reference values:
#   north=28.6342, south=28.6287, east=77.2224, west=77.216
#
# This produces a much smaller PBF (~10-20 MB vs. ~211 MB) that imports
# quickly and uses far less RAM on low-resource VMs.
#
# Prerequisites: Docker (any image with osmium-tool works).
#
# Usage:
#   bash scripts/extract-delhi-pbf.sh [source.pbf]
#
#   source.pbf   Path to the large PBF (default: pbf_files/northern-zone-260523.osm.pbf)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PBF_DIR="$SCRIPT_DIR/../pbf_files"

SOURCE="${1:-$PBF_DIR/northern-zone-260523.osm.pbf}"
OUTPUT="$PBF_DIR/delhi.osm.pbf"

# Extended Delhi bounding box (Connaught Place center ±~15km)
BBOX="76.95,28.45,77.35,28.75"

if [ ! -f "$SOURCE" ]; then
  echo "ERROR: source PBF not found: $SOURCE"
  echo "Place a larger PBF (e.g. from Geofabrik) at that path, or pass an alternative:"
  echo "  $0 /path/to/region.osm.pbf"
  exit 1
fi

echo "Extracting Delhi bbox ($BBOX) from: $SOURCE"
echo "Output: $OUTPUT"

docker run --rm \
  -v "$(realpath "$SOURCE"):/data/input.osm.pbf:ro" \
  -v "$(realpath "$PBF_DIR"):/data/output" \
  ubuntu:22.04 \
  bash -c '
    set -euo pipefail
    apt-get update -qq && apt-get install -y -qq osmium-tool >/dev/null 2>&1
    osmium extract \
      --bbox "'"$BBOX"'" \
      /data/input.osm.pbf \
      -o /data/output/delhi.osm.pbf
  '

echo "Done. Extracted PBF size:"
ls -lh "$OUTPUT"
