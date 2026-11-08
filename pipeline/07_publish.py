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

from county import COUNTIES, ORDER, County

ROOT = Path(__file__).resolve().parents[1]
DERIVED = ROOT / "data" / "derived"
PUB = ROOT / "public" / "data"
TILES = ROOT / "public" / "tiles"
PUB.mkdir(parents=True, exist_ok=True)
TILES.mkdir(parents=True, exist_ok=True)

RES_CATS = [1, 2, 3]


def build_index(D: Path, code_idx: dict[str, int]) -> pd.DataFrame:
    pts = pd.read_parquet(D / "property_points.parquet")
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
    return df.reset_index(names="property_id")


def write_index(df: pd.DataFrame, slug: str):
    cols = ["pid", "lon", "lat", "levy", "tv26", "tax26", "tv25", "tax25", "cat26", "cat25", "hh"]
    rows = []
    for r in df.itertuples(index=False):
        rows.append([r.pid if isinstance(r.pid, str) else None,
                     None if pd.isna(r.lon) else round(float(r.lon), 5),
                     None if pd.isna(r.lat) else round(float(r.lat), 5),
                     None if pd.isna(r.levy) else int(r.levy),
                     int(round(r.tv26)), round(float(r.tax26), 2), int(round(r.tv25)), round(float(r.tax25), 2),
                     int(r.cat26), int(r.cat25), int(r.hh)])
    (PUB / f"parcels_index_{slug}.json").write_text(json.dumps({"cols": cols, "rows": rows}, separators=(",", ":")))


# TIF levy districts per certified jurisdiction. Mills levied on TIF increment go to the TIF fund, not to the
# levying district. "*REST" = county-wide increment minus the listed city increments (e.g. Lockwood TEDD).
TIF_JURIS = {
    "gallatin": [("BOZEMAN", r"^06-0350T"), ("BELGRAD", r"^06-0368T")],
    "yellowstone": [("BLGS", r"^03-(0965T|09653A|0981T)"), ("LAUREL", r"^03-0970TI"), ("*REST", r"^03-1241TF")],
}
COUNTY_JURIS = {"gallatin": "CNTYWID", "yellowstone": "COWDLVY"}
CITY_JURIS = {"gallatin": ["BOZEMAN", "BELGRAD"], "yellowstone": ["BLGS", "LAUREL"]}


def tif_ratios(C: County, df: pd.DataFrame, codes: list[str]) -> dict[str, dict[str, float]]:
    import re
    cv = json.loads(C.certified_values.read_text())["jurisdictions"]
    out: dict[str, dict[str, float]] = {}
    for y, tvcol in (("2026", "tv26"), ("2025", "tv25")):
        listed = 0.0
        for juris, pat in TIF_JURIS[C.slug]:
            if juris == "*REST":
                inc = (cv[y][COUNTY_JURIS[C.slug]]["values"].get("TIF Increment - Taxable Value") or 0) - listed
            else:
                inc = cv[y][juris]["values"].get("TIF Increment - Taxable Value") or 0
                listed += inc
            cs = [c for c in codes if re.match(pat, c)]
            tv = df[df.levy_code.isin(cs)][tvcol].sum()
            r = max(0.0, min(1.0, inc / tv)) if tv else 0.0
            for c in cs:
                out.setdefault(c, {})[y] = round(float(r), 4)
    return out


def district_stats(C: County, df: pd.DataFrame, tif: dict) -> dict:
    dist = gpd.read_file(C.derived / "districts.geojson")
    pts = df[df.lon.notna()]
    g = gpd.GeoDataFrame(pts, geometry=gpd.points_from_xy(pts.lon, pts.lat), crs=4326)
    j = gpd.sjoin(g[["property_id", "geometry"]], dist[["id", "geometry"]], predicate="within", how="inner")
    members = j.groupby("id").property_id.apply(set).to_dict()
    out = {}
    for _, d in dist.iterrows():
        did = d["id"]
        sel = df if did == f"{C.slug}-county" else df[df.property_id.isin(members.get(did, set()))]
        rec = {"name": d["name"], "type": d["type"], "county": C.slug}
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


def non_real(C: County) -> dict:
    """Certified taxable value that is not real property (personal property, centrally assessed utilities and
    railroads, net/gross proceeds, manufactured homes on others' land) - not mappable, shown as context."""
    cv = json.loads(C.certified_values.read_text())
    out = {}
    for y in ("2026", "2025"):
        out[y] = {}
        for k in [COUNTY_JURIS[C.slug]] + CITY_JURIS[C.slug]:
            v = cv["jurisdictions"][y][k]["values"]
            total = v["Total - Taxable Value"]; real = v["Real Property - Taxable Value"]
            out[y][k] = {"total": total, "real": real, "tif_increment": v.get("TIF Increment - Taxable Value"),
                         "non_real_ratio": round((total - real) / real, 4)}
    return out


