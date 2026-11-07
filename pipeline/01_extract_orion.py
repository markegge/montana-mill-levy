"""Step 1: ORION bcp exports -> data/derived/properties.parquet (one row per RP property x tax year).

Values come straight from DOR's ORION Assessment rows (TaxableValue, TaxAmount, TotalMills); nothing is
re-derived here. Land vs. structure is split by class code: 1xxx/2xxx = land, 3xxx/6xxx = buildings
(6xxx = manufactured/mobile homes).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "data" / "derived"

PROP_COLS = ("PropertyID,TaxYear,GeoCode,AssessmentCode,LevyDistrict,PropType,PropCategory,PropSubCategory,"
             "LivUnits,Dwel_Val,Com_Val,TotImpt_Val,TotMarket_Val,Addr_Number,Addr_Street,Addr_City,Addr_Unit").split(",")
ASMT_COLS = ("AssessmentID,PropertyID,TaxYear,ClassCode,LandValue,BuildingValue,TotalValue,ExemptValue,"
             "TaxableMktValue,TaxablePct,TaxableValue,TIFIncVal,TotalMills,TaxAmount").split(",")

# Groups by class code. TY2025 used extra "tract/rural" codes (2101/3301 residential, 2107/3307 commercial,
# 2127/3327 multifamily) that TY2026 folded into 2201/3501 etc. Every 2xxx/3xxx/6xxx code not listed as
# multifamily/commercial/industrial is residential (incl. property-tax-assistance and DV reductions).
MF_CODES = {2227, 3527, 3127, 2127, 3327}
COMM_CODES = {2207, 3507, 2107, 3307, 2611, 3817, 3815, 3607, 2311, 3671, 3855, 3610}

# category codes used in the browser index
CAT = {"other": 0, "res_home": 1, "res_non": 2, "res": 3, "comm": 4, "mf": 5, "ag": 6}


def load():
    p = pd.read_csv(D / "property.csv", sep="|", header=None, names=PROP_COLS, dtype=str, keep_default_na=False)
    a = pd.read_csv(D / "assessment.csv", sep="|", header=None, names=ASMT_COLS, dtype=str, keep_default_na=False)
    cm = pd.read_csv(D / "condomaster.csv", sep="|", header=None, names=["PropertyID", "TaxYear", "CondoMasterId"], dtype=str)
    res = pd.read_csv(D / "res.csv", sep="|", header=None,
                      names=["ResID", "PropertyID", "TaxYear", "YearBuilt", "StoryHeight", "SFLA", "Bedrooms", "RCNLD"], dtype=str)
    for c in ["PropertyID", "TaxYear"]:
        p[c] = p[c].astype(int); a[c] = a[c].astype(int); cm[c] = cm[c].astype(int); res[c] = res[c].astype(int)
    cm["CondoMasterId"] = cm["CondoMasterId"].astype(int)
    num = ["ClassCode", "LandValue", "BuildingValue", "TotalValue", "ExemptValue", "TaxableMktValue", "TaxablePct",
           "TaxableValue", "TIFIncVal", "TaxAmount"]
    for c in num:
        a[c] = pd.to_numeric(a[c], errors="coerce").fillna(0.0)
    a["ClassCode"] = a["ClassCode"].astype(int)
    a["mills"] = pd.to_numeric(a["TotalMills"].str.strip(), errors="coerce")
    for c in ["LivUnits", "TotMarket_Val"]:
        p[c] = pd.to_numeric(p[c], errors="coerce").fillna(0)
    return p, a, cm, res


def main():
    p, a, cm, res = load()
    p = p[(p.PropCategory == "RP") & p.TaxYear.isin([2025, 2026])].copy()
    a = a[a.TaxYear.isin([2025, 2026])].merge(p[["PropertyID", "TaxYear"]], on=["PropertyID", "TaxYear"], how="inner")

    first = a.ClassCode // 1000
    a["is_land"] = first.isin([1, 2])
    a["is_bldg"] = first.isin([3, 6])
    unk = a[~(a.is_land | a.is_bldg)]
    assert len(unk) == 0, f"unclassified class codes: {unk.ClassCode.unique()}"
    a["market"] = a.TotalValue
    a["grp"] = np.select(
        [a.ClassCode.isin(MF_CODES), a.ClassCode.isin(COMM_CODES), first == 1],
        ["mf", "comm", "ag"], default="res")

    def s(mask, col):
        return a[col].where(mask, 0.0)

    a["mkt_land"] = s(a.is_land, "TotalValue"); a["mkt_bldg"] = s(a.is_bldg, "TotalValue")
    a["tv_land"] = s(a.is_land, "TaxableValue"); a["tv_bldg"] = s(a.is_bldg, "TaxableValue")
    a["tax_land"] = s(a.is_land, "TaxAmount"); a["tax_bldg"] = s(a.is_bldg, "TaxAmount")
    for g in ["res", "mf", "comm", "ag", "other"]:
        a[f"tv_{g}"] = s(a.grp == g, "TaxableValue")
    a["res_pct"] = a.TaxablePct.where((a.grp == "res") & (a.TaxableValue > 0))
    a["exempt"] = a.ExemptValue

    key = ["PropertyID", "TaxYear"]
    agg = a.groupby(key).agg(
        market_land=("mkt_land", "sum"), market_bldg=("mkt_bldg", "sum"),
        taxable_land=("tv_land", "sum"), taxable_bldg=("tv_bldg", "sum"), taxable_total=("TaxableValue", "sum"),
        tax_land=("tax_land", "sum"), tax_bldg=("tax_bldg", "sum"), tax_total=("TaxAmount", "sum"),
        tv_res=("tv_res", "sum"), tv_mf=("tv_mf", "sum"), tv_comm=("tv_comm", "sum"), tv_ag=("tv_ag", "sum"),
        tv_other=("tv_other", "sum"), res_pct_max=("res_pct", "max"), exempt_value=("exempt", "sum"),
        tif_inc=("TIFIncVal", "sum"), n_rows=("ClassCode", "size"),
        codes=("ClassCode", lambda x: ",".join(str(int(v)) for v in sorted(set(x)))),
    ).reset_index()
    # mills = mode of TotalMills over the property's rows
    m = a.dropna(subset=["mills"]).groupby(key)["mills"].agg(lambda x: x.mode().iloc[0]).rename("mills")
    agg = agg.merge(m, on=key, how="left")

    df = p.merge(agg, on=key, how="left")
    for c in ["market_land", "market_bldg", "taxable_land", "taxable_bldg", "taxable_total", "tax_land", "tax_bldg",
              "tax_total", "tv_res", "tv_mf", "tv_comm", "tv_ag", "tv_other", "exempt_value", "tif_inc", "n_rows"]:
        df[c] = df[c].fillna(0.0)
    df["market_total"] = df.market_land + df.market_bldg
    df["geocode17"] = df.GeoCode.str.replace("-", "", regex=False).str.strip()
    df["assessment_code"] = df.AssessmentCode.str.strip().str.lstrip("0")
    df["levy_district"] = df.LevyDistrict.str.strip()
    df["levy_base"] = df.levy_district.str[:9]
    df["subcat"] = df.PropSubCategory.str.strip()

    # category: argmax of taxable by group
    grp = df[["tv_res", "tv_mf", "tv_comm", "tv_ag", "tv_other"]]
    top = grp.idxmax(axis=1).str[3:]
    top = top.where(grp.max(axis=1) > 0, "other")
    df["is_residential"] = top == "res"
    df["is_commercial"] = top.isin(["comm", "mf"])
    df["is_exempt"] = (df.taxable_total == 0) | (df.subcat == "GOV")
    # Homestead (TY2026 only): residential rows all taxed below the 1.9% non-homestead flat rate.
    df["is_homestead"] = df.is_residential & (df.TaxYear == 2026) & (df.res_pct_max < 1.5)
    cat = np.where(top == "res",
                   np.where(df.TaxYear == 2026, np.where(df.is_homestead, "res_home", "res_non"), "res"), top)
    cat = np.where(df.taxable_total == 0, "other", cat)
    df["cat"] = pd.Series(cat, index=df.index).map(CAT).astype(int)

    rc = res.groupby(key).size().rename("n_dwellings")
    df = df.merge(rc, on=key, how="left"); df["n_dwellings"] = df.n_dwellings.fillna(0).astype(int)
    df = df.merge(cm.rename(columns={"CondoMasterId": "condo_master_id"}), on=key, how="left")
    df["liv_units"] = df.LivUnits.astype(int)

    def addr(r):
        parts = [r.Addr_Number.strip(), r.Addr_Street.strip()]
        s_ = " ".join(x for x in parts if x)
        if r.Addr_Unit.strip():
            s_ += f" #{r.Addr_Unit.strip()}"
        if r.Addr_City.strip():
            s_ += f", {r.Addr_City.strip().title()}"
        return s_
    df["address"] = [addr(r) for r in df.itertuples()]

    keep = ["PropertyID", "TaxYear", "geocode17", "assessment_code", "levy_district", "levy_base", "subcat", "PropType",
            "cat", "is_residential", "is_commercial", "is_homestead", "is_exempt", "market_land", "market_bldg",
            "market_total", "taxable_land", "taxable_bldg", "taxable_total", "tax_land", "tax_bldg", "tax_total",
            "mills", "tif_inc", "exempt_value", "n_dwellings", "liv_units", "condo_master_id", "address", "codes",
            "res_pct_max"]
    out = df[keep].rename(columns={"PropertyID": "property_id", "TaxYear": "tax_year", "PropType": "prop_type"})
    out.to_parquet(D / "properties.parquet", index=False)

    summ = {}
    for y in (2025, 2026):
        o = out[out.tax_year == y]
        summ[y] = {"properties": int(len(o)), "taxable_total": float(o.taxable_total.sum()),
                   "tax_total": round(float(o.tax_total.sum()), 2), "market_total": float(o.market_total.sum()),
                   "condo_units": int(o.condo_master_id.notna().sum()),
                   "by_cat": {k: int((o.cat == v).sum()) for k, v in CAT.items()}}
    (D / "orion_summary.json").write_text(json.dumps(summ, indent=1))
    print(json.dumps(summ, indent=1))


if __name__ == "__main__":
    main()
