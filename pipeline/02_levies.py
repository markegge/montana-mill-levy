"""Step 2: per-levy-district mill tables for TY2026 and TY2025 -> data/derived/levies.json

Method (PLAN §6 step 3, refined): for every levy district, pick the highest-taxable non-mobile-home property whose
ORION TotalMills equals the district's modal mills in both years, download the Gallatin County Treasurer's
TY2026 "Tax Comparison" PDF for it (itax.gallatin.mt.gov), and parse its TAX LEVIES line items. The PDF
carries both 2026 and 2025 amounts per line, so  mills_i = amount_i / ORION taxable_value × 1000  for each year.
Using a high-taxable property makes the cent-rounding error in mills negligible (< 0.001 mills at $100k
taxable). The 2025 county mill-levy book is used only as a cross-check of TY2025 totals.
"""
from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
from county import county_from_argv

C = county_from_argv()
D = C.derived
REF = ROOT / "data" / "reference"
CACHE = C.raw / "itax"
CACHE.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) mill-levy research"}

GROUPS = ["State", "County", "City", "Elementary", "High school", "Fire", "Other"]


def fetch_pdf(ac: str) -> Path | None:
    out = CACHE / f"2026_{ac}.pdf"
    if out.exists() and out.stat().st_size > 1000:
        return out
    url = f"{C.itax_host}/PDF/2026/RE/{ac}.pdf"
    for attempt in range(3):
        try:
            r = requests.get(url, headers=UA, timeout=60)
            if r.status_code == 200 and r.content[:4] == b"%PDF":
                out.write_bytes(r.content)
                time.sleep(0.5)
                return out
        except requests.RequestException:
            pass
        time.sleep(2)
    return None


AMT = re.compile(r"\$([\d,]+\.\d\d)")


def parse_pdf(path: Path) -> dict:
    txt = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True, check=True).stdout
    lines = txt.splitlines()
    res: dict = {"lines": [], "mills26": None, "mills25": None, "gen26": None, "gen25": None, "district_name": None}
    sec = None
    header = None
    for i, raw in enumerate(lines):
        s = raw.strip()
        if not s:
            continue
        if s.startswith("General Taxes"):
            sec = "gen"; continue
        if s.startswith("Special District"):
            sec = "spec"; continue
        if s.startswith("MILL LEVIES"):
            nums = re.findall(r"(?<![\d.])(\d+\.\d{3})(?![\d.])", s)
            if nums:
                res["mills26"] = float(nums[0]); res["mills25"] = float(nums[-1]) if len(nums) > 1 else None
            sec = None; continue
        if s.startswith("TAX LEVIES"):
            sec = "levies"; continue
        if s.startswith("Totals") and sec == "levies":
            sec = None; continue
        if sec == "gen" and res["gen26"] is None:
            amts = AMT.findall(s)
            if amts:
                name = re.split(r"\s{2,}", s)[0]
                res["district_name"] = name
                res["gen26"] = float(amts[0].replace(",", ""))
                res["gen25"] = float(amts[1].replace(",", "")) if len(amts) > 1 else None
                if "Added" in s:
                    res["gen25"] = None
            continue
        if sec != "levies":
            continue
        if any(k in s for k in ("Tyler Technologies", "Page:", "GALLATIN COUNTY", "Tax Year:", "TAX COMPARISON",
                                "Item ", "Date:", "Time:")):
            continue
        amts = AMT.findall(s)
        if not amts and "Removed" not in s:
            # a group header ("County", "Fire District", "School", ...)
            if re.fullmatch(r"[A-Za-z/ &.-]+", s):
                header = s
            continue
        if "Subtotal" in s:
            continue
        name = re.split(r"\s{2,}", s)[0].lstrip("* ").strip()
        vals = [float(a.replace(",", "")) for a in amts]
        if "Removed" in s:
            a26, a25 = 0.0, (vals[0] if vals else 0.0)
        elif "Added" in s:
            a26, a25 = (vals[0] if vals else 0.0), 0.0
        elif len(vals) >= 2:
            a26, a25 = vals[0], vals[1]
        else:
            # one amount and a % change: it is the 2026 amount when it precedes the change column
            a26, a25 = vals[0], 0.0
        res["lines"].append({"header": header, "name": name, "a26": a26, "a25": a25})
    return res