BILL_URL = {"gallatin": "https://itax.gallatin.mt.gov/PDF/{year}/RE/{ac}.pdf",
            "yellowstone": "https://www.yellowstonecountymt.gov/treasurer/propertysearch/csatydet.asp?propid={ac}&lyear={year}"}
VINTAGE = {"gallatin": {"mills": "Gallatin County Treasurer tax comparison statements (retrieved 2026-11-07)"},
           "yellowstone": {"mills": "Yellowstone County Treasurer property tax statements (retrieved 2026-11-07)"}}


CITY_FIX = {"Gallatin Gtwy": "Gallatin Gateway", "Gallatin Gate Way": "Gallatin Gateway", "Gallatin Gwy": "Gallatin Gateway",
            "Gateway": "Gallatin Gateway", "W Yellowstone": "West Yellowstone", "West Yellowston": "West Yellowstone",
            "Lauerl": "Laurel", "Bilings": "Billings", "Ballintine": "Ballantine", "Shepered": "Shepherd",
            "Shephard": "Shepherd", "Pom Pey Pillar": "Pompeys Pillar", "Pompey Pillar": "Pompeys Pillar",
            "Pompey'S Pillar": "Pompeys Pillar"}


def address_index(C: County) -> int:
    """public/data/addr_<county>.json: property (situs) addresses -> parcel id + representative point.

    Sources: the cadastral AddressLine1/CityStateZip of each parcel, plus every ORION property address on the parcel
    (condo units carry their unit number). Owner names and mailing addresses are never included.
    """
    import re
    pc = pd.read_parquet(C.derived / "parcels.parquet", columns=["pid", "addr", "rep_lon", "rep_lat"])
    pts = pd.read_parquet(C.derived / "property_points.parquet", columns=["tax_year", "pid", "address"])
    pts = pts[pts.pid.notna()].sort_values("tax_year", ascending=False)
    loc = pc.set_index("pid")[["rep_lon", "rep_lat"]]
    orion_city = {}
    rows, seen = [], set()

    def split(a: str):
        a = (a or "").strip()
        city = ""
        if "," in a:
            head, tail = [x.strip() for x in a.rsplit(",", 1)]
            if tail and not re.search(r"\d", tail):
                a, city = head, tail
        unit = ""
        m = re.search(r"\s#\s*(\S+)$", a)
        if m:
            unit, a = m.group(1), a[:m.start()].strip()
        city = CITY_FIX.get(city.title(), city.title())
        return a.upper(), city, unit.upper()

    for r in pts.itertuples():
        a, city, _ = split(r.address)
        if city:
            orion_city.setdefault(r.pid, city)

    def add(pid, a, city, unit):
        if not a or not re.match(r"^\d", a) or pid not in loc.index:
            return
        key = (a, unit, pid)
        if key in seen:
            return
        seen.add(key)
        lon, lat = loc.loc[pid]
        rows.append([a, city or orion_city.get(pid, ""), unit, pid, round(float(lon), 5), round(float(lat), 5)])

    for r in pc.itertuples():
        a, city, unit = split(r.addr)
        add(r.pid, a, city, unit)
    has_addr = {r[3] for r in rows}
    for r in pts.drop_duplicates(["pid", "address"]).itertuples():
        a, city, unit = split(r.address)
        if unit or r.pid not in has_addr:   # condo units, and parcels without a cadastral situs address
            add(r.pid, a, city, unit)
    # compact: parcels table + rows referencing it; cities as a lookup list
    parcels, pidx, cities, cidx, out_rows = [], {}, [], {}, []
    for a, city, unit, pid, lon, lat in rows:
        if pid not in pidx:
            pidx[pid] = len(parcels); parcels.append([pid, lon, lat])
        if city not in cidx:
            cidx[city] = len(cities); cities.append(city)
        out_rows.append([a, cidx[city], unit, pidx[pid]] if unit else [a, cidx[city], pidx[pid]])
    out = {"format": "rows: [addr, cityIdx, parcelIdx] or [addr, cityIdx, unit, parcelIdx]",
           "cities": cities, "parcels": parcels, "rows": out_rows}
    (PUB / f"addr_{C.slug}.json").write_text(json.dumps(out, separators=(",", ":")))
    return len(out_rows)


