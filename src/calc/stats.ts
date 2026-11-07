import { CAT, isResidential, type Condos, type Levies, type PropIndex, type Year } from '../data/types'

/** TY2025 and TY2026 both tax the first $378,000 of a homestead at 0.76% (TY2025's first tier ran to $400,000). */
export const EXAMPLE_HOME_MARKET = 378_000
export const EXAMPLE_HOME_TAXABLE = EXAMPLE_HOME_MARKET * 0.0076

export interface BaseStats {
  year: Year
  /** Properties / parcels with taxable value in this tax year (matches district_stats). */
  nProps: number
  nParcels: number
  nUnmapped: number
  condoUnits: number | null // null until condos.json has loaded
  households: number
  taxable: number
  millValue: number
  /** Estimated TIF increment in the selection (Σ taxable × the levy district's TIF increment share). */
  tifIncrement: number
  byCat: { homestead: number; nonhomestead: number; residential: number; commercial: number; multifamily: number; ag: number; other: number }
  cityTaxable: number
  ruralTaxable: number
  /** Taxable values of residential properties with taxable value > 0, sorted ascending. */
  resTaxable: Float64Array
  /** Per-parcel taxable value (pid → Σ tv) for the map choropleth. */
  parcelTaxable: Map<string, number>
}

export function computeBase(idx: PropIndex, levies: Levies, rows: Int32Array, year: Year, condos: Condos | null): BaseStats {
  const tv = idx.tv[year]
  const cat = idx.cat[year]
  const byCat = { homestead: 0, nonhomestead: 0, residential: 0, commercial: 0, multifamily: 0, ag: 0, other: 0 }
  const parcelTaxable = new Map<string, number>()
  const res: number[] = []
  const cityByLevy = levies.codes.map((code) => levies.districts[code]?.city_rural === 'City')
  const tifByLevy = levies.codes.map((code) => levies.districts[code]?.tif_ratio?.[year] ?? 0)
  let tif = 0
  let taxable = 0
  let households = 0
  let unmapped = 0
  let city = 0
  let nTaxable = 0
  const taxedParcels = new Set<string>()
  for (let k = 0; k < rows.length; k++) {
    const i = rows[k]
    const v = tv[i]
    taxable += v
    if (v > 0) nTaxable++
    households += idx.hh[i]
    const c = cat[i]
    switch (c) {
      case CAT.HOMESTEAD: byCat.homestead += v; break
      case CAT.NONHOMESTEAD: byCat.nonhomestead += v; break
      case CAT.RESIDENTIAL: byCat.residential += v; break
      case CAT.COMMERCIAL: byCat.commercial += v; break
      case CAT.MULTIFAMILY: byCat.multifamily += v; break
      case CAT.AG: byCat.ag += v; break
      default: byCat.other += v
    }
    if (isResidential(c) && v > 0) res.push(v)
    const L = idx.levy[i]
    if (L >= 0 && cityByLevy[L]) city += v
    if (L >= 0) tif += v * tifByLevy[L]
    const pid = idx.pid[i]
    if (pid == null || Number.isNaN(idx.lon[i])) {
      if (v > 0) unmapped++
    } else {
      parcelTaxable.set(pid, (parcelTaxable.get(pid) ?? 0) + v)
      if (v > 0) taxedParcels.add(pid)
    }
  }
  let condoUnits: number | null = null
  if (condos) {
    condoUnits = 0
    for (const pid of parcelTaxable.keys()) condoUnits += condos[pid]?.length ?? 0
  }
  const resTaxable = Float64Array.from(res).sort()
  return {
    year,
    nProps: nTaxable,
    nParcels: taxedParcels.size,
    nUnmapped: unmapped,
    condoUnits,
    households,
    taxable,
    millValue: taxable / 1000,
    tifIncrement: tif,
    byCat,
    cityTaxable: city,
    ruralTaxable: taxable - city,
    resTaxable,
    parcelTaxable,
  }
}

export function quantile(sorted: Float64Array, q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export interface ResDistribution {
  n: number
  p25: number
  median: number
  p75: number
  p90: number
  mean: number
  max: number
  bins: { x0: number; x1: number; count: number }[]
}

/** Distribution of taxable value across residential properties; scale by mills/1000 for dollars. */
export function residentialDistribution(sorted: Float64Array, nBins = 20): ResDistribution {
  const n = sorted.length
  let sum = 0
  for (let i = 0; i < n; i++) sum += sorted[i]
  // Clip the histogram at P99 so a few mansions don't flatten everything into one bar.
  const hiEdge = n ? quantile(sorted, 0.99) : 0
  const width = hiEdge > 0 ? hiEdge / nBins : 1
  const bins = Array.from({ length: nBins }, (_, b) => ({ x0: b * width, x1: (b + 1) * width, count: 0 }))
  for (let i = 0; i < n; i++) bins[Math.min(nBins - 1, Math.floor(sorted[i] / width))].count++
  return {
    n,
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    mean: n ? sum / n : NaN,
    max: n ? sorted[n - 1] : NaN,
    bins,
  }
}

/** Six quantile breaks (→ 7 classes) over parcel taxable values, for the added-burden choropleth. */
export function taxableBreaks(parcelTaxable: Map<string, number>): number[] {
  const vals = Float64Array.from([...parcelTaxable.values()].filter((v) => v > 0)).sort()
  if (!vals.length) return [1, 2, 3, 4, 5, 6]
  const qs = [1 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7].map((q) => quantile(vals, q))
  // Breaks must be strictly increasing for a MapLibre step expression.
  for (let i = 1; i < qs.length; i++) if (qs[i] <= qs[i - 1]) qs[i] = qs[i - 1] + 1e-6
  return qs
}
