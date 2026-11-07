#!/usr/bin/env bash
# Step 6: PMTiles for parcels and buildings (tippecanoe >= 2.79 writes .pmtiles directly).
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)/data/derived"
tippecanoe -o "$D/parcels.pmtiles" -l parcels -Z9 -z16 --force \
  --drop-densest-as-needed --extend-zooms-if-still-dropping --simplification=4 --detect-shared-borders \
  --coalesce-smallest-as-needed --no-tile-size-limit \
  "$D/parcels.geojson"
tippecanoe -o "$D/buildings.pmtiles" -l buildings -Z13 -z16 --force \
  --drop-densest-as-needed --no-tile-size-limit "$D/buildings.geojson"
ls -la "$D"/*.pmtiles
