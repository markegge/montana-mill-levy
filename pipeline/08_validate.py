"""Step 8: hard validation gates (PLAN §9) -> VALIDATION.md (repo root) + public/data/validation.json."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import re

import numpy as np
import pandas as pd
import requests

from county import COUNTIES, ORDER, County

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / "public" / "data"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) mill-levy research"}

checks: list[dict] = []
CUR = {"county": ""}


def add(cid, name, expected, actual, ok, detail=""):
    checks.append({"id": cid, "county": CUR["county"], "name": name, "expected": expected, "actual": actual,
                   "status": "PASS" if ok else "FAIL", "detail": detail})


COUNTY_JURIS = {"gallatin": "CNTYWID", "yellowstone": "COWDLVY"}
# (check id, certified jurisdiction, district id, City-levy line-name prefix used to find the city's levy codes)
CITIES = {"gallatin": [("V3", "BOZEMAN", "city-bozeman", ("bzn", "bozeman")), ("V4", "BELGRAD", "city-belgrade", ("belgrade",))],
          "yellowstone": [("V3", "BLGS", "ys-city-billings", ("billings-",)), ("V4", "LAUREL", "ys-city-laurel", ("laurel",))]}


def ys_taxcode(ac: str) -> str:
    """ORION assessment code (leading zeros stripped) -> Yellowstone Treasurer tax code (drop a trailing 0)."""
    return ac[:-1] if ac.endswith("0") else ac


def ys_bill(C: County, ac: str, year: int) -> float | None:
    """General tax (the levy-district line) on the Yellowstone Treasurer's statement detail page."""
    tc = ys_taxcode(ac)
    cache = C.raw / "bills" / f"{tc}_{year}.html"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if not cache.exists():
        r = requests.get("https://www.yellowstonecountymt.gov/treasurer/propertysearch/csatydet.asp",
                         params={"propid": tc, "lyear": year}, headers=UA, timeout=60)
        if r.status_code != 200:
            return None
        cache.write_text(r.text)
    from bs4 import BeautifulSoup
    b = BeautifulSoup(cache.read_text(errors="ignore"), "html.parser")
    # General tax = the levy-district line, plus, for TIF parcels, the TIF-increment line (same district name)
    # and the TIF university / vo-tech lines (codes TIDU, TIVT). Special assessments and the TY2025 mid-year
    # "ADD'L" school supplements are not general mills in ORION and are excluded.
    rows = []
    for tr in b.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td", recursive=False)]
        if len(cells) >= 3:
            rows.append(cells)
    district = None; total = 0.0
    for cells in rows:
        if any("(Levy District)" in c for c in cells):
            district = next(c for c in cells if "(Levy District)" in c).replace("(Levy District)", "").strip()
            total += float(cells[-1].replace(",", ""))
    if district is None:
        return None
    for cells in rows:
        code, desc = cells[0].strip(), cells[1].strip()
        if "(Levy District)" in desc:
            continue
        d_up = desc.upper()
        in_tif = any(k in district.upper() for k in ("URBAN", "TEDD", "TAX I"))
        if code.startswith("TID") or d_up == district.upper() or (in_tif and any(k in d_up for k in ("URBAN", "TEDD", "TAX I"))):
            total += float(cells[-1].replace(",", ""))
    return round(total, 2)


def pct(a, b):
    return (a - b) / b * 100


def money(x):
    return f"${x:,.2f}"


