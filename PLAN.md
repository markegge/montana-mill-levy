# Montana Mill Levy Calculator + Tax Burden Map — Implementation Plan

Original implementation plan, 2026-11-07. Kept for reference; the README and VALIDATION.md describe what was actually built (some decisions changed during implementation).

Project dir: repository root.
Everything cited in this plan has been verified today unless marked **UNVERIFIED**. Reference files are in `data/reference/`; raw downloads are already staged in `data/raw/` (gitignored) so the builder does not need to re-download ~1 GB.

---

## 1. Goals

1. **Tax-burden map of Gallatin County**: every parcel colored by annual property tax; 3D-extruded building footprints (structures only, not land) colored/labeled with the tax attributable to the structure; label with the annual tax when zoomed in (z ≥ 16); click a parcel or building → side panel with the full breakdown (land vs. structure; by taxing jurisdiction: state, county, city, elementary school, high school, fire, other special districts) and a chart.
2. **Mill levy revenue calculator**: pick a district (GVUTD built in; any imported boundary: county, city, school district, fire district, etc.; a drawn polygon; an uploaded shapefile/GeoJSON) and a mill rate (slider + presets) → revenue, taxable-value base, parcel/household count, distribution of the added cost per residential property (median, P25/P75/P90, histogram), and a choropleth of the added burden.
3. **Accurate for the Gallatin Valley Urban Transportation District (GVUTD)**: revenue at N mills using DOR's own certified-equivalent taxable values (not an approximation), with the statutory context (MCA 7-14-232, 15-10-420, HB 20 dollar-based levies) explained.
4. **Trustworthy numbers**: reconcile against DOR certified values and real tax bills (§9). Show data vintage and caveats in the UI.
5. Phase 1 = Gallatin County, shipped today to Cloudflare. Phase 2 = statewide + refinements (§10).

---

## 2. Data sources

### 2.1 The decisive finding: use ORION (DOR's CAMA database), not the cadastral attributes, for values

The cadastral FGDB has only **market** values and no residential/commercial flag, no taxable value, no mills, no condo units. But the Montana State Library also publishes **DOR's ORION property database per county as a SQL Server MDF**, refreshed monthly, and it contains per-property, per-class-code rows with DOR's computed **TaxablePct, TaxableValue, TotalMills and TaxAmount** for TY2024–2026, plus condo units and dwelling/commercial-building records. I attached it in Docker and verified it reproduces real 2026 tax bills to the cent (§9). This is the primary value source. The cadastral FGDB supplies geometry only.

| Source | URL | Vintage | Role |
|---|---|---|---|
| **ORION Gallatin SQL DB** | `https://ftpgeoinfo.msl.mt.gov/Data/Spatial/MSDI/Cadastral/ORION_SQLDatabases/COUNTY6.ZIP` (128 MB zip → `Output.mdf` 803 MB). County numbers = DOR county code (Gallatin = 06). Docs: `.../ORION_SQLDatabases/BEGIN%20HERE.zip` (staged in `data/reference/orion-docs/`). Statewide file exceeds SQL Express 10 GB limit; per-county files do not. | 2026-11-06 | **Primary**: values, taxable values, tax, class codes, levy district, condo units, dwelling counts |
| **Montana Cadastral parcels, Gallatin FGDB** | `https://ftpgeoinfo.msl.mt.gov/Data/Spatial/MSDI/Cadastral/Parcels/Gallatin/Gallatin_GDB.zip` (14 MB; `_SHP.zip` 20 MB also available). Statewide: `.../Parcels/Statewide/MTParcels_GDB.zip` (250 MB). Monthly refresh (this one 2026-11-03). | 2026-11-03 | Parcel polygons; join key `PARCELID` (17-digit geocode, no dashes) |
| **Gallatin County 2025 mill levy book** | `https://gallatinmt.gov/DocumentCenter/View/2785/2025-MILL-LEVY-INFORMATION` (PDF, 18 pp; 2024: `/View/644/2024-MILL-LEVY-INFORMATION`). Staged: `data/reference/gallatin_2025_mill_levy.{pdf,txt}`. **No 2026 book is posted yet** (as of today). | TY2025 | Per-levy-district component mills (state/county/school/city/fire/cemetery/road/library/planning/mosquito) |
| **Gallatin County iTax tax comparison PDFs** | `https://itax.gallatin.mt.gov/PDF/2026/RE/{AssessmentCode}.pdf` (and `/PDF/2025/RE/`). Generated on demand for any real-estate assessment code (e.g. `RFG16430`); TY2026 comparisons exist as of 2026-11-03 (bills not yet mailed). The full TY2025 bill with per-line mills: `.../PDF/2025/RE/RGF65523-00030954.pdf` (staged). | TY2026 | TY2026 per-line-item amounts per property → derive TY2026 component mills per district (§6 step 5); spot-check ground truth |
| **DOR Certified Values portal** | `https://svc.mt.gov/dor/oriondataportal/Public/PropertyMTGov/CertifiedValues.aspx` (ASP.NET form: County=206 Gallatin, Tax Year, Taxing Jurisdiction e.g. `206-2026-TJ-06-CNTYWID`). No download; scrape the HTML table with Playwright or copy by hand. Property lookup: `.../PropertySearch.aspx` by geocode/assessment code. | TY2025 + TY2026 | Validation totals (§9) |
| **MSL Administrative Boundaries FeatureServer** | `https://services.arcgis.com/qnjIrwR8z5Izc0ij/arcgis/rest/services/Montana_Administrative_Boundaries_Framework/FeatureServer/{layer}/query?where=...&outSR=4326&f=geojson` (maxRecordCount 2000). Layers: 5 counties, 7 incorporated cities/towns (`NAME`, `COUNTYNAME`), 10 elementary SDs, 11 secondary SDs, 12 unified SDs, 15 TIFDs, 45 fire districts, 42 cemetery, 49 mosquito, 57 special districts, 59 sewer, 60 water, 58 rural improvement districts, **61 urban transportation districts** (contains `GALLATIN VALLEY URBAN TRANSPORTATION DISTRICT`, OBJECTID 1203, source "County GIS", updated 2022-08-23, 75.49 sq mi), 16 (table) TIFD↔levy district. Bulk zips: `https://ftpgeoinfo.msl.mt.gov/Data/Spatial/MSDI/AdministrativeBoundaries/MontanaIncorporatedCitiesTowns_shp.zip`, `MontanaCounties_shp.zip`, `MontanaSchoolDistricts_shp.zip`, `MontanaTIFDs_shp.zip`. | 2025–2026 | Importable boundaries |
| **Bozeman GIS** | `https://gisweb.bozeman.net/arcgis/rest/services/Public/COB_Base_Layers/MapServer` layers 33 City Limits, 31 Buildings (2015, has `MaxHeight`), 10–16 TIF/URDs, 7 SID boundaries; `.../Public/Gallatin_County_School_Districts/MapServer/0,1` (elementary/high, field `LevyDistri` = levy district code). Supports `f=geojson`. | 2015–2026 | Optional extra boundaries. Gallatin County's own `gis.gallatin.mt.gov` REST server timed out from here (both curl and browser); do not depend on it. |
| **Overture Maps buildings** | release `2026-10-21.0`; extract with `uvx --from overturemaps overturemaps download --bbox W,S,E,N -f geojson --type building -o out.geojson`. Bozeman bbox (-111.12,45.63,-110.95,45.73) → 25,870 footprints, 74% with `height` (USGS lidar), classes house/apartments/commercial. Staged: `data/raw/overture/overture_buildings_bozeman_bbox_2026-10-21.geojson` (20 MB). County-wide bbox for Phase 1: `-112.10,44.35,-110.20,46.20`. | 2026-10 | 3D structure footprints |
| **Census TIGER 2025** (fallback boundaries only) | `https://www2.census.gov/geo/tiger/TIGER2025/COUNTY/tl_2025_us_county.zip`, `.../PLACE/tl_2025_30_place.zip`, `.../UNSD/tl_2025_30_unsd.zip`, `.../ELSD/tl_2025_30_elsd.zip`, `.../SCSD/tl_2025_30_scsd.zip` **UNVERIFIED** exact filenames (standard TIGER naming) | 2025 | Only if MSL is down |
| Law/policy | HB 231 & SB 542 summary (Legislative Services, May 2025): `https://archive.legmt.gov/content/Publications/fiscal/2027-Biennium/Publications-and-Libraries/Libraries/Property-Tax/HB231-SB542-Summary.pdf` (staged). MCA: `https://mca.legmt.gov/bills/mca/title_0150/chapter_0100/part_0040/section_0200/0150-0100-0040-0200.html` (15-10-420), `.../title_0070/chapter_0140/part_0020/section_0320/0070-0140-0020-0320.html` (7-14-232), `..._0310...` (7-14-231). DOR 2025 value changes: `https://revenue.mt.gov/property/property-tax-changes/2025-property-value-changes`. | 2025 | Tax model text |

