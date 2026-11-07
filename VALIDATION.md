# Validation

Generated 2026-11-07 by `pipeline/08_validate.py`. Gates per PLAN.md §9, run per county.

## Gallatin County

20/24 checks pass.

| # | Check | Expected | Actual | Status |
|---|---|---|---|---|
| V1 | County RP taxable TY2026: ORION vs DOR certified (real property) | $755,358,737 ±1.0% | $756,981,782 (+0.21%) | **PASS** |
| V2 | County RP taxable TY2025: ORION vs DOR certified (real property) | $689,026,672 ±2.5% | $675,694,357 (-1.93%) | **PASS** |
| V3-2026 | City of Bozeman RP taxable TY2026: parcels inside MSL city polygon vs certified | $245,942,083 ±3% | $246,968,615 (+0.42%) | **PASS** |
| V3-2025 | City of Bozeman RP taxable TY2025: parcels inside MSL city polygon vs certified | $229,861,538 ±3% | $225,981,565 (-1.69%) | **PASS** |
| V4-2026 | City of Belgrade RP taxable TY2026: parcels inside MSL city polygon vs certified | $39,065,125 ±3% | $40,484,990 (+3.63%) | **FAIL** |
| V4-2025 | City of Belgrade RP taxable TY2025: parcels inside MSL city polygon vs certified | $32,219,290 ±3% | $33,451,187 (+3.82%) | **FAIL** |
| V5-2026 | Mapped coverage TY2026: taxable value joined to a parcel polygon | >= 97% | 99.46% | **PASS** |
| V5-2025 | Mapped coverage TY2025: taxable value joined to a parcel polygon | >= 97% | 99.33% | **PASS** |
| V6a-2026 | Per-district mills TY2026: sum of parsed bill line items == billed total | ±0.15 mills, all districts | 132/132 parsed districts OK | **PASS** |
| V6b-2026 | Per-district mills TY2026: ORION modal TotalMills == Treasurer billed total | exact | 122/132 match | **FAIL** |
| V6a-2025 | Per-district mills TY2025: sum of parsed bill line items == billed total | ±0.15 mills, all districts | 132/132 parsed districts OK | **PASS** |
| V6b-2025 | Per-district mills TY2025: ORION modal TotalMills == Treasurer billed total | exact | 101/132 match | **FAIL** |
| V7-RGF65523-2026 | Real bill RGF65523 TY2026 (151 COVEY #D, Bozeman) | tax $1,554.06 mills 405.760 taxable $3,830 | tax $1,554.06 mills 405.760 taxable $3,830 (ORION TaxAmount $1,554.06, TotalMills 405.760) | **PASS** |
| V7-RGF65523-2025 | Real bill RGF65523 TY2025 (151 COVEY #D, Bozeman) | tax $1,716.09 mills 431.720 taxable $3,975 | tax $1,716.09 mills 431.720 taxable $3,975 (ORION TaxAmount $1,696.21, TotalMills 426.720) | **PASS** |
| V7-RFG16430-2026 | Real bill RFG16430 TY2026 (1040 NELSON, Bozeman) | tax $7,756.48 mills 415.920 | tax $7,756.48 mills 415.920 taxable $18,649 (ORION TaxAmount $7,756.48, TotalMills 415.920) | **PASS** |
| V7-RFG16430-2025 | Real bill RFG16430 TY2025 (1040 NELSON, Bozeman) | tax $8,897.40 mills 444.270 | tax $8,897.40 mills 444.270 taxable $20,027 (ORION TaxAmount $8,897.40, TotalMills 444.270) | **PASS** |
| V7-RGH9979-2026 | Real bill RGH9979 TY2026 (OAK, Bozeman) | mills 531.990 | tax $82.46 mills 531.990 taxable $155 (ORION TaxAmount $82.46, TotalMills 531.990) | **PASS** |
| V8 | Panel arithmetic: Σ levy line $ == parcel tax (200 random parcels, TY2026) | ±$0.05 | max error $0.00 unrounded; $0.09 after per-line cent rounding (200 parcels) | **PASS** |
| V9 | Class-rate reproduction: TY2026 homestead residential taxable == tiered formula (median $378,000; blended rate rounded to 0.01%) | ±$3 on >= 98% | 99.66% of 26,600 properties | **PASS** |
| V10-2026 | GVUTD value of 1 mill TY2026 (mapped real property) | $250k–$400k | $388,022.65 (taxable $388,022,647; net of est. TIF increment $362,546.30) | **PASS** |
| V10-2025 | GVUTD value of 1 mill TY2025 (mapped real property) | $250k–$400k | $348,659.63 (taxable $348,659,630; net of est. TIF increment $323,544.86) | **PASS** |
| V11 | Building allocation: Σ footprint structure tax == Σ parcel structure tax (parcels with footprints) | exact (±$1 rounding) | $206,335,045.18 vs $206,335,046.01 | **PASS** |
| V12-2026 | Independent spot check TY2026: app tax vs Treasurer bill, 40 random properties | to the cent | 40/40 exact | **PASS** |
| V12-2025 | Independent spot check TY2025: app tax vs Treasurer bill, 40 random properties | to the cent | 40/40 exact | **PASS** |

### Gallatin details

- **V3-2026** (PASS): By city levy-district code instead of polygon: $245,546,471 (-0.16%).
- **V3-2025** (PASS): By city levy-district code instead of polygon: $224,539,589 (-2.32%).
- **V4-2026** (FAIL): By city levy-district code instead of polygon: $39,227,786 (+0.42%).
- **V4-2025** (FAIL): By city levy-district code instead of polygon: $32,160,802 (-0.18%).
- **V5-2026** (PASS): Unmatched: 628 properties, $4,081,244 taxable (data/derived/parcels_unmatched.csv). Join rules: direct 52959, condo master 9429, suffix->0000 3171, unit->x000 867.
- **V5-2025** (PASS): Unmatched: 734 properties, $4,551,675 taxable (data/derived/parcels_unmatched.csv). Join rules: direct 52514, condo master 9293, suffix->0000 3167, unit->x000 847.
- **V6a-2026** (PASS): 142 ORION levy codes; 132 parsed from Treasurer bills; 7 without a usable bill (no taxable non-mobile-home property or no PDF): 06-035700-20 00, 06-0362-25, 06-0364-35, 06-0370-47, 06-0C27-38-12, 06-234753-3R 53, 06-236040-24R 40 — these borrow lines from a district with identical mills or show the total only.
- **V6b-2026** (FAIL): Mismatches: 06-037616-75 16: ORION 444.77 vs bill 446.51; 06-037617-75 17: ORION 442.37 vs bill 444.11; 06-234703-3R 03: ORION 474.27 vs bill 476.01; 06-235003-7R 03: ORION 414.18 vs bill 415.92; 06-235056-7R 56: ORION 358.13 vs bill 359.87; 06-236803-44R 03: ORION 432.83 vs bill 434.57; 06-236806-44R 06: ORION 435.23 vs bill 436.97; 06-236816-44R 16: ORION 418.64 vs bill 420.38; 06-236817-44R 17: ORION 416.24 vs bill 417.98; 06-236856-44R 56: ORION 376.78 vs bill 378.52. Resolution: the app uses ORION taxable value x the Treasurer-billed mills, so 5,744 non-mobile-home properties carry billed rather than ORION tax (ORION $23,912,486.44 -> billed $24,008,956.83).
- **V6a-2025** (PASS): 142 ORION levy codes; 132 parsed from Treasurer bills; 6 without a usable bill (no taxable non-mobile-home property or no PDF): 06-035700-20 00, 06-0362-25, 06-0370-47, 06-0C27-38-12, 06-234753-3R 53, 06-236040-24R 40 — these borrow lines from a district with identical mills or show the total only.
- **V6b-2025** (FAIL): Mismatches: 06-035008-7C 08: ORION 560.93 vs bill 559.86; 06-0350T1-7C T1: ORION 560.93 vs bill 559.86; 06-0350T2-7C T2: ORION 560.93 vs bill 559.86; 06-0350T3-7C T3: ORION 560.93 vs bill 559.86; 06-0350T4-7C T4: ORION 560.93 vs bill 559.86; 06-0350T5-7C T5: ORION 560.93 vs bill 559.86; 06-0350T6-7C T6: ORION 560.93 vs bill 559.86; 06-035909-22 09: ORION 410.57 vs bill 379.93; 06-035913-22 13: ORION 398.73 vs bill 368.09; 06-035941-22 41: ORION 374.17 vs bill 343.53; 06-036300-27 00: ORION 367.08 vs bill 372.08; 06-036304-27 04: ORION 426.72 vs bill 431.72; 06-036309-27 09: ORION 405.26 vs bill 410.26; 06-036313-27 13: ORION 393.42 vs bill 398.42; 06-036336-27 36: ORION 403.48 vs bill 408.48; 06-036341-27 41: ORION 368.86 vs bill 373.86; 06-036802-44C 02: ORION 446.87 vs bill 680.06; 06-0368T1-44C T1: ORION 446.87 vs bill 680.06; 06-037616-75 16: ORION 455.42 vs bill 457.4; 06-037617-75 17: ORION 452.78 vs bill 454.76; 06-135008-7C-44 08: ORION 578.26 vs bill 577.19; 06-234703-3R 03: ORION 498.68 vs bill 500.66; 06-235003-7R 03: ORION 442.49 vs bill 444.47; 06-235056-7R 56: ORION 384.63 vs bill 386.61; 06-236741-43-7 41: ORION 360.96 vs bill 358.98; 06-236803-44R 03: ORION 459.82 vs bill 461.8; 06-236806-44R 06: ORION 462.46 vs bill 464.44; 06-236816-44R 16: ORION 447.93 vs bill 449.91; 06-236817-44R 17: ORION 445.29 vs bill 447.27; 06-236856-44R 56: ORION 401.96 vs bill 403.94; 06-537615-75-7-3 15: ORION 462.78 vs bill 439.09. Resolution: the app uses ORION taxable value x the Treasurer-billed mills, so 35,565 non-mobile-home properties carry billed rather than ORION tax (ORION $179,025,397.05 -> billed $186,226,349.79).
- **V8** (PASS): The panel shows the exact parcel tax in the total row; per-line cents can differ by rounding.
- **V9** (PASS): Median abs error $0.29; 99th pct $0.92.
- **V10-2026** (PASS): 35,716 properties on 26,586 parcels; 29,764 residential; ~41,625 dwelling units. Revenue: 5 mills $1,940,113, 10 mills $3,880,226, 15 mills $5,820,340.
- **V10-2025** (PASS): 35,350 properties on 26,339 parcels; 29,321 residential; ~41,625 dwelling units. Revenue: 5 mills $1,743,298, 10 mills $3,486,596, 15 mills $5,229,894.
- **V11** (PASS): 3,127 of 40,310 parcels with structure tax have no Overture footprint (7.8%, $11,782,934.09 = 5.4% of structure tax; mostly condo units in masters without footprints, mobile homes and rural improvements). 74,679 footprints in county, 70,796 on a parcel.
- **V12-2026** (PASS): All exact.
- **V12-2025** (PASS): All exact.

## Yellowstone County

18/23 checks pass.

| # | Check | Expected | Actual | Status |
|---|---|---|---|---|
| V1 | County RP taxable TY2026: ORION vs DOR certified (real property) | $386,256,136 ±1.0% | $340,045,203 (-11.96%) | **FAIL** |
| V2 | County RP taxable TY2025: ORION vs DOR certified (real property) | $365,846,653 ±2.5% | $307,286,929 (-16.01%) | **FAIL** |
| V3-2026 | City of Billings RP taxable TY2026: parcels inside MSL city polygon vs certified | $226,728,714 ±3% | $226,257,205 (-0.21%) | **PASS** |
| V3-2025 | City of Billings RP taxable TY2025: parcels inside MSL city polygon vs certified | $210,422,543 ±3% | $207,925,884 (-1.19%) | **PASS** |
| V4-2026 | City of Laurel RP taxable TY2026: parcels inside MSL city polygon vs certified | $9,503,178 ±3% | $10,059,275 (+5.85%) | **FAIL** |
| V4-2025 | City of Laurel RP taxable TY2025: parcels inside MSL city polygon vs certified | $8,297,156 ±3% | $8,463,151 (+2.00%) | **PASS** |
| V5-2026 | Mapped coverage TY2026: taxable value joined to a parcel polygon | >= 97% | 99.82% | **PASS** |
| V5-2025 | Mapped coverage TY2025: taxable value joined to a parcel polygon | >= 97% | 99.68% | **PASS** |
| V6a-2026 | Per-district mills TY2026: sum of parsed bill line items == billed total | ±0.15 mills, all districts | 41/41 parsed districts OK | **PASS** |
| V6b-2026 | Per-district mills TY2026: ORION modal TotalMills == Treasurer billed total | exact | 37/41 match | **FAIL** |
| V6a-2025 | Per-district mills TY2025: sum of parsed bill line items == billed total | ±0.15 mills, all districts | 41/41 parsed districts OK | **PASS** |
| V6b-2025 | Per-district mills TY2025: ORION modal TotalMills == Treasurer billed total | exact | 41/41 match | **PASS** |
| V7-A23320-2026 | Real bill A23320 TY2026 (620 REVOLUTION, Billings) | tax $2,389.21  | tax $2,389.21 mills 737.180 taxable $3,241 (ORION TaxAmount $2,389.21, TotalMills 737.180) | **PASS** |
| V7-A23320-2025 | Real bill A23320 TY2025 (620 REVOLUTION, Billings) | tax $2,502.21  | tax $2,502.21 mills 761.940 taxable $3,284 (ORION TaxAmount $2,502.21, TotalMills 761.940) | **PASS** |
| V7-B01917-2026 | Real bill B01917 TY2026 (605 14TH, Laurel) | tax $3,838.46  | tax $3,838.46 mills 725.060 taxable $5,294 (ORION TaxAmount $3,838.46, TotalMills 725.060) | **PASS** |
| V7-B01917-2025 | Real bill B01917 TY2025 (605 14TH, Laurel) | tax $4,247.55  | tax $4,247.55 mills 739.220 taxable $5,746 (ORION TaxAmount $4,247.55, TotalMills 739.220) | **PASS** |
| V7-D07174C-2026 | Real bill D07174C TY2026 (8330 GRAVELSTONE, Shepherd) | tax $9,965.38  | tax $9,965.38 mills 631.520 taxable $15,780 (ORION TaxAmount $9,965.38, TotalMills 631.520) | **PASS** |
| V7-D07174C-2025 | Real bill D07174C TY2025 (8330 GRAVELSTONE, Shepherd) | tax $11,125.19  | tax $11,125.19 mills 658.880 taxable $16,885 (ORION TaxAmount $11,125.19, TotalMills 658.880) | **PASS** |
| V8 | Panel arithmetic: Σ levy line $ == parcel tax (200 random parcels, TY2026) | ±$0.05 | max error $0.00 unrounded; $0.06 after per-line cent rounding (197 parcels) | **PASS** |
| V9 | Class-rate reproduction: TY2026 homestead residential taxable == tiered formula (median $378,000; blended rate rounded to 0.01%) | ±$3 on >= 98% | 99.76% of 39,662 properties | **PASS** |
| V11 | Building allocation: Σ footprint structure tax == Σ parcel structure tax (parcels with footprints) | exact (±$1 rounding) | $159,943,285.90 vs $159,943,285.33 | **PASS** |
| V12-2026 | Independent spot check TY2026: app tax vs Treasurer bill, 40 random properties | to the cent | 36/40 exact, 39/40 within $3 | **FAIL** |
| V12-2025 | Independent spot check TY2025: app tax vs Treasurer bill, 40 random properties | to the cent | 38/40 exact, 40/40 within $3 | **PASS** |

### Yellowstone details

- **V1** (FAIL): Unresolved. ORION market value is $34.59B vs certified $32.06B, so the gap is in taxable value, not in missing parcels. Billings reconciles within 0.2% (V3), so the shortfall sits outside the cities. A likely cause is industrial property (the three refineries) that DOR certifies at values or class rates not carried in the county ORION extract. All mapped taxes still come from ORION/Treasurer values; the county-wide value of a mill in the calculator is understated by about 12%.
- **V2** (FAIL): Unresolved. ORION market value is $34.02B vs certified $32.01B, so the gap is in taxable value, not in missing parcels. Billings reconciles within 0.2% (V3), so the shortfall sits outside the cities. A likely cause is industrial property (the three refineries) that DOR certifies at values or class rates not carried in the county ORION extract. All mapped taxes still come from ORION/Treasurer values; the county-wide value of a mill in the calculator is understated by about 16%.
- **V3-2026** (PASS): By city levy-district code instead of polygon: $226,697,895 (-0.01%).
- **V3-2025** (PASS): By city levy-district code instead of polygon: $208,664,723 (-0.84%).
- **V4-2026** (FAIL): By city levy-district code instead of polygon: $9,723,442 (+2.32%).
- **V4-2025** (PASS): By city levy-district code instead of polygon: $8,347,682 (+0.61%).
- **V5-2026** (PASS): Unmatched: 230 properties, $599,865 taxable (data/derived/parcels_unmatched.csv). Join rules: direct 82741, condo master 4, suffix->0000 2206, unit->x000 7.
- **V5-2025** (PASS): Unmatched: 343 properties, $975,865 taxable (data/derived/parcels_unmatched.csv). Join rules: direct 82010, condo master 4, suffix->0000 2209, unit->x000 7.
- **V6a-2026** (PASS): 48 ORION levy codes; 41 parsed from Treasurer bills; 7 without a usable bill (no taxable non-mobile-home property or no PDF): 03-0967LF-26-LF, 03-0978-21, 03-0B96-58, 03-1241FS-26LFSW, 03-1241LF-26-LF, 03-1241SW-26SW, 03-1969-4C — these borrow lines from a district with identical mills or show the total only.
- **V6b-2026** (FAIL): Mismatches: 03-0972-8: ORION 521.34 vs bill 522.69; 03-0972UF-8-UF: ORION 521.34 vs bill 522.69; 03-1972-8C: ORION 700.33 vs bill 701.68; 03-1978-O21: ORION 420.39 vs bill 420.97. Resolution: the app uses ORION taxable value x the Treasurer-billed mills, so 5,584 non-mobile-home properties carry billed rather than ORION tax (ORION $11,444,214.80 -> billed $11,527,118.78).
- **V6a-2025** (PASS): 48 ORION levy codes; 41 parsed from Treasurer bills; 6 without a usable bill (no taxable non-mobile-home property or no PDF): 03-0978-21, 03-0B96-58, 03-1241FS-26LFSW, 03-1241LF-26-LF, 03-1241SW-26SW, 03-1969-4C — these borrow lines from a district with identical mills or show the total only.
- **V8** (PASS): The panel shows the exact parcel tax in the total row; per-line cents can differ by rounding.
- **V9** (PASS): Median abs error $0.29; 99th pct $0.91.
- **V11** (PASS): 7,178 of 66,450 parcels with structure tax have no Overture footprint (10.8%, $12,920,172.52 = 7.5% of structure tax; mostly condo units in masters without footprints, mobile homes and rural improvements). 96,100 footprints in county, 93,992 on a parcel.
- **V12-2026** (FAIL): Misses: A22035A: bill $814.58 vs app $408.39 (ORION $408.39); A106980: bill $310.09 vs app $310.36 (ORION $310.36); D017440: bill $2,813.04 vs app $2,815.29 (ORION $2,815.29); A093750: bill $741.02 vs app $741.60 (ORION $741.60). Differences of a few cents on TIF parcels come from the Treasurer splitting the bill into base and increment lines and rounding each.
- **V12-2025** (PASS): Misses: A106980: bill $320.45 vs app $320.78 (ORION $320.78); A093750: bill $714.92 vs app $715.46 (ORION $715.46). Differences of a few cents on TIF parcels come from the Treasurer splitting the bill into base and increment lines and rounding each.