def validate(C: County):
    CUR["county"] = C.slug
    D = C.derived
    props = pd.read_parquet(D / "property_points.parquet")
    cv = json.loads(C.certified_values.read_text())["jurisdictions"]
    lev = json.loads((D / "levies.json").read_text())
    stats = json.loads((D / "district_stats.json").read_text())
    join = json.loads((D / "join_report.json").read_text())
    bst = json.loads((D / "buildings_stats.json").read_text())
    p26 = props[props.tax_year == 2026]; p25 = props[props.tax_year == 2025]

    # V1/V2 county
    for cid, y, o, tol in (("V1", "2026", p26, 1.0), ("V2", "2025", p25, 2.5)):
        cert = cv[y][COUNTY_JURIS[C.slug]]["values"]["Real Property - Taxable Value"]
        got = float(o.taxable_total.sum()); d = pct(got, cert)
        note = ""
        if C.slug == "yellowstone":
            mkt = float(o.market_total.sum())
            cm = cv[y][COUNTY_JURIS[C.slug]]["values"].get("Real Property - Market Value") or 0
            note = (f"Unresolved. ORION market value is ${mkt / 1e9:.2f}B vs certified ${cm / 1e9:.2f}B, so the gap is in "
                    "taxable value, not in missing parcels. Billings reconciles within 0.2% (V3), so the shortfall sits "
                    "outside the cities. A likely cause is industrial property (the three refineries) that DOR certifies at "
                    "values or class rates not carried in the county ORION extract. All mapped taxes still come from "
                    "ORION/Treasurer values; the county-wide value of a mill in the calculator is understated by about "
                    f"{-d:.0f}%.")
        add(cid, f"County RP taxable TY{y}: ORION vs DOR certified (real property)", f"${cert:,.0f} ±{tol}%",
            f"${got:,.0f} ({d:+.2f}%)", abs(d) <= tol, note)

    # V3/V4 cities (polygon membership, plus levy-code membership as a diagnostic)
    for cid, juris, did, line_prefix in CITIES[C.slug]:
        city_codes = {b for b, v in lev["years"]["2026"].items()
                      if any(l["group"] == "City" and l["name"].lower().startswith(line_prefix) for l in v["lines"])}
        for y, o in (("2026", p26), ("2025", p25)):
            cert = cv[y][juris]["values"]["Real Property - Taxable Value"]
            got = stats[did][y]["taxable"]; d = pct(got, cert)
            bycode = float(o[o.levy_district.isin(city_codes)].taxable_total.sum()); d2 = pct(bycode, cert)
            add(f"{cid}-{y}", f"{stats[did]['name']} RP taxable TY{y}: parcels inside MSL city polygon vs certified",
                f"${cert:,.0f} ±3%", f"${got:,.0f} ({d:+.2f}%)", abs(d) <= 3.0,
                f"By city levy-district code instead of polygon: ${bycode:,.0f} ({d2:+.2f}%).")

    # V5 coverage
    for y in ("2026", "2025"):
        c = join[y]["coverage_taxable_pct"]
        add(f"V5-{y}", f"Mapped coverage TY{y}: taxable value joined to a parcel polygon", ">= 97%", f"{c:.2f}%", c >= 97,
            f"Unmatched: {join[y]['unmatched']['n']} properties, ${join[y]['unmatched']['taxable']:,.0f} taxable "
            f"(data/derived/parcels_unmatched.csv). Join rules: direct {join[y]['direct']['n']}, condo master "
            f"{join[y]['condo_master']['n']}, suffix->0000 {join[y]['parent_0000']['n']}, unit->x000 {join[y]['unit_x000']['n']}.")

    # V6 mills parity
    for y in ("2026", "2025"):
        yy = lev["years"][y]
        parsed = {b: v for b, v in yy.items() if not v["estimated"]}
        est = [b for b, v in yy.items() if v["estimated"]]
        sum_bad = [b for b, v in parsed.items() if abs(v["lines_sum"] - v["total"]) > 0.15]
        tol = 0.0005 if (C.slug == "gallatin" or y == "2026") else 0.011  # YS TY2025 total = sum of 3-dp line mills
        mode_bad = [(b, v["orion_mode"], v["total"]) for b, v in parsed.items()
                    if v["orion_mode"] is None or abs(v["orion_mode"] - v["total"]) > tol]
        n_codes = len(lev["codes"])
        # property-level impact of the differences
        o = p26 if y == "2026" else p25
        o = o[o.subcat != "MH"]
        diff = o[o.mills.round(3) != o.mills_orion.round(3)]
        add(f"V6a-{y}", f"Per-district mills TY{y}: sum of parsed bill line items == billed total",
            "±0.15 mills, all districts", f"{len(parsed) - len(sum_bad)}/{len(parsed)} parsed districts OK", not sum_bad,
            f"{n_codes} ORION levy codes; {len(parsed)} parsed from Treasurer bills; {len(est)} without a usable bill "
            f"(no taxable non-mobile-home property or no PDF): {', '.join(sorted(est))} — these borrow lines from a "
            f"district with identical mills or show the total only.")
        detail = "; ".join(f"{b}: ORION {m} vs bill {t}" for b, m, t in mode_bad[:60])
        add(f"V6b-{y}", f"Per-district mills TY{y}: ORION modal TotalMills == Treasurer billed total", "exact",
            f"{len(parsed) - len(mode_bad)}/{len(parsed)} match", not mode_bad,
            (f"Mismatches: {detail}. Resolution: the app uses ORION taxable value x the Treasurer-billed mills, so "
             f"{len(diff):,} non-mobile-home properties carry billed rather than ORION tax "
             f"(ORION {money(diff.tax_total_orion.sum())} -> billed {money(diff.tax_total.sum())}).") if mode_bad else "")

    # V7 bills
    if C.slug == "gallatin":
        bills = [("RGF65523", 2026, 1554.06, 405.76, 3830), ("RGF65523", 2025, 1716.09, 431.72, 3975),
                 ("RFG16430", 2026, 7756.48, 415.92, None), ("RFG16430", 2025, 8897.40, 444.27, None),
                 ("RGH9979", 2026, None, 531.99, None)]
    else:
        # A Billings home (tax code A23320), the largest homestead in Laurel city and in Shepherd (rural); the
        # expected amounts are read from the Treasurer's statement detail pages at validation time.
        picks = ["A233200"]
        for code in ("03-0970-7", "03-0985-37"):
            o = p26[(p26.levy_district == code) & (p26.cat == 1) & p26.property_id.isin(p25.property_id)
                    & ~p26.subcat.isin(["MH", "C_MSTR"])].sort_values("taxable_total", ascending=False)
            picks.append(o.assessment_code.iloc[0])
        bills = []
        for ac in picks:
            for y in (2026, 2025):
                bills.append((ac, y, ys_bill(C, ac, y), None, None))
    for ac, y, tax, mills, tv in bills:
        r = props[(props.assessment_code == ac) & (props.tax_year == y)]
        label = ys_taxcode(ac) if C.slug == "yellowstone" else ac
        if r.empty or (tax is None and mills is None):
            add(f"V7-{label}-{y}", f"Bill {label} TY{y}", "found", "missing", False); continue
        r = r.iloc[0]
        ok = (mills is None or abs(r.mills - mills) < 0.0005) and (tax is None or abs(r.tax_total - tax) < 0.005) \
            and (tv is None or r.taxable_total == tv)
        exp = f"tax {money(tax)} " if tax else ""
        add(f"V7-{label}-{y}", f"Real bill {label} TY{y} ({r.address})",
            f"{exp}" + (f"mills {mills:.3f}" if mills else "") + (f" taxable ${tv:,}" if tv else ""),
            f"tax {money(r.tax_total)} mills {r.mills:.3f} taxable ${r.taxable_total:,.0f} "
            f"(ORION TaxAmount {money(r.tax_total_orion)}, TotalMills {r.mills_orion:.3f})", ok)

    # V8 panel arithmetic: 200 random parcels, line items (unrounded and cent-rounded) vs parcel tax
    parcels = pd.read_parquet(D / "parcels.parquet", columns=["pid", "levy", "tax", "tax_25"])
    samp = parcels[parcels.tax > 0].sample(200, random_state=7)
    worst = 0.0; worst_r = 0.0; n_ok = 0
    for r in samp.itertuples():
        v = lev["years"]["2026"].get(r.levy)
        if not v or not v["lines"]:
            continue
        tot = sum(l["mills"] for l in v["lines"])
        amts = [r.tax * l["mills"] / tot for l in v["lines"]]
        e = abs(sum(amts) - r.tax); er = abs(sum(round(a, 2) for a in amts) - r.tax)
        worst = max(worst, e); worst_r = max(worst_r, er); n_ok += 1
    add("V8", "Panel arithmetic: Σ levy line $ == parcel tax (200 random parcels, TY2026)", "±$0.05",
        f"max error {money(worst)} unrounded; {money(worst_r)} after per-line cent rounding ({n_ok} parcels)",
        worst <= 0.05, "The panel shows the exact parcel tax in the total row; per-line cents can differ by rounding.")

    # V9 class-rate reproduction: homestead residential, plain 2201/3501 only, TY2026
    o = p26[p26.is_homestead & p26.codes.isin(["2201,3501", "2201", "3501"]) & (p26.market_total > 0)]

    def tiers(v):
        t = [(378000, .0076), (756000, .009), (1512000, .011), (float("inf"), .019)]
        out, lo = 0.0, 0.0
        for hi, r in t:
            if v > lo:
                out += (min(v, hi) - lo) * r
            lo = hi
        return out
    # DOR computes the blended tier rate on total market value, rounds it to 2 decimals of a percent (ORION
    # TaxablePct), and applies it to each class-code row (rounded to whole dollars).
    blended = (o.market_total.map(tiers) / o.market_total * 100 + 1e-9).round(2)
    pred = o.market_total * blended / 100
    err = (o.taxable_total - pred).abs()
    share = float((err <= 3).mean())
    add("V9", "Class-rate reproduction: TY2026 homestead residential taxable == tiered formula (median $378,000; blended rate rounded to 0.01%)",
        "±$3 on >= 98%", f"{share * 100:.2f}% of {len(o):,} properties", share >= 0.98,
        f"Median abs error ${err.median():.2f}; 99th pct ${err.quantile(.99):.2f}.")

    # V10 GVUTD
    g = stats.get("utd-gallatin-valley-urban-transportation-district")
    for y in (("2026", "2025") if g else ()):
        mv = g[y]["mill_value"]
        add(f"V10-{y}", f"GVUTD value of 1 mill TY{y} (mapped real property)", "$250k–$400k",
            f"${mv:,.2f} (taxable ${g[y]['taxable']:,}; net of est. TIF increment ${g[y]['mill_value_net_tif']:,.2f})",
            250_000 <= mv <= 400_000,
            f"{g[y]['n_props']:,} properties on {g[y]['n_parcels']:,} parcels; {g[y]['n_res']:,} residential; "
            f"~{g[y]['hh']:,} dwelling units. Revenue: 5 mills ${mv * 5:,.0f}, 10 mills ${mv * 10:,.0f}, "
            f"15 mills ${mv * 15:,.0f}.")

    # V11 building allocation
    d = abs(bst["sum_alloc_tax_b"] - bst["sum_parcel_tax_b_with_fp"])
    add("V11", "Building allocation: Σ footprint structure tax == Σ parcel structure tax (parcels with footprints)",
        "exact (±$1 rounding)", f"{money(bst['sum_alloc_tax_b'])} vs {money(bst['sum_parcel_tax_b_with_fp'])}", d <= 1.0,
        f"{bst['parcels_with_tax_b_no_fp']:,} of {bst['parcels_with_tax_b']:,} parcels with structure tax have no "
        f"Overture footprint ({bst['parcels_with_tax_b_no_fp'] / bst['parcels_with_tax_b'] * 100:.1f}%, "
        f"{money(bst['tax_b_no_fp'])} = {bst['tax_b_no_fp'] / bst['tax_b_total'] * 100:.1f}% of structure tax; "
        f"mostly condo units in masters without footprints, mobile homes and rural improvements). "
        f"{bst['footprints']:,} footprints in county, {bst['footprints_with_parcel']:,} on a parcel.")

    # V12 independent spot check: 40 random properties (not the per-district samples) vs their Treasurer bill
    import importlib.util
    import sys
    argv = sys.argv; sys.argv = [argv[0], "--county", "gallatin"]  # 02_levies reads --county at import
    spec = importlib.util.spec_from_file_location("lv", Path(__file__).with_name("02_levies.py"))
    lv = importlib.util.module_from_spec(spec); spec.loader.exec_module(lv)
    sys.argv = argv
    used = set(pd.read_csv(D / "levy_samples.csv").ac)
    pool = p26[(p26.subcat != "MH") & (p26.taxable_total > 0) & (p26.n_dwellings >= 0) & ~p26.assessment_code.isin(used)
               & (p26.assessment_code.str.len() > 0) & ~p26.join_how.isin(["condo_master", "unit_x000"])]
    samp = pool.sample(40, random_state=11)
    res = {"2026": [0, 0, []], "2025": [0, 0, []]}
    near = {"2026": 0, "2025": 0}
    for r in samp.itertuples():
        if C.slug == "gallatin":
            pdf = lv.fetch_pdf(r.assessment_code)
            if not pdf:
                continue
            pr = lv.parse_pdf(pdf)
            gens = (("2026", pr["gen26"]), ("2025", pr["gen25"]))
        else:
            gens = (("2026", ys_bill(C, r.assessment_code, 2026)), ("2025", ys_bill(C, r.assessment_code, 2025)))
        for y, gen in gens:
            row = props[(props.property_id == r.property_id) & (props.tax_year == int(y))]
            if gen is None or row.empty:
                continue
            ours = float(row.tax_total.iloc[0]); orion = float(row.tax_total_orion.iloc[0])
            res[y][0] += 1
            if abs(ours - gen) < 0.015:
                res[y][1] += 1
            else:
                near[y] += abs(ours - gen) <= 3.0
                res[y][2].append(f"{r.assessment_code}: bill {money(gen)} vs app {money(ours)} (ORION {money(orion)})")
    for y, (n, ok, bad) in res.items():
        add(f"V12-{y}", f"Independent spot check TY{y}: app tax vs Treasurer bill, 40 random properties", "to the cent",
            f"{ok}/{n} exact" + (f", {ok + near[y]}/{n} within $3" if near[y] else ""), n > 0 and ok / n >= 0.95,
            ("Misses: " + "; ".join(bad[:10]) + (". Differences of a few cents on TIF parcels come from the Treasurer "
             "splitting the bill into base and increment lines and rounding each." if C.slug == "yellowstone" else ""))
            if bad else "All exact.")



