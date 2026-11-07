"""Step 3: join ORION properties to cadastral parcel polygons; aggregate to the parcel.

Outputs (data/derived/):
  parcels.geojson            polygons (EPSG:4326) with per-parcel TY2026 + TY2025 attributes (no owner fields)
  property_points.parquet    one row per ORION property x year with its parcel id + representative point
  parcels_unmatched.csv      ORION properties with no polygon (reported in validation)
  condos.json                condo units per master parcel (for the panel)
"""
from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "data" / "derived"
GDB = ROOT / "data" / "raw" / "cadastral" / "Gallatin_Parcels.gdb"


def load_parcels() -> gpd.GeoDataFrame:
    g = pyogrio.read_dataframe(GDB, layer="OwnerParcel",
                               columns=["PARCELID", "LevyDistrict", "PropType", "GISAcres", "AddressLine1",
                                        "CityStateZip", "AssessmentCode"])
    g = g[g.PARCELID.notna() & (g.PARCELID.str.strip() != "")].copy()
    g["PARCELID"] = g.PARCELID.str.strip()
    g = g[~g.geometry.is_empty & g.geometry.notna()]
    g["geometry"] = g.geometry.make_valid()
    # duplicate PARCELIDs (multi-part parcels split in the source): dissolve
    if g.PARCELID.duplicated().any():
        n = g.PARCELID.duplicated().sum()
        print(f"dissolving {n} duplicate PARCELID rows")
        g = g.dissolve(by="PARCELID", aggfunc="first").reset_index()
    rp = g.geometry.representative_point()
    rp = gpd.GeoSeries(rp, crs=g.crs).to_crs(4326)
    g["rep_lon"] = rp.x.round(6)
    g["rep_lat"] = rp.y.round(6)
    return g


def apply_billed_mills(props: pd.DataFrame) -> pd.DataFrame:
    """Tax = ORION taxable value x the Treasurer-billed mills of the property's levy district (02_levies.py).

    ORION's own TotalMills/TaxAmount match the Treasurer's bills for most TY2026 districts, but not for 10 TY2026
    districts (ORION omits the 1.74-mill Countywide Planning levy the bill includes) and for many TY2025 districts
    (ORION carries a stale mill set, e.g. Belgrade 446.87 vs billed 680.06). Taxable values are always ORION's.
    Mobile homes on others' land (subcat MH) are billed on the prior year's mills, so they keep ORION's TaxAmount.
    The ORION amounts are kept as *_orion columns for the validation log.
    """
    lev = json.loads((D / "levies.json").read_text())
    props = props.copy()
    for c in ["tax_total", "tax_land", "tax_bldg", "mills"]:
        props[c + "_orion"] = props[c]
    for y in (2025, 2026):
        tot = {b: v["total"] for b, v in lev["years"][str(y)].items() if v.get("total")}
        sel = (props.tax_year == y) & (props.subcat != "MH") & props.levy_base.isin(tot.keys())
        m = props.loc[sel, "levy_base"].map(tot)
        # only re-price where ORION's mills differ from the bill; elsewhere keep ORION's per-row-rounded TaxAmount
        sel = sel & (props.levy_base.map(tot).round(3) != props.mills.round(3))
        m = props.loc[sel, "levy_base"].map(tot)
        props.loc[sel, "mills"] = m
        props.loc[sel, "tax_land"] = (props.loc[sel, "taxable_land"] * m / 1000).round(2)
        props.loc[sel, "tax_bldg"] = (props.loc[sel, "taxable_bldg"] * m / 1000).round(2)
        props.loc[sel, "tax_total"] = props.loc[sel, "tax_land"] + props.loc[sel, "tax_bldg"]
    props["tax_basis"] = np.where(props.mills.round(3) == props.mills_orion.round(3), "orion", "billed_mills")
    return props


