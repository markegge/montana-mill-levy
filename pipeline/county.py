"""Per-county configuration shared by every pipeline step.

Usage in a step:  C = county_from_argv()  ->  C.raw / C.derived paths and county-specific settings.
Run a step for one county with `--county gallatin` (default) or `--county yellowstone`.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class County:
    slug: str
    name: str                 # "Gallatin"
    dor_code: str             # ORION / geocode county prefix, e.g. "06"
    portal_code: str          # DOR certified-values portal county code, e.g. "206"
    db_name: str              # SQL Server database name the MDF is attached as
    orion_zip: str            # file under data/raw/<slug>/orion/
    gdb_zip: str              # file under data/raw/<slug>/cadastral/
    gdb_name: str             # unzipped FGDB directory name
    bbox: tuple[float, float, float, float]   # W,S,E,N for Overture + boundary queries
    mills_source: str         # "itax_tyler" (per-property Treasurer statements) | see 02_levies.py
    itax_host: str = ""
    city_juris: dict[str, tuple[str, ...]] = field(default_factory=dict)  # portal TJ code -> levy-code prefixes
    id_prefix: str = ""       # prefix for district ids (keeps ids unique across counties)

    @property
    def raw(self) -> Path:
        p = ROOT / "data" / "raw" / self.slug
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def derived(self) -> Path:
        p = ROOT / "data" / "derived" / self.slug
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def gdb(self) -> Path:
        return self.raw / "cadastral" / self.gdb_name

    @property
    def certified_values(self) -> Path:
        return ROOT / "data" / "reference" / ("certified_values.json" if self.slug == "gallatin"
                                              else f"certified_values_{self.slug}.json")


COUNTIES: dict[str, County] = {
    "gallatin": County(
        slug="gallatin", name="Gallatin", dor_code="06", portal_code="206", db_name="Gallatin",
        orion_zip="COUNTY6_Gallatin_ORION_2026-11-06.zip", gdb_zip="Gallatin_GDB.zip",
        gdb_name="Gallatin_Parcels.gdb", bbox=(-112.10, 44.35, -110.20, 46.20),
        mills_source="itax_tyler", itax_host="https://itax.gallatin.mt.gov",
        city_juris={"BOZEMAN": ("06-0350", "06-1350"), "BELGRAD": ("06-0368",)},
    ),
    "yellowstone": County(
        slug="yellowstone", name="Yellowstone", dor_code="03", portal_code="203", db_name="Yellowstone",
        orion_zip="COUNTY3.ZIP", gdb_zip="Yellowstone_GDB.zip", gdb_name="Yellowstone_Parcels.gdb",
        bbox=(-109.10, 45.40, -107.40, 46.50), mills_source="yellowstone",
        city_juris={},  # filled in once the levy-code prefixes are known (see 08_validate.py)
        id_prefix="ys-",
    ),
}
ORDER = ["gallatin", "yellowstone"]


def county_from_argv(argv=None) -> County:
    ap = argparse.ArgumentParser()
    ap.add_argument("--county", default="gallatin", choices=sorted(COUNTIES))
    a, _ = ap.parse_known_args(argv)
    return COUNTIES[a.county]