CITY_PREFIX = re.compile(r"^(bzn|bozeman|belgrade|manhattan|tf |three forks|town of|city of|west yellowstone|wy |billings-|laurel|broadview)")


def group_of(header: str | None, name: str) -> str:
    h = (header or "").lower(); n = name.lower()
    if h in ("state school", "university", "state"):
        return "State"
    if h in ("county", "public safety"):
        return "County"
    if h == "city" or (h not in ("school",) and CITY_PREFIX.match(n)):
        return "City"
    if h.startswith("fire") or (h not in ("school", "city/rural") and "fire" in n):
        return "Fire"
    if h == "school":
        # countywide school levies (retirement, transportation, base funding) are grouped with the county
        if n.startswith("countywide") or not re.match(r"\*{0,2}\s*sd\b", n):
            return "County"
        if re.search(r"\bhs\b|high", n):
            return "High school"
        return "Elementary"
    if "cemetery" in n or "mosquito" in n:
        return "Other"
    if CITY_PREFIX.match(n):
        return "City"
    if n.startswith("count") or n in ("library fund", "parks"):
        return "County"   # countywide planning, county road & bridge, library (rural) etc.
    if "fire" in n:
        return "Fire"
    return "Other"


# --- Yellowstone County Treasurer (yellowstonecountymt.gov) -------------------------------------------------
YS = "https://www.yellowstonecountymt.gov/treasurer/PropertySearch"


def ys_fetch(property_id: int) -> Path | None:
    """Treasurer property page (csaprop.asp, keyed by the ORION PropertyID); cached. It carries the levy
    district's total mills and an itemized mill-levy table for the last four tax years."""
    out = C.raw / "treasurer" / f"{property_id}.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists() and out.stat().st_size > 5000:
        return out
    for attempt in range(3):
        try:
            r = requests.get(f"{YS}/csaprop.asp?propid={property_id}", headers=UA, timeout=60)
            if r.status_code == 200 and "Itemized" in r.text:
                out.write_text(r.text)
                time.sleep(0.4)
                return out
            if r.status_code == 200:
                return None
        except requests.RequestException:
            pass
        time.sleep(2)
    return None


def ys_parse(path: Path) -> dict:
    from bs4 import BeautifulSoup
    b = BeautifulSoup(path.read_text(errors="ignore"), "html.parser")
    res: dict = {"lines": [], "mills26": None, "mills25": None, "district_name": None}
    m = re.search(r"Levy District:\s*([^\n(]+?)\s*\((\d+\.\d+)\s*Mills\)", b.get_text(" "))
    if m:
        res["district_name"] = re.sub(r"\s+", " ", m.group(1)).strip()
        res["mills26"] = float(m.group(2))
    title = b.find(string=lambda t: t and "Mill Levies Itemized" in t)
    if not title:
        return res
    tbl = title.find_parent("table")
    while tbl is not None and len(tbl.find_all("tr", recursive=False)) < 5:
        tbl = tbl.find_parent("table")
    years: list[str] = []
    section = None
    seen: set = set()
    for tr in tbl.find_all("tr", recursive=False):
        cells = tr.find_all(["td", "th"], recursive=False)
        txt = [c.get_text(" ", strip=True) for c in cells]
        if len(cells) == 1:
            t = txt[0].strip()
            if t and t.isupper() and len(t) < 30 and "ITEMIZED" not in t.upper():
                section = t.title()
            continue
        if txt and txt[0].startswith("Mill Levy Description"):
            years = txt[2:]
            continue
        if not years or len(cells) < 3 or not txt[0]:
            continue
        vals = {}
        for y, c in zip(years, txt[2:]):
            mm = re.search(r"\$([\d,]+\.\d\d)\s+(\d+\.\d+)", c)
            if mm:
                vals[y] = float(mm.group(2))
        key = (section, txt[0])
        if "Total" in txt[0] or key in seen:
            continue
        seen.add(key)
        res["lines"].append({"header": section, "name": txt[0].lstrip("* ").strip(),
                             "a26": vals.get("2026", 0.0), "a25": vals.get("2025", 0.0)})
    s25 = sum(l["a25"] for l in res["lines"])
    res["mills25"] = round(s25, 3) if s25 > 0 else None
    return res


