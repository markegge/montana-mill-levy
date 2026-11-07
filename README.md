# Montana Mill Levy Calculator

Live: https://mills.egge.us (also https://mill-levy.mark-30e.workers.dev)

Only Gallatin County is loaded so far.

This is a parcel-level map of TY2026 and TY2025 general property taxes in Gallatin County, Montana, paired with a mill-levy revenue calculator. Taxable values come from Montana DOR's ORION CAMA database. Mills come from the Gallatin County Treasurer's own tax statements.

- **Map:** each parcel is colored by annual tax. 3D Overture building footprints are colored by the structure share of the tax, and tax labels appear when you zoom in. Clicking a parcel or building opens a breakdown by land and structure, by jurisdiction group, and by levy line item, with a link to the county's tax statement.
- **Calculator:** choose the county, a city, any other imported district boundary, a drawn polygon/rectangle, or an uploaded shapefile/GeoJSON, then choose a mill rate. The outputs are:
  - revenue and value of a mill, both gross and net of TIF increment
  - property, parcel and household counts
  - the distribution of added cost per residential property
  - the taxable-base split
  - a choropleth of the added burden
- **Scope:** general property taxes only. Special assessments and fees, and overlay mills (conservation, open-space bond, zoning), are excluded. Personal and centrally assessed property is not mapped.

Validation results are in [VALIDATION.md](VALIDATION.md); the About modal on the site shows the county-wide checks. See PLAN.md for the full design.

## Layout

```
pipeline/   Python (uv) data pipeline, steps 01–08 + run_all.sh
data/reference/  small committed inputs (levy books, transportation district boundary, certified values, ORION docs)
data/raw/, data/derived/   gitignored (raw downloads, intermediate outputs, PMTiles)
public/data/  browser data produced by 07_publish.py (committed; no owner names or mailing addresses)
src/        Vite + React + TS frontend (MapLibre + OpenFreeMap, pmtiles, Recharts, terra-draw, shpjs)
```

## Rebuilding the data

Prerequisites: Docker, uv, tippecanoe ≥ 2.79, poppler (`pdftotext`), and (optionally) `pmtiles` (brew).

1. Put the raw inputs in `data/raw/`. PLAN.md §2 lists the URLs.
   - `orion/COUNTY6_Gallatin_ORION_2026-11-06.zip`: the ORION SQL DB.
   - `cadastral/Gallatin_GDB.zip`: unzip it so that `cadastral/Gallatin_Parcels.gdb` exists.
   - `overture/gallatin_buildings.parquet`: download it with
     `uvx --from overturemaps overturemaps download --bbox=-112.10,44.35,-110.20,46.20 -f geoparquet --type=building -o data/raw/overture/gallatin_buildings.parquet`
2. Run `cd pipeline && uv sync && ./run_all.sh`.
   - `orion_attach.sh` starts SQL Server 2022 Express in Docker (container `orion`, port 14333 on localhost) and attaches the MDF. It reuses an existing `orion-test`/`orion` container if one is running, then bcp-exports the tables. Set `MSSQL_SA_PASSWORD` first (for the existing `orion-test` container, the password it was created with).
   - `02_levies.py` downloads one Treasurer tax-comparison PDF per levy district (about 140 PDFs, cached in `data/raw/itax/`).
   - `08_validate.py` rewrites `VALIDATION.md` and `public/data/validation.json`. It also fetches 40 random bills for an independent check.

Restart the ORION container later with `docker start orion` (or `orion-test`). If you need a fresh one, run `pipeline/orion_attach.sh`.

### Method notes

- **Tax.** Tax = ORION taxable value × the Treasurer-billed mills for the property's levy district. Where ORION's TotalMills already equals the bill, ORION's per-row TaxAmount is used unchanged.
  - ORION's TY2025 mills are stale for many districts; Belgrade, for example, shows 446.87 against a billed 680.06.
  - Ten TY2026 districts omit the 1.74-mill countywide planning levy.
  - Mobile homes on others' land keep ORION's prior-year-mills amount.
  - Independent check: 40 random properties per year match their real bills to the cent (V12).
- **Line-item mills.** These come from each district's sample bill: line amount ÷ Σ line amounts × billed total mills.
- **Structure tax per footprint.** It is allocated by footprint area × height (Overture height, else floors × 3.2 m, else a class default). Sheds under 30 m² are excluded when the parcel has other footprints.
- **Calculator membership.** A property counts as inside a district when its parcel's representative point falls inside the polygon. Condo units sit on their master parcel.

## Development and deploy

```bash
npm_config_cache=/tmp/npm-cache-milllevy npm install
npm run dev            # uses public/tiles/*.pmtiles (copied there by 07_publish.py, gitignored)
npm run build          # tsc + vite; strips dist/tiles
npm_config_cache=/tmp/npm-cache-milllevy npx wrangler@4 deploy   # Worker "mill-levy", static assets from dist/
```

Production tiles are in the R2 bucket `mill-levy-tiles`, served from its custom domain https://mills-tiles.egge.us (zone egge.us). That URL is set in `.env.production` as `VITE_TILES_BASE`. To update the tiles:

```bash
for f in parcels buildings; do npx wrangler@4 r2 object put mill-levy-tiles/gallatin/$f.pmtiles \
  --file data/derived/$f.pmtiles --content-type application/octet-stream --remote; done
```

The bucket's CORS rules come from `cors.json` (GET/HEAD from mills.egge.us, the workers.dev URL and localhost:5173, exposing range headers). Deploys use an authenticated `wrangler login` session.

The Worker serves https://mills.egge.us as a Workers Custom Domain (`routes` in `wrangler.jsonc`).

## Data sources and attribution

| Data | Source | Terms |
|---|---|---|
| Property values, taxable values, class codes | Montana Department of Revenue, ORION property database (via Montana State Library, 2026-11-06) | Public record |
| Parcel polygons | Montana State Library, Montana Cadastral (Gallatin County, 2026-11-03) | Public record |
| District boundaries | Montana State Library, Administrative Boundaries Framework | Public record |
| Mill levies | Gallatin County Treasurer tax statements and mill levy books | Public record |
| Certified taxable values | Montana DOR Certified Values portal | Public record |
| Building footprints and heights | [Overture Maps Foundation](https://overturemaps.org), buildings theme, release 2026-10-21.0 | Per Overture's [attribution and licensing](https://docs.overturemaps.org/attribution/): ODbL (OpenStreetMap-derived features) and CDLA Permissive 2.0 |
| Basemap | [OpenFreeMap](https://openfreemap.org), with data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) | ODbL; attribution shown on the map |
| Fonts | Inter, Nunito (SIL Open Font License 1.1, self-hosted); JetBrains Mono (OFL, Google Fonts) | OFL 1.1 |

Owner names and mailing addresses are in the source data but are not published here. Sample tax statements used for validation are kept out of the repository because they name the owner; see `data/README.md` for how to fetch them.

## License

Code: MIT (see LICENSE). Data files keep the terms of their sources listed above.
