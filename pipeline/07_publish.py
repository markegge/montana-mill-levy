"""Step 7: browser data files -> public/data/ (parcels_index, levies, districts, district_stats, condos, meta).

Also copies the PMTiles into public/tiles/ for local dev (that folder is gitignored and stripped from builds;
production tiles live on R2).
"""
from __future__ import annotations

import json
import shutil
from datetime import date
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "data" / "derived"
PUB = ROOT / "public" / "data"
TILES = ROOT / "public" / "tiles"
PUB.mkdir(parents=True, exist_ok=True)
TILES.mkdir(parents=True, exist_ok=True)

RES_CATS = [1, 2, 3]


def build_index() -> tuple[pd.DataFrame, dict]:
    pts = pd.read_parquet(D / "property_points.parquet")
    lev = json.loads((D / "levies.json").read_text())
    code_idx = {c: i for i, c in enumerate(lev["codes"])}
    p26 = pts[pts.tax_year == 2026].set_index("property_id")
    p25 = pts[pts.tax_year == 2025].set_index("property_id")
    ids = p26.index.union(p25.index)
    base = p26.reindex(ids)
    fb = p25.reindex(ids)
    df = pd.DataFrame(index=ids)
    df["pid"] = base.pid.fillna(fb.pid)
    df["lon"] = base.rep_lon.fillna(fb.rep_lon)
    df["lat"] = base.rep_lat.fillna(fb.rep_lat)
    df["levy_code"] = base.levy_district.fillna(fb.levy_district)
    df["levy"] = df.levy_code.map(code_idx)
    df["tv26"] = base.taxable_total.fillna(0); df["tax26"] = base.tax_total.fillna(0)
    df["tv25"] = fb.taxable_total.fillna(0); df["tax25"] = fb.tax_total.fillna(0)
    df["cat26"] = base.cat.fillna(0).astype(int); df["cat25"] = fb.cat.fillna(0).astype(int)
    df["hh"] = base.hh.fillna(fb.hh).fillna(0).astype(int)
    df = df[(df.tv26 > 0) | (df.tv25 > 0) | (df.hh > 0)]
    return df.reset_index(names="property_id"), lev


def write_index(df: pd.DataFrame):
    cols = ["pid", "lon", "lat", "levy", "tv26", "tax26", "tv25", "tax25", "cat26", "cat25", "hh"]
    rows = []
    for r in df.itertuples(index=False):
        rows.append([r.pid if isinstance(r.pid, str) else None,
                     None if pd.isna(r.lon) else round(float(r.lon), 5),
                     None if pd.isna(r.lat) else round(float(r.lat), 5),
                     None if pd.isna(r.levy) else int(r.levy),
                     int(round(r.tv26)), round(float(r.tax26), 2), int(round(r.tv25)), round(float(r.tax25), 2),
                     int(r.cat26), int(r.cat25), int(r.hh)])
    (PUB / "parcels_index.json").write_text(json.dumps({"cols": cols, "rows": rows}, separators=(",", ":")))


def tif_ratios(df: pd.DataFrame, lev: dict) -> dict[str, dict[str, float]]:
    """Share of taxable value in each TIF levy district that is TIF increment, from DOR certified values.

    Countywide TIF increment (TY2026 $25.48M) = Bozeman ($23.70M, levy codes 06-0350T1..T6) + Belgrade
    ($1.79M, 06-0368T1). Mills levied on increment go to the TIF fund, not to the levying district.
    """
    cv = json.loads((ROOT / "data" / "reference" / "certified_values.json").read_text())["jurisdictions"]
    out: dict[str, dict[str, float]] = {}
    for y, tvcol in (("2026", "tv26"), ("2025", "tv25")):
        for juris, prefix in (("BOZEMAN", "06-0350T"), ("BELGRAD", "06-0368T")):
            inc = cv[y][juris]["values"].get("TIF Increment - Taxable Value") or 0
            codes = [c for c in lev["codes"] if c.startswith(prefix)]
            tv = df[df.levy_code.isin(codes)][tvcol].sum()
            r = min(1.0, inc / tv) if tv else 0.0
            for c in codes:
                out.setdefault(c, {})[y] = round(float(r), 4)
    return out


def district_stats(df: pd.DataFrame, tif: dict) -> dict:
    dist = gpd.read_file(D / "districts.geojson")
    pts = df[df.lon.notna()]
    g = gpd.GeoDataFrame(pts, geometry=gpd.points_from_xy(pts.lon, pts.lat), crs=4326)
    j = gpd.sjoin(g[["property_id", "geometry"]], dist[["id", "geometry"]], predicate="within", how="inner")
    members = j.groupby("id").property_id.apply(set).to_dict()
    out = {}
    for _, d in dist.iterrows():
        did = d["id"]
        sel = df if did == "gallatin-county" else df[df.property_id.isin(members.get(did, set()))]
        rec = {"name": d["name"], "type": d["type"]}
        for y, tv, cat, tax in (("2026", "tv26", "cat26", "tax26"), ("2025", "tv25", "cat25", "tax25")):
            s = sel[sel[tv] > 0]
            res = s[s[cat].isin(RES_CATS)]
            tif_inc = float((s[tv] * s.levy_code.map(lambda c: tif.get(c, {}).get(y, 0.0))).sum())
            rec[y] = {
                "taxable": int(s[tv].sum()), "mill_value": round(float(s[tv].sum()) / 1000, 2),
                "n_props": int(len(s)), "n_parcels": int(s.pid.nunique()), "n_res": int(len(res)),
                "hh": int(sel.hh.sum()) if y == "2026" else int(sel.hh.sum()),
                "median_res_taxable": float(res[tv].median()) if len(res) else 0.0,
                "current_tax": round(float(s[tax].sum()), 2),
                "tif_increment_est": round(tif_inc), "mill_value_net_tif": round((float(s[tv].sum()) - tif_inc) / 1000, 2),
                "by_cat": {str(k): int(v) for k, v in s.groupby(cat)[tv].sum().items()},
            }
        out[did] = rec
    return out


