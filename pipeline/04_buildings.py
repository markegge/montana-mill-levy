"""Step 4: Overture building footprints -> parcels, with structure-tax allocation.

Each footprint is assigned to the parcel containing its representative point. A parcel's structure tax
(tax_b, TY2026 and TY2025) is split across its footprints in proportion to footprint area x height (volume
proxy). Footprints under 30 m2 (sheds) get zero unless they are the parcel's only footprint.
Height: Overture `height`, else num_floors x 3.2 m, else by class (house 6, apartments 9, commercial 5, other 5).
"""
from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "data" / "derived"
SRC = ROOT / "data" / "raw" / "overture" / "gallatin_buildings.parquet"
CRS_M = 6514  # NAD83(2011) Montana State Plane, metres

CLASS_H = {"house": 6.0, "detached": 6.0, "residential": 6.0, "apartments": 9.0, "commercial": 5.0, "retail": 5.0,
           "industrial": 7.0, "garage": 3.0, "shed": 3.0}


def main():
    b = gpd.read_parquet(SRC)
    print("overture footprints in bbox", len(b))
    keep = [c for c in ["id", "height", "num_floors", "class", "subtype", "geometry"] if c in b.columns]
    b = b[keep].copy()
    b = b[b.geometry.geom_type.isin(["Polygon", "MultiPolygon"])]
    b = b.to_crs(CRS_M)

    parcels = gpd.read_parquet(D / "parcels.parquet")[["pid", "tax_b", "tax_b_25", "tv_b", "tax", "geometry"]]
    county = parcels.geometry.union_all() if hasattr(parcels.geometry, "union_all") else parcels.unary_union
    rp = gpd.GeoDataFrame({"i": np.arange(len(b))}, geometry=b.geometry.representative_point().values, crs=CRS_M)
    j = gpd.sjoin(rp, parcels[["pid", "geometry"]], predicate="within", how="left").drop_duplicates("i")
    b["pid"] = j.sort_values("i").pid.values

    # clip to the county: drop footprints outside any parcel AND outside the county parcel fabric's hull
    hull = county.convex_hull
    inside = b.geometry.representative_point().within(hull)
    b = b[inside | b.pid.notna()].copy()

    b["area_m2"] = b.geometry.area
    h = pd.to_numeric(b.get("height"), errors="coerce")
    nf = pd.to_numeric(b.get("num_floors"), errors="coerce")
    cls = b.get("class").fillna("") if "class" in b else pd.Series("", index=b.index)
    h_cls = cls.map(CLASS_H).fillna(5.0)
    b["h"] = np.where(h.notna() & (h > 0), h, np.where(nf.notna() & (nf > 0), nf * 3.2, h_cls)).clip(2.5, 120).round(1)
    b["height_src"] = np.where(h.notna() & (h > 0), "overture", np.where(nf.notna() & (nf > 0), "floors", "class"))

    b["w"] = b.area_m2 * b.h
    n_on = b.groupby("pid").pid.transform("size")
    b.loc[(b.area_m2 < 30) & (n_on > 1), "w"] = 0.0
    wsum = b.groupby("pid").w.transform("sum")
    # parcels whose footprints are all sheds: fall back to plain volume weights
    allsmall = (wsum == 0) & b.pid.notna()
    b.loc[allsmall, "w"] = b.loc[allsmall, "area_m2"] * b.loc[allsmall, "h"]
    wsum = b.groupby("pid").w.transform("sum")
    b["share"] = np.where(wsum > 0, b.w / wsum, 0.0)

    pa = parcels.set_index("pid")
    for col in ["tax_b", "tax_b_25", "tv_b", "tax"]:
        b["p_" + col] = b.pid.map(pa[col])
    b["tax_b_alloc"] = (b.share * b.p_tax_b).round(2)
    b["tax_b_alloc_25"] = (b.share * b.p_tax_b_25).round(2)
    b["tv_b_alloc"] = (b.share * b.p_tv_b).round(0)

    # stats for validation (V11)
    has_fp = set(b.pid.dropna())
    with_b = parcels[parcels.tax_b > 0]
    stats = {
        "footprints": int(len(b)), "footprints_with_parcel": int(b.pid.notna().sum()),
        "height_src": b.height_src.value_counts().to_dict(),
        "sum_alloc_tax_b": round(float(b.tax_b_alloc.fillna(0).sum()), 2),
        "sum_parcel_tax_b_with_fp": round(float(with_b[with_b.pid.isin(has_fp)].tax_b.sum()), 2),
        "parcels_with_tax_b": int(len(with_b)),
        "parcels_with_tax_b_no_fp": int((~with_b.pid.isin(has_fp)).sum()),
        "tax_b_no_fp": round(float(with_b[~with_b.pid.isin(has_fp)].tax_b.sum()), 2),
        "tax_b_total": round(float(with_b.tax_b.sum()), 2),
    }
    print(json.dumps(stats, indent=1))
    (D / "buildings_stats.json").write_text(json.dumps(stats, indent=1))

    out = b.to_crs(4326)
    has_tax = out.tax_b_alloc.notna() & (out.p_tax_b > 0)
    o = gpd.GeoDataFrame({
        "bid": out["id"].astype(str).str[-12:],
        "pid": out.pid,
        "h": out.h,
        "tax_b": out.tax_b_alloc.where(has_tax),
        "tax_b_25": out.tax_b_alloc_25.where(has_tax),
        "share": out.share.round(3).where(out.pid.notna()),
        "cls": cls.loc[out.index].astype(str),
    }, geometry=out.geometry.values, crs=4326)
    o.to_file(D / "buildings.geojson", driver="GeoJSON", engine="pyogrio", COORDINATE_PRECISION=6)


if __name__ == "__main__":
    main()
