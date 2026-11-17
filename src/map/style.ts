import type { ExpressionSpecification } from 'maplibre-gl'
import type { Meta, Year } from '../data/types'

export type ColorMode = 'tax' | 'tax_b' | 'tax_l' | 'eff' | 'added'

export const COLOR_MODES: { id: ColorMode; label: string; short: string }[] = [
  { id: 'tax', label: 'Total property tax', short: 'Total tax' },
  { id: 'tax_b', label: 'Tax on structures', short: 'Structure tax' },
  { id: 'tax_l', label: 'Tax on land', short: 'Land tax' },
  { id: 'eff', label: 'Effective rate ($ per $1,000 market value)', short: 'Effective rate' },
  { id: 'added', label: 'Added tax from the calculator', short: 'Added tax' },
]

/** Warm 7-class sequential ramp: cream → ember → oxblood. */
export const RAMP_TAX = ['#f7f0d8', '#f2d898', '#eeb56a', '#e48a4f', '#d25e3d', '#a8363b', '#6b1d38']
/** Cool ramp for the calculator's added burden so it never reads as the existing tax. */
export const RAMP_ADDED = ['#e2efe9', '#bddfd5', '#8cc8bf', '#5aabad', '#33879b', '#225f82', '#1d3b66']
export const EXEMPT = '#d6d2c8'
export const BLDG_NO_TAX = '#c9c6bd'

/** Property name for a tile attribute in the chosen tax year. */
export const yf = (base: string, year: Year) => (year === '2025' ? `${base}_25` : base)

function step(field: string, breaks: number[], colors: string[]): ExpressionSpecification {
  const expr: unknown[] = ['step', ['coalesce', ['get', field], 0], colors[0]]
  breaks.slice(0, colors.length - 1).forEach((b, i) => expr.push(b, colors[i + 1]))
  return expr as ExpressionSpecification
}

const SEL: ExpressionSpecification = ['boolean', ['feature-state', 'sel'], false]
/** Building feature-state set by the controller for footprints on parcels outside the selected district. */
const BLDG_OUT: ExpressionSpecification = ['boolean', ['feature-state', 'out'], false]
/** Parcels outside a selected district: a faint neutral wash, so the district reads as the only live area. */
export const OUTSIDE = '#cbc6bb'
export const BLDG_OUTSIDE = '#e6e2da'

/** `mask`: a district is selected, so parcels without the `sel` feature-state are de-emphasized. */
export function parcelFillColor(mode: ColorMode, year: Year, meta: Meta, addedBreaks: number[], mask = false): ExpressionSpecification {
  const taxF = yf('tax', year)
  if (mode === 'added') {
    return ['case', SEL, step(yf('tv', year), addedBreaks, RAMP_ADDED), mask ? OUTSIDE : EXEMPT] as ExpressionSpecification
  }
  const color = [
    'case',
    ['<=', ['coalesce', ['get', taxF], 0], 0],
    EXEMPT,
    step(yf(mode, year), meta.ramps[mode], RAMP_TAX),
  ] as ExpressionSpecification
  return mask ? (['case', SEL, color, OUTSIDE] as ExpressionSpecification) : color
}

export function parcelFillOpacity(mode: ColorMode, mask = false): ExpressionSpecification {
  const inside = mode === 'added' ? 0.72 : 0.58
  const base = mask ? ['case', SEL, inside, 0.1] : mode === 'added' ? ['case', SEL, inside, 0.18] : inside
  return [
    'case',
    ['boolean', ['feature-state', 'picked'], false], mask ? ['case', SEL, 0.92, 0.45] : 0.92,
    ['boolean', ['feature-state', 'hover'], false], mask ? ['case', SEL, 0.85, 0.3] : 0.85,
    base,
  ] as ExpressionSpecification
}

/** Parcel outlines: faint outside a selected district. */
export function parcelLineOpacity(mask = false): ExpressionSpecification {
  const at = (v: number, out: number) => (mask ? ['case', SEL, v, out] : v)
  return ['interpolate', ['linear'], ['zoom'], 14, at(0.12, 0.04), 17, at(0.35, 0.08)] as ExpressionSpecification
}

/** Extrusion height; footprints outside a selected district lie flat. */
export function buildingHeight(mask = false): ExpressionSpecification {
  const h: unknown = ['coalesce', ['get', 'h'], 5]
  return ['interpolate', ['linear'], ['zoom'], 13, 0, 13.6, mask ? ['case', BLDG_OUT, 0, h] : h] as ExpressionSpecification
}

export function buildingColor(mode: ColorMode, year: Year, meta: Meta, mask = false): ExpressionSpecification | string {
  const f = yf('tax_b', year)
  const color = mode === 'added'
    ? '#d9d5cc'
    : (['case', ['>', ['coalesce', ['get', f], 0], 0], step(f, meta.ramps.tax_b, RAMP_TAX), BLDG_NO_TAX] as ExpressionSpecification)
  return mask ? (['case', BLDG_OUT, BLDG_OUTSIDE, color] as ExpressionSpecification) : color
}

/** Label opacity gated to the selection (`sel` on parcels, not `out` on buildings). */
export const parcelLabelOpacity = (gate: boolean): ExpressionSpecification | number => (gate ? (['case', SEL, 1, 0] as ExpressionSpecification) : 1)
export const buildingLabelOpacity = (mask: boolean): ExpressionSpecification | number => (mask ? (['case', BLDG_OUT, 0, 1] as ExpressionSpecification) : 1)

export function moneyLabel(field: string): ExpressionSpecification {
  return ['concat', '$', ['number-format', ['round', ['coalesce', ['get', field], 0]], { 'max-fraction-digits': 0 }]] as ExpressionSpecification
}

/** Legend breaks (in the units the user sees) and colors for the current mode. */
export function legendFor(mode: ColorMode, meta: Meta, addedBreaks: number[], mills: number) {
  if (mode === 'added') return { breaks: addedBreaks.map((b) => (b * mills) / 1000), colors: RAMP_ADDED }
  return { breaks: meta.ramps[mode], colors: RAMP_TAX }
}

/** Calculator mode label: the added tax (text-field can't read feature-state, so opacity gates it to the selection). */
export function addedLabel(year: Year, mills: number): ExpressionSpecification {
  return ['concat', '+$', ['number-format', ['round', ['*', ['coalesce', ['get', yf('tv', year)], 0], mills / 1000]], { 'max-fraction-digits': 0 }]] as ExpressionSpecification
}
