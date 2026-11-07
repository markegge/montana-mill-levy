#!/usr/bin/env bash
# Rebuild all derived data + public/data from the raw inputs in data/raw/ (see README).
set -euo pipefail
cd "$(dirname "$0")"
./orion_attach.sh            # needs Docker; reuses a running orion-test/orion container
uv run python 01_extract_orion.py
uv run python 02_levies.py   # fetches Treasurer PDFs into data/raw/itax/ (cached)
uv run python 03_parcels.py
uv run python 04_buildings.py
uv run python 05_boundaries.py
./06_tiles.sh
uv run python 07_publish.py
uv run python 08_validate.py
