#!/usr/bin/env sh
set -eu

VERSION="1.141"
URL="https://github.com/CesiumGS/cesium/releases/download/${VERSION}/Cesium-${VERSION}.zip"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
VENDOR_DIR="${ROOT_DIR}/blindspot/static/vendor"
CESIUM_DIR="${VENDOR_DIR}/cesium"
ARCHIVE="${VENDOR_DIR}/Cesium-${VERSION}.zip"
TMP_DIR="${VENDOR_DIR}/.cesium-${VERSION}"

mkdir -p "$VENDOR_DIR"
curl -L "$URL" -o "$ARCHIVE"
rm -rf "$TMP_DIR" "$CESIUM_DIR"
mkdir -p "$TMP_DIR"
unzip -q "$ARCHIVE" -d "$TMP_DIR"
CESIUM_BUILD_DIR="$(find "$TMP_DIR" -type d -path '*/Build/Cesium' -print -quit 2>/dev/null || true)"
if [ -z "$CESIUM_BUILD_DIR" ]; then
  echo "Could not find Build/Cesium directory in extracted archive" >&2
  ls -la "$TMP_DIR"
  exit 1
fi
mkdir -p "$CESIUM_DIR"
cp -R "$CESIUM_BUILD_DIR/." "$CESIUM_DIR"/
rm -rf "$TMP_DIR" "$ARCHIVE"

echo "Cesium ${VERSION} installed in ${CESIUM_DIR}"