def fetch_parse(ac: str, property_id: int):
    if C.mills_source == "itax_tyler":
        pdf = fetch_pdf(ac)
        return parse_pdf(pdf) if pdf else None
    page = ys_fetch(property_id)
    return ys_parse(page) if page else None


def book_totals_2025() -> dict[str, float]:
    lines = (REF / "gallatin_2025_mill_levy.txt").read_text().splitlines()
    start = next(i for i, l in enumerate(lines) if "CONSOLIDATED Levy Districts" in l)
    pat = re.compile(r"^(0\d-[0-9A-Z]{4,8})\**\s+(.*?)\s+(City|Rural)\s+(.*)$")
    out = {}
    for l in lines[start:]:
        m = pat.match(l.strip())
        if not m:
            continue
        nums = re.findall(r"(?<![\w-])\d+\.\d+(?![\w-])", m.group(4))
        if nums:
            out[m.group(1)] = float(nums[-1])
    return out


def main():
    props = pd.read_parquet(D / "properties.parquet")
    p26 = props[props.tax_year == 2026].set_index("property_id")
    p25 = props[props.tax_year == 2025].set_index("property_id")
    mode = {}
    for y, o in ((2026, p26), (2025, p25)):
        o = o[(o.taxable_total > 0) & o.mills.notna() & ~o.subcat.isin(["MH"])]
        mode[y] = o.groupby("levy_district").mills.agg(lambda x: x.mode().iloc[0]).to_dict()

    # district names / city-rural from the cadastral-style code + the 2025 book where available
    book = book_totals_2025() if C.slug == "gallatin" else {}

    codes = sorted(props.levy_district.dropna().unique())
    results = {"2026": {}, "2025": {}}
    meta = {}
    picks = []
    for code in codes:
        base = code
        c = p26[(p26.levy_district == code) & (p26.taxable_total > 0) & ~p26.subcat.isin(["MH", "C_MSTR"])
                & (p26.assessment_code.str.len() > 0)].copy()
        c["m25"] = p25.mills.reindex(c.index)
        c["tv25"] = p25.taxable_total.reindex(c.index)
        ok = c[(c.mills == mode[2026].get(code)) & ((c.m25 == mode[2025].get(code)) | (mode[2025].get(code) is None))
               & (c.tv25.fillna(0) > 0)]
        if ok.empty:
            ok = c[c.mills == mode[2026].get(code)]
        if ok.empty:
            print("no candidate", code); continue
        ok = ok.sort_values("taxable_total", ascending=False)
        # Prefer a sample whose billed total matches ORION's modal mills (a property can sit in a different
        # Treasurer district than its ORION levy code says); otherwise keep the first parsable one.
        parsed = None; first = None
        for pid_, r in ok.head(4).iterrows():
            pr = fetch_parse(r.assessment_code, int(pid_))
            if not (pr and pr["mills26"] and pr["lines"]):
                continue
            first = first or (pid_, r, pr)
            if abs(pr["mills26"] - (mode[2026].get(code) or -1)) < 0.02:
                parsed = (pid_, r, pr); break
        parsed = parsed or first
        if not parsed:
            print("fetch/parse failed", code); continue
        pid_, r, pr = parsed
        tv26 = float(r.taxable_total); tv25 = float(r.tv25) if pd.notna(r.tv25) else None
        name = pr["district_name"] or code
        meta[code] = {"base": base, "name": name, "city_rural": None,
                      "sample_ac": r.assessment_code, "sample_tv26": tv26, "sample_tv25": tv25}
        for y, tv, key, mk in (("2026", tv26, "a26", "mills26"), ("2025", tv25, "a25", "mills25")):
            if not tv:
                continue
            bill_total = pr[mk]
            if C.slug == "yellowstone" and y == "2025" and mode[2025].get(code):
                # The Treasurer page states only the current year's district total; its TY2025 column belongs to the
                # sample parcel's TY2025 district, which can differ. Scale TY2025 lines to ORION's modal mills.
                bill_total = mode[2025][code]
            amt_sum = sum(ln[key] for ln in pr["lines"] if ln[key] > 0)
            if not bill_total or amt_sum <= 0:
                continue
            lines = []
            for ln in pr["lines"]:
                amt = ln[key]
                if amt <= 0:
                    continue
                # Normalize by the line-amount sum so lines add to the billed total mills exactly. Equivalent to
                # amount/taxable*1000 for ordinary parcels, and also correct for TIF parcels (whose line items
                # cover only the base-value share) and multi-property assessment codes.
                lines.append({"group": group_of(ln["header"], ln["name"]), "header": ln["header"], "name": ln["name"],
                              "mills": round(amt / amt_sum * bill_total, 4), "sample_amount": amt,
                              "raw_mills": round(amt / tv * 1000, 4) if tv else None})
            tot_lines = round(sum(l["mills"] for l in lines), 4)
            raw_sum = round(sum(l["raw_mills"] or 0 for l in lines), 3)
            groups = {g: round(sum(l["mills"] for l in lines if l["group"] == g), 4) for g in GROUPS}
            gen = pr.get("gen26" if y == "2026" else "gen25")
            results[y][base if base not in results[y] else code] = {
                "code": code, "total": bill_total, "lines_sum": tot_lines,
                "orion_mode": mode[int(y)].get(code), "estimated": False,
                "groups": groups,
                "lines": [{k: l[k] for k in ("group", "name", "mills")} for l in sorted(lines, key=lambda l: (GROUPS.index(l["group"]), -l["mills"]))],
                "sample_general_tax": gen, "raw_lines_mills": raw_sum, "sample_tv": tv,
                "sample_lines_amount": round(sum(l["sample_amount"] for l in lines), 2),
            }
        picks.append({"code": code, "ac": r.assessment_code, "tv26": tv26, "mills26": pr["mills26"],
                      "mills25": pr["mills25"], "lines": len(pr["lines"])})

    # Fallback: districts with no usable bill (no taxable non-MH property, or fetch failed) borrow the lines of a
    # parsed district with the same ORION modal mills; flagged estimated.
    for y in ("2026", "2025"):
        by_total = {}
        for b, v in results[y].items():
            by_total.setdefault(round(v["total"], 2), v)
        for code in codes:
            base = code
            if base in results[y]:
                continue
            o = (p26 if y == "2026" else p25)
            mm = o[o.levy_district == code].mills.dropna()
            if mm.empty:
                continue
            tot = round(float(mm.mode().iloc[0]), 2)
            src = by_total.get(tot)
            if src:
                results[y][base] = {**src, "code": code, "estimated": True, "borrowed_from": src["code"]}
            else:
                results[y][base] = {"code": code, "total": tot, "lines_sum": None, "orion_mode": tot,
                                    "estimated": True, "groups": None, "lines": []}
            meta.setdefault(code, {"base": base, "name": code, "city_rural": None})

    # city/rural: a district is "City" if it has City-group mills
    for code, m in meta.items():
        y = results["2026"].get(m["base"]) or results["2025"].get(m["base"]) or {}
        m["city_rural"] = "City" if ((y.get("groups") or {}).get("City", 0) > 0) else "Rural"
        m["book_total_2025"] = book.get(code[:9]) or book.get(code[:9].rstrip("0"))

    out = {"codes": codes, "districts": meta, "years": results,
           "method": "Line-item mills derived from Gallatin County Treasurer TY2026 tax comparison PDFs "
                     "(amount / ORION taxable value x 1000) for one representative property per levy district."}
    (D / "levies.json").write_text(json.dumps(out, indent=1))
    pd.DataFrame(picks).to_csv(D / "levy_samples.csv", index=False)
    print("districts", len(codes), "parsed", len(meta))
    hdrs = {}
    for y in results.values():
        for v in y.values():
            for l in v["lines"]:
                hdrs.setdefault(l["group"], set()).add(l["name"])
    for g, n in hdrs.items():
        print(g, len(n))


if __name__ == "__main__":
    main()
