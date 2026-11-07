#!/usr/bin/env bash
# Rebuild all derived data + public/data from the raw inputs in data/raw/<county>/ (see README).
# Needs MSSQL_SA_PASSWORD for the ORION export step.
set -euo pipefail
cd "$(dirname "$0")"
for c in ${COUNTIES:-gallatin yellowstone}; do
  ./orion_attach.sh "$c"              # needs Docker; reuses a running orion-test/orion container
  uv run python 01_extract_orion.py --county "$c"
  uv run python 02_levies.py --county "$c"   # fetches Treasurer statements into data/raw/<c>/ (cached)
  uv run python 03_parcels.py --county "$c"
  uv run python 04_buildings.py --county "$c"
  uv run python 05_boundaries.py --county "$c"
done
./06_tiles.sh                         # one PMTiles pair covering all counties -> data/derived/all/
uv run python 07_publish.py           # merges counties into public/data/
uv run python 08_validate.py          # VALIDATION.md + public/data/validation.json