def ramp(vals: pd.Series, k: int = 7) -> list[float]:
    v = vals[vals > 0]
    qs = np.quantile(v, [i / k for i in range(1, k)])
    out = []
    for q in qs:
        mag = 10 ** max(0, int(np.floor(np.log10(q))) - 1) if q >= 10 else 0.1
        out.append(round(float(round(q / mag) * mag), 2))
    return out


def non_real() -> dict:
    """Certified taxable value that is not real property (personal property, centrally assessed utilities and
    railroads, net/gross proceeds, manufactured homes on others' land) - not mappable, shown as context."""
    cv = json.loads((ROOT / "data" / "reference" / "certified_values.json").read_text())
    out = {"retrieved": cv.get("retrieved"), "source": cv.get("source")}
    for y in ("2026", "2025"):
        out[y] = {}
        for k in ("CNTYWID", "BOZEMAN", "BELGRAD"):
            v = cv["jurisdictions"][y][k]["values"]
            total = v["Total - Taxable Value"]; real = v["Real Property - Taxable Value"]
            out[y][k] = {"total": total, "real": real, "tif_increment": v.get("TIF Increment - Taxable Value"),
                         "non_real_ratio": round((total - real) / real, 4)}
    return out


def main():
    df, lev = build_index()
    write_index(df)
    # levies.json for the browser: slimmer (drop diagnostics)
    slim = {"codes": lev["codes"],
            "districts": {c: {"base": m["base"], "name": m["name"], "city_rural": m["city_rural"]}
                          for c, m in lev["districts"].items()},
            "years": {y: {b: {"total": v["total"], "estimated": v["estimated"], "groups": v["groups"],
                              "lines": v["lines"]} for b, v in yy.items()} for y, yy in lev["years"].items()},
            "method": lev["method"]}
    for c in lev["codes"]:
        slim["districts"].setdefault(c, {"base": c[:9], "name": c, "city_rural": "Rural"})
    tif = tif_ratios(df, lev)
    for c, r in tif.items():
        slim["districts"][c]["tif_ratio"] = r
    (PUB / "levies.json").write_text(json.dumps(slim, separators=(",", ":")))

    dist = json.loads((D / "districts.geojson").read_text())
    for f in dist["features"]:
        f["properties"] = {k: f["properties"].get(k) for k in ("id", "name", "type", "source", "updated")}
    (PUB / "districts.json").write_text(json.dumps(dist, separators=(",", ":")))

    stats = district_stats(df, tif)
    (D / "district_stats.json").write_text(json.dumps(stats, indent=1))
    (PUB / "district_stats.json").write_text(json.dumps(stats, separators=(",", ":")))
    shutil.copy(D / "condos.json", PUB / "condos.json")

    parcels = pd.read_parquet(D / "parcels.parquet", columns=["tax", "tax_l", "tax_b", "eff"])
    bstats = json.loads((D / "buildings_stats.json").read_text())
    summ = json.loads((D / "orion_summary.json").read_text())
    meta = {
        "generated": date.today().isoformat(),
        "vintages": {"orion": "2026-11-06", "cadastral": "2026-11-03", "overture": "2026-10-21.0",
                     "mills_2026": "Gallatin County Treasurer TY2026 tax comparison reports (retrieved 2026-11-07)",
                     "mills_2025": "Gallatin County Treasurer (TY2025 billed mills)"},
        "totals": {y: {"properties": summ[y]["properties"], "taxable": summ[y]["taxable_total"],
                       "tax_orion": summ[y]["tax_total"],
                       "tax_model": round(float(df["tax26" if y == "2026" else "tax25"].sum()), 2)} for y in summ},
        "ramps": {"tax": ramp(parcels.tax), "tax_b": ramp(parcels.tax_b), "tax_l": ramp(parcels.tax_l),
                  "eff": ramp(parcels.eff)},
        "buildings": bstats,
        "non_real": non_real(),
        "attribution": "Data: Montana DOR (ORION, 2026-11-06), Montana State Library cadastral (2026-11-03), "
                       "Overture Maps buildings (2026-10-21), Gallatin County Treasurer mill levies",
    }
    (PUB / "meta.json").write_text(json.dumps(meta, indent=1))
    for f in ("parcels.pmtiles", "buildings.pmtiles"):
        shutil.copy(D / f, TILES / f)
    for f in sorted(PUB.iterdir()):
        print(f"{f.name:24s} {f.stat().st_size / 1e6:6.2f} MB")
    print("ramps", meta["ramps"])
    for k in ("utd-gallatin-valley-urban-transportation-district", "gallatin-county", "city-bozeman", "city-belgrade"):
        s = stats.get(k, {}).get("2026", {})
        print(k, s.get("taxable"), s.get("mill_value"), s.get("n_props"))


if __name__ == "__main__":
    main()
