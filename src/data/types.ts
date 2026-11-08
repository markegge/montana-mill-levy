import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'

export type Year = '2026' | '2025'

export interface CountyMeta {
  name: string
  dor_code: string
  /** districts.json id of the whole-county boundary */
  district_id: string
  index: string
  bbox: [number, number, number, number]
  juris: { county: string; cities: string[] }
  /** Tax statement URL template with {ac} and {year} */
  bill_url: string
  mills_source?: string
  /** Situs address file for search */
  addresses?: string
}

export interface Meta {
  generated: string
  vintages: Record<string, string>
  /** Keyed by county slug ('gallatin', 'yellowstone'). */
  counties: Record<string, CountyMeta>
  ramps: { tax: number[]; tax_b: number[]; tax_l: number[]; eff: number[] }
  attribution: string
  /** DOR certified values by jurisdiction code (CNTYWID, BOZEMAN, COWDLVY, BLGS, …); non-real property is not mappable. */
  non_real?: Partial<Record<Year, Record<string, { total: number; real: number; tif_increment: number; non_real_ratio: number }>>>
}

export type GroupName = 'State' | 'County' | 'City' | 'Elementary' | 'High school' | 'Fire' | 'Other'
export const GROUPS: GroupName[] = ['State', 'County', 'City', 'Elementary', 'High school', 'Fire', 'Other']

export interface LevyYear {
  total: number
  estimated: boolean
  groups: Partial<Record<GroupName, number>>
  lines: { group: string; name: string; mills: number }[]
}

export interface Levies {
  codes: string[]
  districts: Record<string, { base: string; name: string; city_rural: 'City' | 'Rural'; county?: string; tif_ratio?: Partial<Record<Year, number>> }>
  years: Record<Year, Record<string, LevyYear>>
}

export type DistrictProps = { id: string; name: string; type: string; county?: string; source?: string }
export type DistrictFeature = Feature<Polygon | MultiPolygon, DistrictProps>
export type Districts = FeatureCollection<Polygon | MultiPolygon, DistrictProps>

export interface DistrictYearStats {
  taxable: number
  mill_value: number
  n_props: number
  n_parcels?: number
  tif_increment_est?: number
  mill_value_net_tif?: number
  n_res: number
  hh: number
  median_res_taxable: number
}
export type DistrictStats = Record<string, { name: string; type: string; county?: string } & Partial<Record<Year, DistrictYearStats>>>

/** One row per ORION property, unpacked into columns for fast scans. */
export interface PropIndex {
  /** County slugs whose rows this index holds, in row order. */
  counties: string[]
  n: number
  pid: (string | null)[]
  lon: Float64Array // NaN when the property has no polygon
  lat: Float64Array
  levy: Int32Array
  tv: Record<Year, Float64Array>
  tax: Record<Year, Float64Array>
  cat: Record<Year, Int8Array>
  hh: Float32Array
}

/** Situs address list for search: rows are [addr, cityIdx, parcelIdx] or [addr, cityIdx, unit, parcelIdx]. */
export interface AddressFile {
  cities: string[]
  parcels: [pid: string, lon: number, lat: number][]
  rows: ([string, number, number] | [string, number, string, number])[]
}

export type CondoUnit = [addr: string, ac: string, tv26: number, tax26: number, tv25: number, tax25: number]
export type Condos = Record<string, CondoUnit[]>

export interface Validation {
  checks: { id: string; county?: string; name: string; expected: unknown; actual: unknown; status: string; detail?: string }[]
}

/** Property categories used by parcels_index cat26/cat25 and the tile `cat`. */
export const CAT = {
  OTHER: 0,
  HOMESTEAD: 1,
  NONHOMESTEAD: 2,
  RESIDENTIAL: 3,
  COMMERCIAL: 4,
  MULTIFAMILY: 5,
  AG: 6,
} as const

export const CAT_LABEL: Record<number, string> = {
  0: 'Other / exempt',
  1: 'Homestead residential',
  2: 'Non-homestead residential',
  3: 'Residential',
  4: 'Commercial / industrial',
  5: 'Multifamily',
  6: 'Agricultural',
}

export const isResidential = (c: number) => c === 1 || c === 2 || c === 3

/** Parcel feature properties from parcels.pmtiles. */
export type ParcelProps = Record<string, string | number | undefined> & {
  pid: string
  addr?: string
  levy?: string
  ac?: string
  cat?: number
  n_props?: number
  n_units?: number
  acres?: number
}