def main():
    counties = [COUNTIES[s] for s in ORDER if (COUNTIES[s].derived / "property_points.parquet").exists()]
    levs = {C.slug: json.loads((C.derived / "levies.json").read_text()) for C in counties}
    codes = [c for C in counties for c in levs[C.slug]["codes"]]
    code_idx = {c: i for i, c in enumerate(codes)}
    slim = {"codes": codes, "districts": {}, "years": {"2026": {}, "2025": {}},
            "method": "Line-item mills from each county Treasurer's statements for one representative property per levy district."}
    feats, stats, condos, non_real_all = [], {}, {}, {}
    counties_meta, all_parcels = {}, []
    for C in counties:
        lev = levs[C.slug]
        df = build_index(C.derived, code_idx)
        write_index(df, C.slug)
        print(C.slug, "address entries", address_index(C))
        for c, m in lev["districts"].items():
            slim["districts"][c] = {"base": m["base"], "name": m["name"], "city_rural": m["city_rural"], "county": C.slug}
        for c in lev["codes"]:
            slim["districts"].setdefault(c, {"base": c, "name": c, "city_rural": "Rural", "county": C.slug})
        for y, yy in lev["years"].items():
            for b, v in yy.items():
                slim["years"][y][b] = {"total": v["total"], "estimated": v["estimated"], "groups": v["groups"], "lines": v["lines"]}
        tif = tif_ratios(C, df, lev["codes"])
        for c, r in tif.items():
            slim["districts"][c]["tif_ratio"] = r
        dist = json.loads((C.derived / "districts.geojson").read_text())
        for f in dist["features"]:
            f["properties"] = {k: f["properties"].get(k) for k in ("id", "name", "type", "source", "updated", "county")}
            f["properties"]["county"] = C.slug
        feats += dist["features"]
        st = district_stats(C, df, tif)
        (C.derived / "district_stats.json").write_text(json.dumps(st, indent=1))
        stats.update(st)
        condos.update(json.loads((C.derived / "condos.json").read_text()))
        nr = non_real(C)
        for y in nr:
            non_real_all.setdefault(y, {}).update(nr[y])
        summ = json.loads((C.derived / "orion_summary.json").read_text())
        pc = gpd.read_parquet(C.derived / "parcels.parquet")
        b = pc.to_crs(4326).total_bounds
        all_parcels.append(pc[["tax", "tax_l", "tax_b", "eff"]])
        counties_meta[C.slug] = {
            "name": f"{C.name} County", "dor_code": C.dor_code, "district_id": f"{C.slug}-county",
            "index": f"parcels_index_{C.slug}.json", "addresses": f"addr_{C.slug}.json", "bbox": [round(float(x), 4) for x in b],
            "juris": {"county": COUNTY_JURIS[C.slug], "cities": CITY_JURIS[C.slug]},
            "bill_url": BILL_URL[C.slug], "mills_source": VINTAGE[C.slug]["mills"],
            "totals": {y: {"properties": summ[y]["properties"], "taxable": summ[y]["taxable_total"],
                           "tax_orion": summ[y]["tax_total"],
                           "tax_model": round(float(df["tax26" if y == "2026" else "tax25"].sum()), 2)} for y in summ},
            "buildings": json.loads((C.derived / "buildings_stats.json").read_text()),
        }
    (PUB / "levies.json").write_text(json.dumps(slim, separators=(",", ":")))
    (PUB / "districts.json").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))
    (PUB / "district_stats.json").write_text(json.dumps(stats, separators=(",", ":")))
    (PUB / "condos.json").write_text(json.dumps(condos, separators=(",", ":")))
    old = PUB / "parcels_index.json"
    if old.exists():
        old.unlink()
    parcels = pd.concat(all_parcels)
    meta = {
        "generated": date.today().isoformat(),
        "counties": counties_meta,
        "vintages": {"orion": "2026-11-06", "cadastral": "2026-11-03", "overture": "2026-10-21.0",
                     "mills_2026": "County Treasurer tax statements (retrieved 2026-11-07)",
                     "mills_2025": "County Treasurer tax statements (TY2025 billed mills)"},
        "ramps": {"tax": ramp(parcels.tax), "tax_b": ramp(parcels.tax_b), "tax_l": ramp(parcels.tax_l),
                  "eff": ramp(parcels.eff)},
        "non_real": non_real_all,
        "attribution": "Data: Montana DOR (ORION, 2026-11-06), Montana State Library cadastral (2026-11-03), "
                       "Overture Maps buildings (2026-10-21), Gallatin and Yellowstone County Treasurers",
    }
    (PUB / "meta.json").write_text(json.dumps(meta, indent=1))
    for f in ("parcels.pmtiles", "buildings.pmtiles"):
        shutil.copy(DERIVED / "all" / f, TILES / f)
    for f in sorted(PUB.iterdir()):
        print(f"{f.name:28s} {f.stat().st_size / 1e6:6.2f} MB")
    print("ramps", meta["ramps"])
    for k in ("utd-gallatin-valley-urban-transportation-district", "gallatin-county", "city-bozeman",
              "yellowstone-county", "ys-city-billings", "ys-city-laurel"):
        s_ = stats.get(k, {}).get("2026", {})
        print(k, s_.get("taxable"), s_.get("mill_value"), s_.get("n_props"))


if __name__ == "__main__":
    main()
