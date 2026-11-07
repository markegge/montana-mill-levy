"""Step 5: importable district boundaries -> data/derived/districts.geojson (+ public/data/districts.json later).

Source: Montana State Library Administrative Boundaries Framework FeatureServer (GeoJSON, outSR=4326).
GVUTD uses the staged MSL layer-61 polygon in data/reference/gvutd_boundary_msl.geojson.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
from county import county_from_argv

C = county_from_argv()
D = C.derived
RAW = C.raw / "boundaries"
RAW.mkdir(parents=True, exist_ok=True)
REF = ROOT / "data" / "reference"
B = "https://services.arcgis.com/qnjIrwR8z5Izc0ij/arcgis/rest/services/Montana_Administrative_Boundaries_Framework/FeatureServer"
BBOX = ",".join(str(v) for v in C.bbox)

# layer -> (type, name field, extra where)
LAYERS = {
    5: ("county", "NAME", f"NAME='{C.name}'"),
    7: ("city", "NAME", "1=1"),
    10: ("elem_sd", "NAME", "1=1"),
    11: ("hs_sd", "NAME", "1=1"),
    12: ("k12_sd", "NAME", "1=1"),
    15: ("tifd", "NAME", "1=1"),
    42: ("cemetery", "DistrictName", "1=1"),
    45: ("fire", "DistrictName", "1=1"),
    49: ("mosquito", "DistrictName", "1=1"),
    57: ("special", "DistrictName", "1=1"),
    61: ("utd", "DistrictName", "1=1"),
}


def fetch(layer: int, where: str) -> gpd.GeoDataFrame:
    cache = RAW / f"msl_layer{layer}.geojson"
    if not cache.exists():
        feats, off = [], 0
        while True:
            r = requests.get(f"{B}/{layer}/query", params={
                "where": where, "geometry": BBOX, "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": 4326, "f": "geojson",
                "resultOffset": off, "resultRecordCount": 1000}, timeout=120)
            r.raise_for_status()
            fc = r.json()
            feats += fc.get("features", [])
            if not fc.get("properties", {}).get("exceededTransferLimit") and len(fc.get("features", [])) < 1000:
                break
            off += 1000
        cache.write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    g = gpd.read_file(cache)
    if g.crs is None:
        g = g.set_crs(4326)
    return g


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    county = fetch(5, LAYERS[5][2])
    cpoly = county.to_crs(6514).geometry.union_all()
    rows = []
    for layer, (typ, nf, where) in LAYERS.items():
        g = fetch(layer, where)
        if g.empty:
            continue
        gm = g.to_crs(6514)
        gm["geometry"] = gm.geometry.make_valid()
        inter = gm.geometry.intersection(cpoly).area
        frac = inter / gm.geometry.area.where(gm.geometry.area > 0, 1)
        # keep features meaningfully inside Gallatin County (>= 5% of their area, or >= 2 km2)
        keep = (frac >= 0.05) | (inter >= 2e6)
        gm = gm[keep]
        if typ == "utd" and C.slug == "gallatin":
            gm = gm[~gm[nf].str.contains("GALLATIN VALLEY", case=False, na=False)]  # use the staged GVUTD file
        for _, r in gm.iterrows():
            name = str(r.get(nf) or "").strip()
            if not name:
                continue
            upd = r.get("LAST_UPDATE") or r.get("LastUpdate") or ""
            src = r.get("SOURCE") or r.get("Source") or "MSL"
            pretty = name.title() if name.isupper() else name
            if typ == "city":
                pretty = ("City of " if pretty in ("Bozeman", "Belgrade", "Billings", "Laurel") else "Town of ") + pretty
            elif typ == "fire" and "fire" not in pretty.lower():
                pretty += " Fire District"
            elif typ == "tifd" and "tif" not in pretty.lower():
                pretty += " TIFD"
            elif typ == "cemetery":
                pretty = pretty.replace("Cemetary", "Cemetery") + " District"
            rows.append({"id": f"{typ}-{slug(name)}", "name": pretty, "type": typ, "source": f"MSL layer {layer} ({src})",
                         "updated": str(upd)[:10], "geometry": r.geometry})
    out = gpd.GeoDataFrame(rows, geometry="geometry", crs=6514)
    if out.empty:
        raise SystemExit("no boundaries")
    crow = out[out["type"] == "county"].copy()
    crow["id"] = f"{C.slug}-county"; crow["name"] = f"{C.name} County"
    parts = [crow, out[out["type"] != "county"].assign(id=lambda d: C.id_prefix + d["id"])]
    if C.slug == "gallatin":
        # GVUTD (MSL layer 61, County GIS, 2022-08-23) from the staged reference file
        gv = gpd.read_file(REF / "gvutd_boundary_msl.geojson").to_crs(6514)
        parts.insert(0, gpd.GeoDataFrame([{
            "id": "utd-gallatin-valley-urban-transportation-district",
            "name": "Gallatin Valley Urban Transportation District", "type": "utd",
            "source": "MSL layer 61 (County GIS), updated 2022-08-23", "updated": "2022-08-23",
            "geometry": gv.geometry.union_all()}], crs=6514))
    out = pd.concat(parts, ignore_index=True)
    out = gpd.GeoDataFrame(out, geometry="geometry", crs=6514)
    out["county"] = C.slug
    # de-duplicate ids
    out["id"] = out.id.where(~out.id.duplicated(), out.id + "-" + out.groupby("id").cumcount().astype(str))
    out["geometry"] = out.geometry.simplify(5, preserve_topology=True)
    out = out.to_crs(4326)
    out.to_file(D / "districts.geojson", driver="GeoJSON", engine="pyogrio", COORDINATE_PRECISION=5)
    print(out.groupby("type").size().to_dict())
    print(out[out["type"].isin(["city", "utd", "fire"])][["id", "name"]].to_string())
    print("size MB", round((D / "districts.geojson").stat().st_size / 1e6, 2))


if __name__ == "__main__":
    main()
