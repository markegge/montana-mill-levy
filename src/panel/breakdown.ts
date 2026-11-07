import { GROUPS, type GroupName, type Levies, type ParcelProps, type Year } from '../data/types'
import { yf } from '../map/style'

export const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export interface GroupRow { group: GroupName; mills: number; land: number; structure: number; total: number }
export interface LineRow { group: string; name: string; mills: number; amount: number }

export interface Breakdown {
  tax: number
  taxLand: number
  taxBldg: number
  levyTotal: number | null
  estimated: boolean
  groups: GroupRow[] | null
  lines: LineRow[] | null
  /** tax − Σ line amounts (line mills don't always sum exactly to the certified total). */
  residual: number
}

export function computeBreakdown(p: ParcelProps, year: Year, levies: Levies): Breakdown {
  const tax = num(p[yf('tax', year)])
  const taxLand = num(p[yf('tax_l', year)])
  const taxBldg = num(p[yf('tax_b', year)])
  const levy = (p.levy as string | undefined) ?? ''
  const lv = levy ? levies.years[year]?.[levy.slice(0, 9)] : undefined
  if (!lv || !(lv.total > 0)) {
    return { tax, taxLand, taxBldg, levyTotal: null, estimated: false, groups: null, lines: null, residual: 0 }
  }
  // Scale by Σ line mills, not the district total: a few properties (mobile homes on others' land) are billed on
  // prior-year mills, so the parcel's tax is the anchor and the lines always sum to it.
  const lineMills = lv.lines.reduce((s, l) => s + l.mills, 0)
  const groupMills = GROUPS.reduce((s, g) => s + (lv.groups[g] ?? 0), 0)
  const share = (m: number) => m / (lineMills > 0 ? lineMills : lv.total)
  const gShare = (m: number) => m / (groupMills > 0 ? groupMills : lv.total)
  const groups = GROUPS.map((g) => {
    const m = lv.groups[g] ?? 0
    return { group: g, mills: m, land: taxLand * gShare(m), structure: taxBldg * gShare(m), total: tax * gShare(m) }
  }).filter((g) => g.mills > 0)
  const order = (g: string) => {
    const i = GROUPS.indexOf(g as GroupName)
    return i < 0 ? GROUPS.length : i
  }
  const lines = lv.lines
    .map((l) => ({ ...l, amount: tax * share(l.mills) }))
    .sort((a, b) => order(a.group) - order(b.group) || b.amount - a.amount)
  const sum = lines.reduce((s, l) => s + l.amount, 0)
  roundToCents(lines, sum)
  const residual = (Math.round(tax * 100) - Math.round(sum * 100)) / 100
  return { tax, taxLand, taxBldg, levyTotal: lv.total, estimated: lv.estimated, groups, lines, residual }
}

export function formatGeocode(pid: string) {
  if (!/^\d{17}$/.test(pid)) return pid
  return [pid.slice(0, 2), pid.slice(2, 6), pid.slice(6, 8), pid.slice(8, 9), pid.slice(9, 11), pid.slice(11, 13), pid.slice(13)].join('-')
}

export const LAND_COLOR = '#c9a46a'
export const STRUCT_COLOR = '#8a2f3c'

/** Round line amounts to cents so the displayed cents add up exactly (largest remainder). */
function roundToCents(lines: LineRow[], exactSum: number) {
  const target = Math.round(exactSum * 100)
  const cents = lines.map((l) => Math.floor(l.amount * 100))
  let short = target - cents.reduce((s, c) => s + c, 0)
  const order = lines.map((l, i) => ({ i, rem: l.amount * 100 - cents[i] })).sort((a, b) => b.rem - a.rem)
  for (const { i } of order) {
    if (short <= 0) break
    cents[i]++
    short--
  }
  lines.forEach((l, i) => { l.amount = cents[i] / 100 })
}