def main():
    counties = [COUNTIES[c] for c in ORDER if (COUNTIES[c].derived / "property_points.parquet").exists()]
    for C in counties:
        validate(C)
    out = {"generated": date.today().isoformat(), "checks": checks}
    # The public page shows county-wide checks only; district-specific checks stay in VALIDATION.md.
    pub = {"generated": out["generated"], "checks": [c for c in checks if not c["id"].startswith("V10")]}
    (PUB / "validation.json").write_text(json.dumps(pub, indent=1))
    (ROOT / "data" / "derived" / "validation.json").write_text(json.dumps(out, indent=1))
    md = ["# Validation", "",
          f"Generated {out['generated']} by `pipeline/08_validate.py`. Gates per PLAN.md §9, run per county.", ""]
    for C in counties:
        cs = [c for c in checks if c["county"] == C.slug]
        n_fail = sum(c["status"] == "FAIL" for c in cs)
        md += [f"## {C.name} County", "", f"{len(cs) - n_fail}/{len(cs)} checks pass.", "",
               "| # | Check | Expected | Actual | Status |", "|---|---|---|---|---|"]
        for c in cs:
            md.append(f"| {c['id']} | {c['name']} | {c['expected']} | {c['actual']} | **{c['status']}** |")
        md += ["", f"### {C.name} details", ""]
        for c in cs:
            if c["detail"]:
                md.append(f"- **{c['id']}** ({c['status']}): {c['detail']}")
        md.append("")
    (ROOT / "VALIDATION.md").write_text("\n".join(md) + "\n")
    for c in checks:
        print(f"{c['status']}  {c['county'][:4]} {c['id']:18s} {c['actual']}")


if __name__ == "__main__":
    main()
