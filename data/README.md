data/
  raw/        downloaded source files (gitignored; see PLAN.md §2 for URLs and dates)
  derived/    pipeline outputs (gitignored). property.csv / assessment.csv / condomaster.csv are bcp exports
              from the ORION Gallatin DB (TaxYear 2025+2026), pipe-delimited, no header; column order in PLAN.md §6.
  reference/  small docs the plan cites: 2025 mill levy book (PDF + text), sample tax bills, HB231/SB542 summary,
              GVUTD boundary (legal description + MSL polygon), ORION docs, probe scripts used while planning.

private/  (gitignored) sample Gallatin County tax statements used for validation. They name the property owner, so
          they are not published. Fetch any statement from https://itax.gallatin.mt.gov/PDF/{year}/RE/{AssessmentCode}.pdf
          (e.g. RGF65523, RFG16430, RGH9979). pipeline/02_levies.py caches the per-district statements in data/raw/itax/.
