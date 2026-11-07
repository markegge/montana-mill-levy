#!/usr/bin/env bash
# Step 6: one parcels + one buildings PMTiles covering every county that has derived GeoJSON
# (tippecanoe >= 2.79 writes .pmtiles directly). Output: data/derived/all/{parcels,buildings}.pmtiles
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)/data/derived"
mkdir -p "$D/all"
PARCELS=(); BUILDINGS=()
for c in gallatin yellowstone; do
  [ -f "$D/$c/parcels.geojson" ] && PARCELS+=("$D/$c/parcels.geojson")
  [ -f "$D/$c/buildings.geojson" ] && BUILDINGS+=("$D/$c/buildings.geojson")
done
tippecanoe -q -o "$D/all/parcels.pmtiles" -l parcels -Z9 -z16 --force \
  --drop-densest-as-needed --extend-zooms-if-still-dropping --simplification=4 --detect-shared-borders \
  --coalesce-smallest-as-needed --no-tile-size-limit "${PARCELS[@]}"
tippecanoe -q -o "$D/all/buildings.pmtiles" -l buildings -Z13 -z16 --force \
  --drop-densest-as-needed --no-tile-size-limit "${BUILDINGS[@]}"
ls -la "$D"/all/*.pmtiles