### 2.2 ORION schema (verified by attaching `COUNTY6.ZIP`)

36 tables. The ones we use (TaxYear ∈ {2024, 2025, 2026}; join on `PropertyID` + `TaxYear`):

- **Property** (204,208 rows; TY2026: 67,054 `RP` real property + 1,540 `PP` + 16 `CA`): `PropertyID, TaxYear, GeoCode` ('06-0797-11-2-10-15-7028' → strip dashes = cadastral `PARCELID`), `AssessmentCode` ('00RGF65523' → strip leading '00' = iTax code), `LevyDistrict` ('06-036304-27 04', same format as cadastral), `PropCategory` (RP/PP/CA), `PropSubCategory` (TY2026 counts: RP 43,642; COMM 7,251; AG_TMBR 5,117; NONQ 3,152; MH 2,775; GOV 2,545; MH_REAL 1,375; C_MSTR 870 condo masters; MIX_USE 202; IndRP 70; CENTRAL 47; …), `LivUnits`, `Dwel_Val, MOB_Val, Com_Val, ObyFlat_Val, TotImpt_Val, TotMarket_Val, TotAg_Val, …`, `Addr_Number, Addr_Street, Addr_City, Addr_UnitNumber`, `Condo_GenPct`, `NBHD`, `Zoning`.
- **Assessment** (383,227 rows; TY2026: 129,418): one row per property per **class code** (land and buildings are separate rows): `ClassCode, LandValue, BuildingValue, TotalValue, ExemptValue, TaxableMktValue, TaxClass, TaxablePct, TaxableValue, TIFBaseVal, TIFIncVal, TotalMills` (varchar), `TaxAmount`. Sums: TY2026 market $58.59 B, taxable **$756,981,782**; TY2025 taxable $675,694,357; TY2024 $693,606,540.
- **ClassCodes** lookup (1,254): e.g. 2201 Residential Land, 3501 Residential Buildings & Improvements, 2207/3507 Commercial Land/Buildings, 2227/3527 Multifamily, 3110 Improvements on Ag Land, 2002 1-Acre Bldg Site on Non-Qualified Ag Land, 1701 Non-Qualified Ag Land 20–160 ac, 1101/1401/1501/1601/1801 ag land, 6201 Manufactured & Mobile Homes, 3817/2611 industrial, 2132/2137/3137 Property Tax Assistance reductions, 3505 "Residential … Default Rate" (owner did not apply / defaulted to non-homestead).
- **CondoMaster** (31,134): `PropertyID (unit), TaxYear, CondoMasterId (master PropertyID)`. TY2026: **10,510 condo units in 902 masters**. Unit geocode ends in a non-0000 unit suffix (…-7028); the master's geocode (…-7000) is the polygon in the cadastral layer (master `PropSubCategory='C_MSTR'`, cadastral `PropType='Non-Valued Property'`, `AssessmentCode` like `FERNCONMST`).
- **Res** (dwellings; TY2026: 43,323 properties with 1 dwelling, 1,616 with 2, 116 with 3, 36 with 4+): `ResID, PropertyID, YearBuilt, StoryHeight, SFLA, Bedrooms, FullBaths, GarageCap, RCNLD` (depreciated replacement cost = DOR's building-value proxy), `Style_Desc, Grade`.
- **Com** (commercial buildings): `BuildingNumber, UnitsPerBldg, StructureType_Desc, YearBuilt, RCNLD, TotCostArea`.
- Also present, not needed in Phase 1: Owner/PartyName/PartyAddr, Deed, Permit, Exemptions, AgForest, MarketLand, Oby (outbuildings), FinalVal, Appeal.

Join rates measured (TY2026 RP): 52,959 / 67,054 properties match a cadastral polygon directly by geocode ($633.2 M of $757.0 M taxable). Of the 14,095 unmatched: 10,510 are condo units (resolve via CondoMaster → master geocode), 2,775 are `MH` mobile homes on others' land and 3,205 of the unmatched match a parent when the 4-digit suffix is replaced by `0000`. Expected mapped coverage after both rules ≥ 97% of taxable value; report the residual in the validation log.

### 2.3 Cadastral FGDB (verified)

`Gallatin_Parcels.gdb`, one layer `OwnerParcel`, 53,638 MultiPolygons, CRS **EPSG:6514** (NAD83(2011) Montana State Plane, meters), `TaxYear=2026`. 596 rows have null `PARCELID`/no attributes (slivers; drop). Fields: `PARCELID, COUNTYCD(6), GISAcres, TaxYear, PropertyID, AssessmentCode, Township, Range, Section, LegalDescriptionShort, Subdivision, CertificateOfSurvey, AddressLine1/2, CityStateZip, PropAccess, LevyDistrict (139 distinct, e.g. '06-035008-7C 08'), PropType ('Improved Property' 35,217; 'Vacant Land' 9,254; 'Exempt Property' 2,673; 'Townhouse' 2,640; 'Non-Valued Property' 1,634; 'Apartment' 1,263; …), *Acres, TotalBuildingValue, TotalLandValue, TotalValue, Owner*`. Market totals: $51.08 B (land $20.03 B, buildings $31.05 B). Read with `pyogrio` (wheels bundle GDAL with the OpenFileGDB driver; system GDAL is not installed and is not needed).

### 2.4 Levy district coding

`06-036304-27 04` = DOR county 06, OPI/levy code 0363 + sub-district 04, then the school district label (`27`) and sub-code (`04`). The county book's consolidated table uses the first 9 characters (`06-036304`); the tax bill prints `0363-04`. Sub-district suffixes are combinations of fire district (CVF/HF/GGF/BCF/SMF/AF/MF/TF/WF/SF/GRRF/BSF/HBF), cemetery (MV/MG/FC), planning (GP/BZP/BGPC/BGPR/MPC/MPR) and mosquito (TRM) overlays; e.g. `27 Monforton-CVF-GP`. TIFD districts are `06-0350T1…T6` (Bozeman) and `06-0368T1` (Belgrade).

---

## 3. Tax model (formulas)

### 3.1 Core identities (MCA 15-6, 15-8, 15-10; all tax bills confirm them)

```
taxable_value   = market_value × class_rate               (DOR; rounded to whole dollars per class-code row)
tax_i           = taxable_value × mills_i / 1000          (per levy line item i)
annual_tax      = taxable_value × total_mills / 1000  (+ special assessments, which are NOT mills)
levy_revenue    = Σ_parcels_in_district taxable_value × mills / 1000     ("value of a mill" = Σ taxable_value / 1000)
```

Land and improvements: for Class 4 residential/commercial the graduated rate is applied to the **property's total market value (land + buildings together)**, then the resulting effective rate is applied to the land row and the building row separately. Evidence: bill RGF65523 TY2025 shows land $19,328 → $158 and building $465,472 → $3,817, both at 0.82% = blended rate of the $484,800 total through the 2025 tiers ($400,000×0.76% + $84,800×1.10% = $3,973 ≈ $3,975). ORION stores this as `TaxablePct` per Assessment row. So **land tax vs. structure tax = taxable value of the land row(s) vs. the building row(s) × the same mills**; the app reads these rows directly rather than recomputing.

Agricultural land (Class 3) is valued by productivity, not market; the 1-acre homesite under a house on ag/non-qualified land is class 2002/2003 and is taxed at the residential rate; improvements on ag land are class 3110 at the residential rate. Non-qualified ag land (20–160 ac without an approved ag application) is class 1701 at 7× the ag rate.

### 3.2 Class rates (Legislative Services summary of HB 231 / SB 542, May 2025; DOR medians verified against 2026 bills)

| Tax year | Residential (Class 4) | Commercial/Industrial (Class 4) | Ag (Class 3) |
|---|---|---|---|
| 2024 | 1.35% all; dwelling value > $1.5 M at 1.89% | 1.89% | 2.16% qualified / 15.12% non-qualified |
| **2025** | Graduated on total value: first $400,000 at **0.76%**, $400,000–$1.5 M at **1.10%**, above $1.5 M at **2.20%**; multifamily rental > $2 M capped at 1.89% | first $400,000 at **1.40%**, above at **1.89%** | 2.05% / 14.35% |
| **2026** | **Homestead** (principal residence or qualified long-term rental, application-based): ≤ median at **0.76%**, median–2× at **0.90%**, 2×–4× at **1.10%**, ≥ 4× at **1.90%**, where statewide median residential value = **$378,000** (DOR final; tiers $378,000 / $756,000 / $1,512,000). **Non-homestead** (second homes, STRs, unenrolled): flat **1.90%**. Long-term-rental multifamily 1.10%. Residence on qualified ag 1.35%. | < 6× statewide median commercial value ($379,000 → $2,274,000) at **1.50%**, above at **1.90%** | 2.05% / 14.35% |

Verified against real bills: RGF65523 (condo, $484,800) TY2026 taxable $3,830 = $378,000×0.76% + $106,800×0.90% → homestead; RFG16430 ($1,724,086 non-qualified-ag homesite + house) TY2026 taxable $18,649 = homestead tiers through the 4× bracket. TY2026 ORION `TaxablePct` for residential land (class 2201): 15,630 rows at 1.90% (non-homestead) vs. ~30,000 rows at blended 0.76–1.10% (homestead). **Homestead status is therefore known per property in ORION** and is unknowable from the cadastral alone.

Other TY2025/2026 facts the UI should state: one-time $400 principal-residence rebate (2025 only, not a tax-bill item); HB 20 (2025) requires all new voted levies to be dollar-based; fixed-mill levies had to be recalculated in 2025 to raise 2024 revenue (SB 542). 2025 Legislature also added "Countywide Elem/HS Base Funding" school levies that appear on 2026 bills.

### 3.3 Mills

- **Statewide mills** on every Gallatin property: 95 school equalization (40 state equalization aid + 33 elementary + 22 high school) + 6 university + 1.5 Gallatin College (MCA 20-25-439) = **102.5**.
- **County base (all districts)** TY2025: 84.27; countywide school (retirement + transportation) 24.74; rural-only road 12.08 + library 3.40.
- **Cities** TY2025: Bozeman 190.71, Belgrade 233.19 (+2.53 planning), Manhattan 119.25, Three Forks 125.39, West Yellowstone 24.98.
- **Schools** TY2025: Bozeman elem 89.96 / HS 67.68; Belgrade elem 111.07 / HS 63.90; Monforton elem 77.41; etc. (full table in the book).
- **Totals** TY2025 → TY2026 (from bills): Bozeman city `06-035008` 559.86 → **531.99**; `06-036304` Monforton-CVF-GP 431.72 → **405.76**; `06-235004` Bozeman rural-CVF-GP 444.27 → **415.92**. Mills fell 5–7% because taxable value rose (dollar-based levies float down).
- Not in the consolidated total but on bills as "special assessments" expressed in mills: Gallatin Conservation District 0.52, Open Space Bond 0.90, zoning districts (0.45–21.58), water/sewer districts (River Rock 55.36), lighting districts. Plus flat fees (Gallatin Water Quality $7.26, Four Corners W/S $477.10/parcel, RIDs, street maintenance). **Phase 1 models the consolidated general mills only** and labels the panel "excludes special assessments (SIDs, RIDs, W/S fees, street maintenance) and minor overlay mills (conservation, open-space bond, zoning)". The ORION `TaxAmount` is the general tax only, so this is consistent.

### 3.4 Levy limits (MCA 15-10-420) — shown as context, not modeled

Each jurisdiction may levy mills sufficient to raise prior-year actual property-tax revenue + the average of the prior 3 years' inflation (capped at 4%; 2025 SB 117 revised the formula effective TY2026), computed on the base excluding newly taxable property; the mills then apply to all property including newly taxable property. Unused authority can be banked/carried forward. Voter-approved levies are additional and (since HB 20) must be dollar-based. Exclusions: judgment, emergency, airport, certain school levies (15-10-420(5),(8)). The calculator shows: value of a mill, revenue at N mills, and a note that for an **existing** district N is constrained by 15-10-420 while a **new voted** levy is set by the ballot's dollar amount (mills then float). It does not attempt the 15-10-420 arithmetic in Phase 1.

### 3.5 What the app computes from ORION vs. what it recomputes

- Per property, per tax year: `taxable_land = Σ TaxableValue of land class rows`, `taxable_bldg = Σ building class rows`, `tax_total = Σ TaxAmount`, `mills = mode(TotalMills)`; `tax_by_jurisdiction = taxable_total × component_mills_j / 1000` using the levy-district component table (§6 step 5). Cross-check Σ_j component_mills_j ≈ TotalMills (tolerance 0.05 mills; log violations).
- Calculator "what-if N mills": `added_tax = taxable_total × N / 1000` per property; never re-derives taxable value. A toggle "treat all residential as homestead" is **not** offered in Phase 1 (ORION already encodes it). A "tax year" switch (2025 / 2026) is offered because both are in ORION.

---

## 4. GVUTD specifics

- **What it is**: Gallatin Valley Urban Transportation District, created by a 2023-05-02 election (79% yes) under MCA 7-14-2xx; took over Streamline operations from HRDC on 2025-07-01 (`https://thehrdc.org/hrdc-news/gvutdlaunch`, `https://www.explorebigsky.com/streamline-bus-transitions-to-new-taxpayer-funded-transportation-district`). Board page: `https://streamlinebus.com/gvutd-board/`.
- **Does it levy today? No.** DOR's TY2025 and TY2026 certified-value jurisdiction lists for Gallatin County (87 jurisdictions each) contain no UTD/transportation entry, and no 2025/2026 bill line item exists. Funding is federal + city/county/MSU contributions + partners. The 2023 campaign materials said the board "would have authority to ask voters for additional investment through a mill levy in the future." No 2026 levy election was found (searched today).
- **Statute**: 7-14-231 the board presents its budget to the county commissioners annually; 7-14-232 the commissioners "fix and levy a tax in mills upon all property within the transportation district sufficient to operate the district, taking into account the amount requested by the board", subject to 15-10-420; 7-14-233 county treasurer collects; 7-14-235/236 bonds. **No numeric mill cap was found in 7-14-232** (UNVERIFIED whether another section or the district's creation resolution caps it; flag for Mark).
- **Boundary**: two sources, both staged in `data/reference/`:
  1. `gvutd_boundary_msl.geojson` — the MSL Administrative Boundaries layer 61 polygon ("County GIS" source, updated 2022-08-23, 48,311 acres / 75.49 sq mi, bbox -111.227,45.635 → -110.984,45.817). **Use this.** It covers Bozeman, Belgrade, Four Corners and the corridor between.
  2. `gvutd_boundary_description.txt` — the full legal description from the Belgrade agenda packet (`https://www.belgrademt.gov/AgendaCenter/ViewFile/Item/410?fileID=534`), for QA of the polygon's edges (e.g. Goldenstein Ln / S 19th / Blackwood / US-191 / Upper Rainbow / West Gallatin River … Penwell Bridge Rd / Ryen Glenn / Meadowlark Ranch / E Baseline / Tubb Rd … Story Mill / Bridger Creek / I-90 / Haggerty / Bozeman Trail / Kagy / Sourdough).
  Note: the MSL polygon predates any post-2022 annexations; the district boundary is fixed by the creation resolution, so that is correct.
- **How the calculator treats it**: GVUTD is a preset "district" = the polygon above. Members = properties whose representative point falls inside (§6 step 7). Output for TY2026 (and 2025): Σ taxable value (= value of a mill × 1000), count of properties, residential count, revenue at 1/2/5/10/15/20 mills (presets) and the slider (0–50 step 0.1), median/percentile added cost per residential property, split homestead vs. non-homestead vs. commercial, and city-vs-unincorporated split. Also show the newly-taxable share from DOR's county figures as context (TY2026 countywide newly taxable $16.0 M).
- **Sanity anchors** (TY2026 certified): County total taxable $809.1 M (real property $755.4 M); City of Bozeman TY2025 taxable $242.6 M (real $229.9 M), Belgrade $34.4 M. GVUTD contains all of Bozeman + Belgrade + the corridor, so expect roughly $300–340 M of taxable value, i.e. a mill ≈ $300–340 k. The builder must print the computed figure in the validation log and the README; if it falls outside $250–400 M, stop and debug the point-in-polygon step.

---

## 5. Architecture

```
data pipeline (Python 3.12, uv)            static site (Vite + React + TS)            hosting
┌──────────────────────────────┐     ┌──────────────────────────────────┐     ┌──────────────────────┐
│ ORION MDF → SQL Server (Docker)│     │ MapLibre GL JS 6 + pmtiles 4     │     │ Cloudflare Worker     │
│   bcp → CSV                   │     │   basemap: OpenFreeMap positron  │     │  static assets (app)  │
│ cadastral FGDB (pyogrio)      │ ──▶ │   parcels.pmtiles (fill)         │ ◀── │ R2 public bucket      │
│ Overture buildings            │     │   buildings.pmtiles (extrusion)  │     │  (pmtiles, range req) │
│ levy book PDF + iTax PDFs     │     │ parcels_index.json (calc engine) │     └──────────────────────┘
│ MSL boundaries (REST)         │     │ terra-draw, shpjs, turf, recharts│
│ tippecanoe → PMTiles          │     │ side panel + calculator + legend │
└──────────────────────────────┘     └──────────────────────────────────┘
```

Decisions and why:

- **MapLibre GL JS, not Mapbox GL JS, for Phase 1.** No access token is needed, it is API-compatible for what we use (`fill-extrusion`, `symbol` labels, `queryRenderedFeatures`), and it reads PMTiles natively via `pmtiles.Protocol` + `maplibregl.addProtocol`. Mapbox GL v3 has no supported PMTiles path (it would need a tile proxy Worker). Swapping the basemap later does not change our own data layers.
- **Basemap**: OpenFreeMap `https://tiles.openfreemap.org/styles/positron` (verified 200; free, no key, OpenMapTiles schema). On load, hide its `building` layers so only our extrusions show. Pitch 45°, bearing 0, no terrain.
- **3D structures from Overture footprints**, not the basemap's buildings, because we must color each footprint by parcel attributes and the basemap's building features cannot be joined. Height = Overture `height` (m) when present, else `num_floors × 3.2`, else by class: house 6, apartments 9, commercial 5, default 5 m.
- **Building ↔ parcel join and multi-building allocation** (pipeline step 6): assign each footprint to the parcel containing its representative point (shapely `representative_point`). Per parcel, structure tax `tax_bldg` is allocated across its footprints **proportional to footprint area × height** (volume proxy); footprints with area < 30 m² (sheds) get zero unless they are the only footprint. Condo masters: the units' taxes are summed to the master parcel first, then allocated across the master's footprints the same way. A footprint with no parcel (ROW, exempt gaps) gets `tax=null` and renders grey.
- **Per-parcel attribute index in the browser** (`parcels_index.json`, ~67k rows, ~1.5 MB brotli) is what the calculator uses, so drawn/uploaded polygons select properties client-side with `@turf/boolean-point-in-polygon` on representative points (bbox prefilter first). No server, no DB.
- **PMTiles on R2** because the Workers static-assets limit is 25 MiB per file and parcels.pmtiles will likely exceed it; R2 supports HTTP range requests on public buckets with CORS and egress is free. Fallback if R2 cannot be created: host everything on GitHub Pages (100 MB/file limit, 1 GB site).
- **React 19 + TypeScript + Vite 7**, plain CSS (no Tailwind), **Recharts** for the breakdown chart (same lib as transit_benchmark), **terra-draw** + `terra-draw-maplibre-gl-adapter` for drawing, **shpjs** for `.zip` shapefile upload (also accept `.geojson`/`.json`), **@turf/turf** (boolean-point-in-polygon, area, bbox), **pmtiles**. Versions as of today: maplibre-gl 6.16.0, pmtiles 4.5.0, terra-draw 1.39.0, terra-draw-maplibre-gl-adapter 1.5.0, shpjs 6.2.0, @turf/turf 7.4.0, vite 8.3.6 (use `npm create vite@latest` default, React + TS template), typescript 7.0.2.
- **Pipeline**: Python 3.12 via `uv` (`uv init && uv add pyogrio geopandas shapely pandas pyarrow pdfplumber requests`), tippecanoe v2.79 (installed at `/usr/local/bin/tippecanoe`; writes `.pmtiles` directly with `-o x.pmtiles`), Docker 29 (x86_64, 34 GB RAM) for SQL Server 2022 (`mcr.microsoft.com/mssql/server:2022-latest`, Express edition flag, free). `pdftotext` (poppler) is installed; `ogr2ogr` is not and is not needed.

Repo layout:

```
mill-levy/
  PLAN.md  README.md  .gitignore  wrangler.jsonc  package.json  vite.config.ts  index.html
  pipeline/            # uv project
    pyproject.toml
    orion_attach.sh    # docker run + CREATE DATABASE ... FOR ATTACH_REBUILD_LOG + bcp exports
    01_extract_orion.py 02_parcels.py 03_levies.py 04_buildings.py 05_boundaries.py 06_tiles.sh 07_validate.py
    run_all.sh
  data/ raw/ derived/ reference/   (raw, derived gitignored; reference committed)
  src/
    main.tsx App.tsx
    map/ (MapView.tsx, layers.ts, style.ts, popup.ts)
    panel/ (PropertyPanel.tsx, BreakdownChart.tsx)
    calc/ (Calculator.tsx, districts.ts, select.ts, stats.ts, Upload.tsx, Draw.tsx)
    data/ (index.ts loads parcels_index.json + levies.json + districts.json; types.ts)
    ui/ (Legend.tsx, Controls.tsx, About.tsx)
  public/data/ (parcels_index.json, levies.json, districts.json, meta.json)   # ≤ 25 MiB each
  dist/                # build output; wrangler uploads dist/ as static assets
```

---

## 6. Pipeline steps (exact)

All commands run from the repository root. `run_all.sh` chains them; each script is idempotent and writes to `data/derived/`.

**Step 0 — environment.** `uv init pipeline --no-workspace` (or `cd pipeline && uv init`), `uv add pyogrio geopandas shapely pandas pyarrow pdfplumber requests tqdm`. `npm create vite@latest . -- --template react-ts` then `npm i maplibre-gl pmtiles @turf/turf terra-draw terra-draw-maplibre-gl-adapter shpjs recharts`. Verify `tippecanoe --version` and `docker info`.

**Step 1 — ORION extract (`orion_attach.sh`, `01_extract_orion.py`).** A container named `orion-test` with the Gallatin DB already attached may still be running from planning (`docker ps`); reuse it if so, else:
```bash
mkdir -p data/raw/orion/mssql && unzip -o data/raw/orion/COUNTY6_Gallatin_ORION_2026-11-06.zip -d data/raw/orion/ \
 && cp data/raw/orion/Output.mdf data/raw/orion/mssql/Gallatin.mdf && chmod 666 data/raw/orion/mssql/Gallatin.mdf
docker run -d --name orion --platform linux/amd64 -e ACCEPT_EULA=Y -e 'MSSQL_SA_PASSWORD=${MSSQL_SA_PASSWORD}' -e MSSQL_PID=Express \
  -v "$PWD/data/raw/orion/mssql:/data" -p 14333:1433 mcr.microsoft.com/mssql/server:2022-latest
# wait until: docker exec orion /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P '${MSSQL_SA_PASSWORD}' -Q "SELECT 1"
docker exec orion /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P '${MSSQL_SA_PASSWORD}' \
  -Q "CREATE DATABASE Gallatin ON (FILENAME='/data/Gallatin.mdf') FOR ATTACH_REBUILD_LOG;"
# bcp: note -u (trust cert) for bcp; -C means trust cert for sqlcmd but code page for bcp (this cost 10 minutes today)
docker exec orion /opt/mssql-tools18/bin/bcp "SELECT ... FROM Gallatin.dbo.Property WHERE TaxYear IN (2025,2026)" queryout /data/property.csv -c -t "|" -u -S tcp:127.0.0.1,1433 -U sa -P '${MSSQL_SA_PASSWORD}'
```
Export four pipe-delimited, header-less CSVs (already produced today and staged in `data/derived/` for Property, Assessment, CondoMaster; add Res):
- `property.csv`: `PropertyID, TaxYear, GeoCode, AssessmentCode, LevyDistrict, PropType, PropCategory, PropSubCategory, LivUnits, Dwel_Val, Com_Val, TotImpt_Val, TotMarket_Val, Addr_Number, Addr_Street, Addr_City`
- `assessment.csv`: `AssessmentID, PropertyID, TaxYear, ClassCode, LandValue, BuildingValue, TotalValue, ExemptValue, TaxableMktValue, TaxablePct, TaxableValue, TIFIncVal, TotalMills, TaxAmount`
- `condomaster.csv`: `PropertyID, TaxYear, CondoMasterId`
- `res.csv`: `ResID, PropertyID, TaxYear, YearBuilt, StoryHeight, SFLA, Bedrooms, RCNLD` and `com.csv`: `ComID, PropertyID, TaxYear, BuildingNumber, StructureType_Desc, YearBuilt, RCNLD`
- `classcodes.csv`: `Code, Description`.
Then build `properties.parquet` (one row per PropertyID × TaxYear, RP only): `geocode17` (dashes stripped), `assessment_code` (leading '00' stripped), `levy_district`, `levy_base` (first 9 chars), `subcat`, `is_residential` (ClassCode land row ∈ {2201, 2002, 2003, 2132, 2137} or building row ∈ {3501, 3505, 3110, 3115, 3137, 3140, 3142, 6201}), `is_commercial` (2207/3507/2227/3527/2611/3817/3607/2311/3671), `is_homestead` (residential and max TaxablePct < 1.5), `is_exempt` (TaxableValue==0 and ExemptValue>0 or subcat GOV), `market_land`, `market_bldg`, `taxable_land`, `taxable_bldg`, `taxable_total`, `tax_total` (Σ TaxAmount), `mills` (mode of TotalMills over the property's rows, float), `tif_inc`, `n_dwellings` (count of Res rows), `liv_units`, `address`. Class-code→land/building split: land = codes 1xxx/2xxx, building = 3xxx/6xxx (manufactured homes), per the ClassCodes descriptions. Log the TY2026 totals: expect Σ taxable_total = 756,981,782 and Σ tax_total ≈ 329.8 M.

**Step 2 — parcels (`02_parcels.py`).** `pyogrio.read_dataframe('data/raw/cadastral/Gallatin_Parcels.gdb', layer='OwnerParcel')` (unzip first), drop null `PARCELID`, `to_crs(4326)`, keep `PARCELID, LevyDistrict, PropType, GISAcres, AddressLine1, CityStateZip, geometry`. Compute `rep_lon, rep_lat` = `representative_point()` in EPSG:6514 then transformed. Join properties → parcels: (a) direct `geocode17 == PARCELID`; (b) condo units: unit → `CondoMasterId` → master's `geocode17`; (c) remaining: replace last 4 digits with `0000`; (d) remaining unmatched → `parcels_unmatched.csv` with taxable sum (report; expected < 3% of taxable). Aggregate to the parcel: `taxable_total, taxable_land, taxable_bldg, tax_total, tax_land, tax_bldg, n_props, n_units (condo), n_res, n_homestead, n_nonhomestead, n_comm, mills, levy_district, primary_subcat, address, tax_year` for TY2026 and TY2025 (suffix `_25`). Write `parcels.geojson` (attributes above + `pid`=PARCELID) and `parcels_index.json` as `{cols:[...], rows:[[pid, lon, lat, levy_idx, taxable26, tax26, taxable25, tax25, is_res, is_home, is_comm, n_units], ...]}` (numbers rounded to integers; `levy_idx` indexes `levies.json`). Target ≤ 6 MB raw.

**Step 3 — mill levy tables (`03_levies.py`).**
- TY2025 components: parse `data/reference/gallatin_2025_mill_levy.txt` (pdftotext -layout output) from the line containing `CONSOLIDATED Levy Districts`; rows match `^(0\d-[0-9A-Z]{4,8})\**\s+.*?\s+(City|Rural)\s+(.*)$`; numbers = `\d+\.\d+` tokens in the remainder, last = total. Column order in the book: `state 102.5, countywide_school 24.74, elem, hs, county_base 84.27, [city], [fire], [cemetery], [road 12.08], [library 3.40], [planning], [mosquito], TOTAL` — but blank columns are omitted in the text, so assign by value matching: 102.5 → state; 24.74 → cw_school; 84.27 → county; 12.08 → road; 3.40 → library; city ∈ {190.71, 233.19, 119.25, 125.39, 24.98} only when `City`; fire ∈ the 14 fire-district mills {41.37+16.49=57.86 CVF, 68.01 MF, 9.73 SF, 25.33 TF, 35.00 WF, 42.07 SMF, 24.91 BSF, 36.42 HBF, 24.56 GGF, 20.88 BCF, 43.33 AF, 78.07 GRRF, 36.40 HF}; cemetery ∈ {4.10 MG, 2.64 MV, 9.16 FC}; planning ∈ {1.78 GP, 1.07 BZP, 2.53 BGPC, 1.98 BGPR, 1.71 MPR}; mosquito 13.52 TRM; the remaining two numbers in order are elem and hs (hs may be absent for K-12 districts West Yellowstone/Big Sky). 155 of 161 rows parse and reconcile to the printed total within 0.01 (probe `data/reference/parse_levy.py`); the 6 wrapped rows (`06-5376`, `06-537615`, `06-0C27`, `06-0C2734`, `06-0C2741`, `06-0C2748`) have their numbers on the following 1–2 lines; handle by joining continuation lines that have no code at the start, or hard-code those six. Assert `abs(sum(components) − total) ≤ 0.011` for every row. Also parse the school breakdown section (`2025/2026 SCHOOL LEVY BREAKDOWN`) into fund lines per district (general/transportation/tuition/adult ed/tech/debt/building reserve) and the county base section for fund-level detail in the panel.
- TY2026 components: for each of the 139 levy districts pick one property (highest `taxable_total`, residential, non-TIF) and download `https://itax.gallatin.mt.gov/PDF/2026/RE/{assessment_code}.pdf` (User-Agent Mozilla, 0.5 s sleep; ~6 KB each). `pdftotext -layout` → parse the `TAX LEVIES` section: each line `name  pct  $amount2026  +/-  $amount2025` grouped under headers `County / Fire District / Public Safety / School / State School / University / City/rural`; total mills from `MILL LEVIES  Totals  <mills2026>`; general tax from `General Taxes <district>  …  $gen2026`. Then `taxable = gen2026 / mills2026 × 1000` and `mills_i = amount_i / taxable × 1000` (round to 0.01). Assert Σ mills_i within 0.15 of mills2026 and that mills2026 equals the ORION mode `TotalMills` for that district (both verified today for 3 districts). Write `levies.json`: `{districts: {code: {name, city_rural, components: {state, county, cw_school, elem, hs, city, fire, cemetery, road, library, planning, mosquito, public_safety?, other}, lines: [{jurisdiction, fund, mills}], total}}, years: {2025: …, 2026: …}}`. If the iTax fetch fails for a district, fall back to TY2025 components scaled by `mills2026/mills2025` and mark `estimated: true`.
- Jurisdiction grouping used by the chart: **State** (102.5), **County** (base + public safety + countywide school retirement/transportation + road/library), **City/Town**, **Elementary school**, **High school**, **Fire district**, **Other districts** (cemetery, planning, mosquito).

**Step 4 — buildings (`04_buildings.py`).** `uvx --from overturemaps overturemaps download --bbox=-112.10,44.35,-110.20,46.20 -f geoparquet --type=building -o data/raw/overture/gallatin_buildings.parquet` (expect ~100–150k; Bozeman bbox alone is 25,870). Read with geopandas; keep `id, height, num_floors, class, subtype`; clip to the county polygon (MSL layer 5, `NAME='Gallatin'`). Spatial join footprints' representative points to parcels (sjoin, `predicate='within'`), allocate per §5, compute `height_m` with the fallbacks in §5, write `buildings.geojson` with `bid, pid, height_m, tax_bldg, tax_total(parcel), taxable_bldg, class, share`.

**Step 5 — boundaries (`05_boundaries.py`).** Query MSL FeatureServer layers (GeoJSON, `outSR=4326`, page with `resultOffset` when > 2000): 5 counties (`NAME='Gallatin'` plus all for Phase 2), 7 cities/towns where `COUNTYNAME='Gallatin'` (Bozeman, Belgrade, Manhattan, Three Forks, West Yellowstone), 10/11 school districts intersecting Gallatin, 45 fire districts (`CountyName='Gallatin'`), 42 cemetery, 49 mosquito, 15 TIFDs, 61 UTDs (`OBJECTID=1203` and the Big Sky Transportation District rows 401/402 for completeness). Plus the GVUTD legal-description file is reference only. Write `districts.json` = FeatureCollection with `{id, name, type, source, updated}`; simplify to 5 m tolerance; target ≤ 3 MB.

**Step 6 — tiles (`06_tiles.sh`).**
```bash
tippecanoe -o data/derived/parcels.pmtiles -l parcels -Z9 -z16 --drop-densest-as-needed --extend-zooms-if-still-dropping \
  --simplification=4 --detect-shared-borders --coalesce-smallest-as-needed -y pid -y taxable_total -y tax_total -y tax_land -y tax_bldg \
  -y taxable_land -y taxable_bldg -y mills -y levy_district -y n_units -y n_homestead -y n_nonhomestead -y n_comm -y primary_subcat -y address -y tax_total_25 \
  data/derived/parcels.geojson
tippecanoe -o data/derived/buildings.pmtiles -l buildings -Z13 -z16 --drop-densest-as-needed -y bid -y pid -y height_m -y tax_bldg -y tax_total -y class -y share \
  data/derived/buildings.geojson
```
Record sizes. If either file ≤ 24 MiB it may be served from `public/` instead of R2, but keep both on R2 for one code path.

**Step 7 — district membership precompute + validation (`07_validate.py`).** For GVUTD, each city, each school district and each fire district: point-in-polygon on `parcels_index` representative points → `district_stats.json` (Σ taxable, count, value of a mill, residential median taxable) for both tax years, used as presets and as the validation table (§9). Write `data/derived/validation.md` with all checks and pass/fail.

**Step 8 — publish.** Copy `parcels_index.json, levies.json, districts.json, district_stats.json, meta.json` (vintages, counts, totals) to `public/data/`; upload PMTiles to R2 (§8).

---

## 7. Frontend features (Phase 1)

**Map (MapView.tsx)**
- Init: OpenFreeMap positron; `pmtiles` protocol registered; center Bozeman (-111.04, 45.68), zoom 12.5, pitch 45, max pitch 70; attribution "Data: Montana DOR (ORION, 2026-11-06), Montana State Library cadastral (2026-11-03), Overture Maps buildings (2026-10-21), Gallatin County Treasurer mill levies".
- Layers: `parcels-fill` (z ≥ 11; color = `tax_total` quantile ramp, 7 classes computed in the pipeline and stored in `meta.json`; exempt/zero = light grey; opacity 0.55, hover highlight via feature-state), `parcels-line` (z ≥ 14), `buildings-3d` (`fill-extrusion`, z ≥ 13, height = `height_m`, color = same ramp on `tax_bldg`, `fill-extrusion-opacity` 0.9, vertical gradient on), `parcel-labels` (`symbol` at parcel representative point… simpler: label the fill layer with `symbol-placement: point` using `text-field: ["concat","$",["number-format",["get","tax_total"],{"max-fraction-digits":0}]]`, z ≥ 16, `text-allow-overlap false`), `building-labels` (z ≥ 17, `$tax_bldg`). A "Show" control toggles between coloring by *total tax*, *structure tax*, *land tax*, *tax per $1,000 market value (effective rate)*, and *added tax from the calculator* (choropleth of `taxable_total × N/1000`, rendered client-side by `setPaintProperty` with a `match` expression keyed by `pid` for selected parcels; for large selections use a feature-state loop over the selection set). Districts layer: outlines of the chosen district(s) in a strong color.
- Hover: tooltip with address, total tax, mills. Click parcel or building → `PropertyPanel`.

**Property panel (PropertyPanel.tsx + BreakdownChart.tsx)**
- Header: address, geocode, levy district code + name (e.g. "27 Monforton-CVF-GP"), tax year toggle 2026/2025, link "DOR property record" → `https://svc.mt.gov/dor/oriondataportal/Public/PropertyMTGov/PropertySearch.aspx` (no deep-link verified; show the geocode to paste) and "County tax statement (PDF)" → `https://itax.gallatin.mt.gov/PDF/2026/RE/{assessment_code}.pdf` (opens the real comparison report; this is the single best trust signal — the builder must verify the link resolves for 3 random parcels).
- Values block: market land / buildings / total; taxable land / buildings / total; effective class rate (`taxable/market`), homestead badge (Homestead / Non-homestead 1.9% / Commercial / Ag / Exempt); mills; total tax; condo units (n) when the parcel is a condo master, with a units table (unit address, taxable, tax) from a lazily fetched `condos/{pid}.json` (pipeline writes one file per master; 902 files) — or inline in the index if ≤ 2 MB total.
- Chart 1 (Recharts stacked horizontal bar): tax by jurisdiction group (State, County, City, Elementary, High school, Fire, Other), each split land vs structure (two stacks or two bars). Chart 2 (donut or 100% bar): land vs structure share. Table: every levy line item (fund name, mills, $), sorted by group then $, with the sum row equal to the total (assert in dev).
- Footer caveat text (fixed): "General property taxes only; excludes special assessments and fees (SIDs/RIDs, water/sewer, street maintenance) and overlay mills (conservation, open space bond, zoning). Source: Montana DOR ORION, Gallatin County Treasurer."

**Calculator (Calculator.tsx)**
- District picker: presets (GVUTD; Gallatin County; City of Bozeman; City of Belgrade; Bozeman SD7 elem; Belgrade SD44; Central Valley Fire; each from `districts.json`), "Draw" (terra-draw polygon/rectangle), "Upload" (shpjs for `.zip`, or GeoJSON; reproject assumed WGS84 unless `.prj` says otherwise, shpjs handles), multiple selected polygons are unioned (point-in-any).
- Mill input: slider 0–50 (step 0.1) + number field + presets 1, 2, 5, 10, 15, 20 mills; also "dollar target" mode: enter $ → mills = $ / value_of_mill (HB 20 dollar-based framing).
- Outputs: value of a mill ($), revenue at N mills, parcel count (and condo units), taxable base split (homestead / non-homestead residential / commercial / ag / other), added annual cost per residential property: median, P25, P75, P90, mean, max; histogram (Recharts bar, 20 bins, log x optional); share of revenue paid by residential vs commercial; city vs unincorporated split; comparison line "a $378,000 homestead pays $N.NN/yr at this rate" and "the median Bozeman home…". Tax-year selector 2026/2025.
- Choropleth of added burden toggles the map "Show" to "added tax" for the selected set; legend updates.
- Statutory note block (collapsible) with §3.4 text and GVUTD facts (§4), incl. "GVUTD does not currently levy; 7-14-232 lets the county commissioners levy mills per the board's budget; a new voted levy must be dollar-based (HB 20); existing levies are capped by 15-10-420."
- Export: "Download CSV" of the selected parcels with added tax; "Copy summary".

**Misc**: Legend; About/Methods page (markdown rendered from `src/ui/about.md`: sources, vintages, formulas §3, validation results §9, caveats); URL state (`#z/lat/lon/pitch` + `?district=gvutd&mills=5&year=2026`); mobile: panel becomes a bottom sheet; loading state while `parcels_index.json` streams.

---

## 8. Hosting / deploy

- **Cloudflare Worker with static assets** (wrangler): `wrangler.jsonc` → `{ "name": "mill-levy", "compatibility_date": "2026-11-01", "assets": { "directory": "./dist", "not_found_handling": "single-page-application" } }`. Deploy: `npm run build && npx wrangler@4 deploy`. URL: `https://mill-levy.<account-subdomain>.workers.dev`; custom domain is Mark's call (§11).
- **R2 for tiles**: `npx wrangler@4 r2 bucket create mill-levy-tiles`; enable public access: `npx wrangler@4 r2 bucket dev-url enable mill-levy-tiles` (gives `https://pub-<hash>.r2.dev`); CORS: `npx wrangler@4 r2 bucket cors set mill-levy-tiles --file cors.json` with `[{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag","Content-Range","Accept-Ranges","Content-Length"],"MaxAgeSeconds":86400}]`; upload: `npx wrangler@4 r2 object put mill-levy-tiles/gallatin/parcels.pmtiles --file data/derived/parcels.pmtiles --content-type application/octet-stream` (same for buildings). Set `VITE_TILES_BASE=https://pub-<hash>.r2.dev/gallatin` in `.env.production`. Verify range support: `curl -s -o /dev/null -w '%{http_code}' -r 0-16383 <url>` must be 206. (r2.dev is rate-limited and meant for dev; fine for Phase 1; a custom domain `tiles.<domain>` is the Phase 2 upgrade.)
- **Fallback** if any R2 step fails: GitHub Pages — push `dist/` + pmtiles to `gh-pages` via `gh` CLI (100 MB per file soft limit; parcels.pmtiles must stay under it) and set `VITE_TILES_BASE` to the Pages URL. Do not spend more than 20 minutes on R2 before falling back.
- Build gate before deploy: `tsc --noEmit`, `npm run build`, open the built site with Playwright, verify: tiles load (no 4xx in network), a parcel click shows a panel whose line items sum to the total, GVUTD preset shows value-of-a-mill within §4's range, drawing a rectangle over downtown Bozeman returns > 0 parcels, shapefile upload of `MontanaIncorporatedCitiesTowns_shp.zip` (filter Bozeman) works. Save screenshots locally.

---

## 9. Validation (the numbers must be trustworthy)

`07_validate.py` writes `data/derived/validation.md`; the About page shows the table. All of these are hard checks (fail the build if red):

| # | Check | Expected | Tolerance |
|---|---|---|---|
| V1 | Σ ORION TY2026 `TaxableValue` (RP) vs DOR certified TY2026 real property taxable (COUNTY WIDE LEVIES) | $756,981,782 vs **$755,358,737** | ±1.0% (today: +0.21%) |
| V2 | Same for TY2025 | $675,694,357 vs **$689,026,672** | ±2.5% (today: −1.9%; TY2025 ORION rows reflect post-appeal values, certified is as-of-August) |
| V3 | Σ TY2026 `TaxableValue` for properties inside the City of Bozeman polygon vs certified CITY OF BOZEMAN real property (pull the 2026 figure from the portal; TY2025 was $229,861,538) | within ±3% | annexation timing explains residuals |
| V4 | Same for City of Belgrade (TY2025 real $32,219,290) | ±3% | |
| V5 | Mapped coverage: taxable value joined to a parcel polygon / Σ all RP taxable | ≥ 97% | log the unmatched list |
| V6 | Per-district mills: ORION mode `TotalMills` == iTax 2026 total == Σ parsed 2026 components | exact / ±0.15 | all 139 districts |
| V7 | Spot-check bills (exact, from ORION `TaxAmount`): `00RGF65523` TY2026 general tax **$1,554.06** (1,491.98 + 62.08), TY2025 **$1,716.09**, mills 405.760 / 431.720, taxable 3,830 / 3,975; `00RFG16430` TY2026 **$7,756.48** at 415.920, TY2025 **$8,897.40** at 444.270; `00RGH9979` (Bozeman TIFD parcel) TY2026 mills 531.990 | to the cent | these three PDFs are staged |
| V8 | Panel arithmetic: for 200 random parcels Σ line-item $ == `tax_total` | ±$0.05 | |
| V9 | Class-rate reproduction (sanity on §3.2): for TY2026 homestead residential properties, `taxable_total` == tiered formula on `market_total` with median $378,000 | ±$3 on ≥ 98% of properties | catches a wrong median |
| V10 | GVUTD value of a mill TY2026 | report; must be $250k–$400k | §4 |
| V11 | Building allocation: Σ `tax_bldg` over footprints == Σ parcel `tax_bldg` for parcels with ≥ 1 footprint; count of parcels with building tax but no footprint (report %) | exact; report | |

Pull V1–V4 reference numbers from the Certified Values portal with Playwright (`#ctl00_ContentPlaceHolder1_cmbCounty`=206, `cmbTaxYear`, `cmbTJ`=`206-{year}-TJ-06-{CNTYWID|BOZEMAN|BELGRAD}`), store in `data/reference/certified_values.json` with the retrieval date.

---

## 10. Phase 1 scope vs. later

**Phase 1 (today, Gallatin County):** everything in §6–§9 except: `res.csv/com.csv` detail in the panel (counts only), TY2024, dollar-target mode (nice-to-have; include if < 30 min), condo unit tables (include if the per-master JSON approach fits in time; otherwise show "n condo units, Σ tax"). Ship with TY2026 default and TY2025 toggle. Deploy to workers.dev + R2. Commit + push to GitHub.

**Phase 1 stretch (same session if time remains, in this order):** (1) dollar-target mode; (2) condo unit tables; (3) "effective rate" map mode; (4) per-fund school line items in the chart tooltip.

**Phase 2 (statewide + depth):**
- Statewide: loop §6 over all 56 ORION county zips (COUNTY1…COUNTY56, each attaches in ~1 min; statewide MDF exceeds SQL Express but per-county is fine) and `MTParcels_GDB.zip`; one PMTiles per county plus a statewide low-zoom layer; county picker UI. Each county's mill levy book has its own format — but the iTax-style derivation only works where the treasurer exposes bills; the robust statewide path is ORION `TotalMills` (total only) + DOR's levy data. **Needs research**: DOR publishes "Mill levies by taxing jurisdiction" in the Biennial Report tables; find a machine-readable version or request it from DOR (§11).
- Mapbox GL JS + Mapbox Standard 3D basemap with a suitably restricted public token (or a token URL-restricted to the new domain).
- Special assessments and overlay mills (conservation, open-space bond, zoning, W/S) from the county book + district polygons (MSL layers 59/60 and Gallatin zoning polygons).
- 15-10-420 maximum-mill calculator per jurisdiction (needs prior-year revenue and newly-taxable values from DOR's certification letters, form AB-72T).
- Scenario comparison (two mill levels side by side), share links, PDF export of a property's breakdown.
- Monthly refresh script (ORION + cadastral + Overture) and a GitHub Action.

---

## 11. Open questions

1. **Basemap**: Phase 1 uses MapLibre + OpenFreeMap. A Mapbox basemap would need a public access token restricted to the site's domain.
2. **Domain**: Phase 1 lands on workers.dev + an r2.dev tile URL; a custom domain is a later step.
3. **GVUTD mill cap**: 7-14-232 has no numeric cap and references 15-10-420; please confirm with the GVUTD board/county attorney whether the 2023 creation resolution or ballot language limited mills, and whether any levy election is planned (nothing public found).
4. **Scope of "tax burden"**: Phase 1 shows general property taxes only (what ORION computes). Say if you want special assessments/fees (SIDs, water/sewer, street maintenance) included; that needs the county's per-parcel assessment file (not public in bulk; would be a request to the Treasurer).
5. **Data licensing/privacy**: the map shows per-parcel taxes but no owner names (MCA 2-6-1017 distribution-list restriction; owner names are in the data but are intentionally not published). Confirm that's the intent.
6. **Statewide**: Phase 2 needs a per-jurisdiction mill table for all counties. If you have a DOR contact, a request for the TY2026 "mills by levy district" extract (the data behind the Biennial Report mill tables) would save a week of per-county PDF parsing.
7. **Reviewers**: anyone at GVUTD/Streamline/HRDC who should sanity-check the GVUTD value-of-a-mill figure before you share it?

---

## Appendix A — Facts verified today (for the builder's About page)

- Gallatin County TY2026 certified: total taxable $809,147,826 (real property $755,358,737; market $56.58 B; newly taxable $16,019,374; TIF increment $25,484,416). TY2025: total $738,800,299 (real $689,026,672; newly taxable $31,302,804; TIF $25,129,398). City of Bozeman TY2025: taxable $242,562,919 (real $229,861,538; TIF $23,617,301). City of Belgrade TY2025: $34,354,219 (real $32,219,290). Gallatin "Road & Libraries" (rural) TY2025 $437,260,307.
- DOR medians: statewide residential $378,000 (TY2025–26 cycle; 2024 was $311,000); statewide commercial $379,000; Gallatin County median residential $685,000, commercial $684,000.
- Sample TY2025 bill `RGF65523` (Ferndale condo unit, 151 Covey Ct D, levy district 0363-04 "27 Monforton-CVF-GP"): market $484,800 (land $19,328 / building $465,472), taxable $3,975, 431.720 mills, general tax $1,716.09, special assessments $520.56 (Four Corners W/S fee $477.10, RID 2602 $30.55, water quality $7.26, conservation 1.04+1.03 mills $2.07, open space bond $3.58). Full line items are in `data/reference/sample_tax_bill_2025_RGF65523.pdf`.
- The ORION Gallatin DB attached cleanly in `mcr.microsoft.com/mssql/server:2022-latest` (needs the upgrade steps 952→957 automatically; ~1 min); `bcp` exports 130k+ rows/s.
- The cadastral layer has 4,898 parcels whose geocode suffix ≠ 0000 but these are not condo units; condo units exist only in ORION.
- Overture Bozeman bbox: 25,870 footprints; 19,230 with height; 309 with num_floors; sources OSM 21,379 / USGS lidar 12,726 / Microsoft 6,538 / Esri 4,178.
