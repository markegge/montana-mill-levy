import type { Year } from './data/types'
import type { ViewState } from './map/controller'
import { COLOR_MODES, type ColorMode } from './map/style'

export interface UrlState {
  view?: ViewState
  district?: string
  mills?: number
  year?: Year
  color?: ColorMode
}

/** `#zoom/lat/lon/pitch/bearing` + `?district=city-bozeman&mills=5&year=2026&color=tax`. */
export function readUrl(): UrlState {
  const out: UrlState = {}
  const h = window.location.hash.replace(/^#/, '').split('/').map(Number)
  if (h.length >= 3 && h.slice(0, 3).every(Number.isFinite)) {
    out.view = { zoom: h[0], lat: h[1], lon: h[2], pitch: Number.isFinite(h[3]) ? h[3] : 0, bearing: Number.isFinite(h[4]) ? h[4] : 0 }
  }
  const q = new URLSearchParams(window.location.search)
  const d = q.get('district')
  if (d) out.district = d
  const m = Number(q.get('mills'))
  if (q.has('mills') && Number.isFinite(m) && m >= 0) out.mills = m
  const y = q.get('year')
  if (y === '2025' || y === '2026') out.year = y
  const c = q.get('color') as ColorMode | null
  if (c && COLOR_MODES.some((x) => x.id === c)) out.color = c
  return out
}

let pending: number | null = null
type Written = { view?: ViewState; district?: string; mills: number; year: Year; color: ColorMode }
let latest: Written | null = null

/** Merge into the URL; pass `district: undefined` explicitly for a custom (unshareable) area. */
export function writeUrl(s: Partial<Written>) {
  latest = { mills: 5, year: '2026', color: 'tax', ...latest, ...s }
  if (pending != null) return
  pending = window.setTimeout(() => {
    pending = null
    if (!latest) return
    const q = new URLSearchParams()
    if (latest.district) q.set('district', latest.district)
    q.set('mills', String(latest.mills))
    q.set('year', latest.year)
    if (latest.color !== 'tax') q.set('color', latest.color)
    const v = latest.view
    const hash = v ? `#${v.zoom.toFixed(2)}/${v.lat.toFixed(5)}/${v.lon.toFixed(5)}/${Math.round(v.pitch)}/${Math.round(v.bearing)}` : window.location.hash
    history.replaceState(null, '', `${window.location.pathname}?${q.toString()}${hash}`)
  }, 250)
}