def main():
    parcels = load_parcels()
    print("parcels", len(parcels))
    pset = set(parcels.PARCELID)
    props = pd.read_parquet(D / "properties.parquet")
    props = apply_billed_mills(props)

    # --- join rules ------------------------------------------------------------------------------------------
    # (a) direct geocode; (b) condo unit -> CondoMaster -> master's geocode; (c) suffix -> 0000
    id2geo = props.drop_duplicates(["property_id", "tax_year"]).set_index(["property_id", "tax_year"]).geocode17
    props["master_geo"] = [id2geo.get((int(m), y)) if pd.notna(m) else None
                           for m, y in zip(props.condo_master_id, props.tax_year)]
    pid = np.where(props.geocode17.isin(pset), props.geocode17, None)
    how = np.where(pd.notna(pid), "direct", None)
    mg = props.master_geo.where(props.master_geo.isin(pset))
    sel = pd.isna(pid) & mg.notna().to_numpy()
    pid = np.where(sel, mg, pid); how = np.where(sel, "condo_master", how)
    parent = props.geocode17.str[:-4] + "0000"
    sel = pd.isna(pid) & parent.isin(pset).to_numpy()
    pid = np.where(sel, parent, pid); how = np.where(sel, "parent_0000", how)
    # (d) unit suffix -> its building master, e.g. ...7421 -> ...7000 (Big Sky condo plats without CondoMaster rows)
    master3 = props.geocode17.str[:-3] + "000"
    sel = pd.isna(pid) & master3.isin(pset).to_numpy()
    pid = np.where(sel, master3, pid); how = np.where(sel, "unit_x000", how)
    props["pid"] = pid
    props["join_how"] = pd.Series(how, index=props.index).fillna("unmatched")

    jr = {}
    for y in (2025, 2026):
        o = props[props.tax_year == y]
        jr[y] = {k: {"n": int((o.join_how == k).sum()), "taxable": float(o.loc[o.join_how == k, "taxable_total"].sum())}
                 for k in ["direct", "condo_master", "parent_0000", "unit_x000", "unmatched"]}
        jr[y]["coverage_taxable_pct"] = round(100 * (1 - jr[y]["unmatched"]["taxable"] / o.taxable_total.sum()), 3)
    print(json.dumps(jr, indent=1))
    (D / "join_report.json").write_text(json.dumps(jr, indent=1))
    um = props[props.join_how == "unmatched"].sort_values("taxable_total", ascending=False)
    um[["tax_year", "property_id", "geocode17", "assessment_code", "subcat", "levy_district", "taxable_total",
        "tax_total", "address"]].to_csv(D / "parcels_unmatched.csv", index=False)

    # households (dwelling units) per property
    res_like = props.cat.isin([1, 2, 3])
    props["hh"] = np.where(res_like, np.maximum.reduce([props.n_dwellings, props.liv_units, np.ones(len(props), int)]),
                           np.where(props.cat == 5, np.maximum(props.liv_units, 1), props.n_dwellings)).astype(int)

    pts = props.merge(parcels[["PARCELID", "rep_lon", "rep_lat"]], left_on="pid", right_on="PARCELID", how="left")
    pts.drop(columns=["PARCELID"]).to_parquet(D / "property_points.parquet", index=False)

    # --- aggregate to the parcel ---------------------------------------------------------------------------
    m = props[props.pid.notna()].copy()
    m["is_unit"] = m.join_how.isin(["condo_master", "unit_x000"])

    def agg_year(y: int) -> pd.DataFrame:
        o = m[m.tax_year == y]
        g = o.groupby("pid")
        a = g.agg(tax=("tax_total", "sum"), tax_l=("tax_land", "sum"), tax_b=("tax_bldg", "sum"),
                  tv=("taxable_total", "sum"), tv_l=("taxable_land", "sum"), tv_b=("taxable_bldg", "sum"),
                  mkt=("market_total", "sum"), mkt_l=("market_land", "sum"), mkt_b=("market_bldg", "sum"),
                  n_props=("property_id", "size"), n_units=("is_unit", "sum"))
        # mills: the mills of the largest-taxable property on the parcel
        top = o.sort_values("taxable_total", ascending=False).drop_duplicates("pid").set_index("pid")
        a["mills"] = top.mills
        a["cat"] = top.cat
        a["levy_o"] = top.levy_district
        a["ac_o"] = top.assessment_code.where(~top.is_unit, "")
        a["addr_o"] = top.address
        a["eff"] = np.where(a.mkt > 0, a.tax / a.mkt * 1000, 0)
        return a

    a26 = agg_year(2026)
    a25 = agg_year(2025)
    p = parcels.set_index("PARCELID")
    out = p[["geometry", "LevyDistrict", "GISAcres", "AddressLine1", "CityStateZip", "AssessmentCode", "rep_lon",
             "rep_lat"]].join(a26).join(a25.add_suffix("_25"))
    for c in ["tax", "tax_l", "tax_b", "tv", "tv_l", "tv_b", "mkt", "mkt_l", "mkt_b", "eff", "n_props", "n_units"]:
        out[c] = out[c].fillna(0); out[c + "_25"] = out[c + "_25"].fillna(0)
    out["cat"] = out.cat.fillna(out.cat_25).fillna(0).astype(int)
    out["levy"] = out.levy_o.fillna(out.levy_o_25).fillna(out.LevyDistrict).fillna("").str.strip()
    # Use the parcel's own AssessmentCode (cadastral) when it's a real-property code; condo masters get "".
    ac = out.ac_o.where(out.ac_o.notna(), out.ac_o_25)
    ac = ac.fillna(out.AssessmentCode.fillna("").str.strip().str.lstrip("0"))
    out["ac"] = ac.where(out.n_units == 0, "")
    addr_c = (out.AddressLine1.fillna("").str.strip() + ", " +
              out.CityStateZip.fillna("").str.strip().str.replace(r",? MT.*$", "", regex=True).str.title()).str.strip(", ")
    out["addr"] = np.where(addr_c.str.len() > 0, addr_c, out.addr_o.fillna(out.addr_o_25).fillna(""))
    out["acres"] = out.GISAcres.fillna(0).round(3)
    money = ["tax", "tax_l", "tax_b", "tax_25", "tax_l_25", "tax_b_25"]
    for c in money:
        out[c] = out[c].round(2)
    for c in ["tv", "tv_l", "tv_b", "mkt", "mkt_l", "mkt_b"]:
        out[c] = out[c].round(0).astype("int64"); out[c + "_25"] = out[c + "_25"].round(0).astype("int64")
    out["eff"] = out.eff.round(3); out["eff_25"] = out.eff_25.round(3)
    out["n_props"] = out.n_props.astype(int); out["n_units"] = out.n_units.astype(int)
    keep = ["addr", "levy", "ac", "cat", "n_props", "n_units", "acres",
            "tax", "tax_l", "tax_b", "tv", "tv_l", "tv_b", "mkt", "mkt_l", "mkt_b", "mills", "eff",
            "tax_25", "tax_l_25", "tax_b_25", "tv_25", "tv_l_25", "tv_b_25", "mkt_25", "mkt_l_25", "mkt_b_25",
            "mills_25", "eff_25", "rep_lon", "rep_lat"]
    out = gpd.GeoDataFrame(out[keep + ["geometry"]], geometry="geometry", crs=parcels.crs)
    out.index.name = "pid"
    out = out.reset_index()
    out.to_parquet(D / "parcels.parquet", index=False)
    g4326 = out.to_crs(4326)
    g4326.drop(columns=["rep_lon", "rep_lat"]).to_file(D / "parcels.geojson", driver="GeoJSON",
                                                       engine="pyogrio", COORDINATE_PRECISION=6)
    print("parcel tax sums 2026:", round(out.tax.sum(), 2), " 2025:", round(out.tax_25.sum(), 2))

    # --- condo units per master --------------------------------------------------------------------------
    u = m[m.is_unit]
    piv = u.pivot_table(index=["pid", "property_id"], columns="tax_year",
                        values=["taxable_total", "tax_total"], aggfunc="sum").fillna(0)
    piv.columns = [f"{a}_{b}" for a, b in piv.columns]
    info = u.sort_values("tax_year", ascending=False).drop_duplicates("property_id").set_index("property_id")
    condos: dict[str, list] = {}
    for (pid_, prop_id), r in piv.iterrows():
        i = info.loc[prop_id]
        condos.setdefault(pid_, []).append([i.address, i.assessment_code, int(r.get("taxable_total_2026", 0)),
                                            round(float(r.get("tax_total_2026", 0)), 2),
                                            int(r.get("taxable_total_2025", 0)),
                                            round(float(r.get("tax_total_2025", 0)), 2)])
    for k in condos:
        condos[k].sort(key=lambda x: x[0])
    (D / "condos.json").write_text(json.dumps(condos, separators=(",", ":")))
    print("condo masters", len(condos), "units", sum(len(v) for v in condos.values()))


if __name__ == "__main__":
    main()
