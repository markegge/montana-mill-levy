import { getJSON, loadCountyIndex } from '../data/load'
import type { AddressFile, Meta } from '../data/types'

/** One searchable situs address (or condo unit) and the parcel it sits on. */
export interface AddressEntry {
  addr: string // as published, e.g. "1825 W KAGY BLVD"
  unit: string | null
  city: string
  county: string // slug
  pid: string
  lon: number
  lat: number
  num: string // normalized house number ("" when the address has none)
  tokens: string[] // normalized street tokens
  cityTokens: string[]
}

export interface ParcelHit { pid: string; lon: number; lat: number; county: string }

export interface SearchResult {
  kind: 'address' | 'parcel'
  label: string
  sub: string
  pid: string
  lon: number
  lat: number
  /** Condo unit key as it appears in condos.json, e.g. "151 COVEY #D" */
  unit?: string
}

// ---------- normalization ----------

const SUFFIX: Record<string, string> = {
  STREET: 'ST', ST: 'ST', STR: 'ST',
  AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE',
  ROAD: 'RD', RD: 'RD',
  DRIVE: 'DR', DR: 'DR',
  LANE: 'LN', LN: 'LN',
  BOULEVARD: 'BLVD', BLVD: 'BLVD',
  COURT: 'CT', CT: 'CT',
  PLACE: 'PL', PL: 'PL',
  WAY: 'WAY',
  TRAIL: 'TRL', TRL: 'TRL',
  CIRCLE: 'CIR', CIR: 'CIR',
  HIGHWAY: 'HWY', HWY: 'HWY',
  PARKWAY: 'PKWY', PKWY: 'PKWY',
  TERRACE: 'TER', TER: 'TER',
  LOOP: 'LOOP',
  SQUARE: 'SQ', SQ: 'SQ',
}
const DIRECTIONAL: Record<string, string> = {
  NORTH: 'N', N: 'N', SOUTH: 'S', S: 'S', EAST: 'E', E: 'E', WEST: 'W', W: 'W',
  NORTHEAST: 'NE', NE: 'NE', NORTHWEST: 'NW', NW: 'NW', SOUTHEAST: 'SE', SE: 'SE', SOUTHWEST: 'SW', SW: 'SW',
}
const UNIT_MARKERS = new Set(['#', 'APT', 'UNIT', 'STE', 'SUITE', 'NO'])
const ORDINAL_WORDS: Record<string, string> = {
  FIRST: '1', SECOND: '2', THIRD: '3', FOURTH: '4', FIFTH: '5', SIXTH: '6', SEVENTH: '7', EIGHTH: '8', NINTH: '9', TENTH: '10',
}

type TokClass = 'suffix' | 'dir' | 'word'

function canon(tok: string): { t: string; cls: TokClass } {
  const ord = /^(\d+)(ST|ND|RD|TH)$/.exec(tok)
  if (ord) return { t: ord[1], cls: 'word' }
  if (ORDINAL_WORDS[tok]) return { t: ORDINAL_WORDS[tok], cls: 'word' }
  if (SUFFIX[tok]) return { t: SUFFIX[tok], cls: 'suffix' }
  if (DIRECTIONAL[tok]) return { t: DIRECTIONAL[tok], cls: 'dir' }
  return { t: tok, cls: 'word' }
}

/** Uppercase, split "#D" into "# D", and drop other punctuation. */
function rawTokens(s: string): string[] {
  return s
    .toUpperCase()
    .replace(/#/g, ' # ')
    .replace(/[^A-Z0-9# ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

const SUFFIX_SET = new Set(Object.values(SUFFIX))
const DIR_SET = new Set(Object.values(DIRECTIONAL))
const classOf = (t: string): TokClass => (SUFFIX_SET.has(t) ? 'suffix' : DIR_SET.has(t) ? 'dir' : 'word')

interface ParsedQuery {
  num: string | null
  tokens: { t: string; cls: TokClass; last: boolean }[]
  unit: string | null
}

function parseQuery(q: string): ParsedQuery {
  const toks = rawTokens(q)
  let num: string | null = null
  let unit: string | null = null
  const out: ParsedQuery['tokens'] = []
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]
    if (i === 0 && /^\d/.test(tok)) {
      num = tok
      continue
    }
    if (UNIT_MARKERS.has(tok)) {
      if (i + 1 < toks.length) unit = toks[++i]
      continue
    }
    const { t, cls } = canon(tok)
    out.push({ t, cls, last: false })
  }
  // The final token is still being typed unless the query ends with a space.
  if (out.length && !/\s$/.test(q)) out[out.length - 1].last = true
  return { num, tokens: out, unit }
}

// ---------- index ----------

let entries: AddressEntry[] | null = null
let parcelsById: Map<string, ParcelHit> | null = null
let loading: Promise<void> | null = null

export function addressesLoaded() {
  return entries != null
}

/** Load every county's address file once (first focus of the search box). */
export function loadAddresses(meta: Meta): Promise<void> {
  loading ??= (async () => {
    const files = await Promise.all(
      Object.entries(meta.counties)
        .filter(([, c]) => c.addresses)
        .map(async ([slug, c]) => ({ slug, file: await getJSON<AddressFile>(c.addresses!) })),
    )
    const all: AddressEntry[] = []
    const byPid = new Map<string, ParcelHit>()
    for (const { slug, file } of files) {
      for (const [pid, lon, lat] of file.parcels) byPid.set(pid, { pid, lon, lat, county: slug })
      for (const r of file.rows) {
        const [addr, cityIdx] = r
        const unit = r.length === 4 ? String(r[2]) : null
        const parcelIdx = r.length === 4 ? r[3] : r[2]
        const p = file.parcels[parcelIdx]
        if (!p) continue
        const toks = rawTokens(addr)
        const num = toks.length && /^\d/.test(toks[0]) ? toks.shift()! : ''
        const city = file.cities[cityIdx] ?? ''
        all.push({
          addr, unit, city, county: slug, pid: p[0], lon: p[1], lat: p[2], num,
          tokens: toks.map((t) => canon(t).t),
          cityTokens: rawTokens(city),
        })
      }
    }
    entries = all
    parcelsById = byPid
  })().catch((e) => {
    loading = null
    throw e
  })
  return loading
}

function score(e: AddressEntry, q: ParsedQuery): number {
  let s = 0
  if (q.num != null) {
    if (!e.num.startsWith(q.num)) return -1
    s += e.num === q.num ? 4 : 1
  }
  let streetHits = 0
  let unitHit = false
  for (const qt of q.tokens) {
    if (e.tokens.includes(qt.t)) {
      s += 3
      if (qt.cls === 'word') streetHits++
      continue
    }
    if (qt.last && qt.t.length >= 2 && e.tokens.some((t) => t.startsWith(qt.t))) {
      s += 2
      streetHits++
      continue
    }
    // A suffix or directional the record lacks is fine ("151 COVEY" for "151 Covey Ct"); a conflicting one is not.
    if (qt.cls !== 'word') {
      if (e.tokens.some((t) => classOf(t) === qt.cls)) return -1
      continue
    }
    if (e.unit && (qt.t === e.unit || (qt.last && e.unit.startsWith(qt.t)))) {
      s += 3
      unitHit = true
      continue
    }
    if (e.cityTokens.includes(qt.t) || (qt.last && e.cityTokens.some((t) => t.startsWith(qt.t)))) {
      s += 1
      continue
    }
    return -1
  }
  if (q.unit) {
    if (!e.unit || !e.unit.startsWith(q.unit)) return -1
    s += e.unit === q.unit ? 4 : 2
    unitHit = true
  }
  if (!streetHits && q.tokens.length) return -1
  if (!streetHits && q.num == null) return -1
  // Prefer the whole-parcel row over its units unless the query names a unit.
  if (e.unit && !unitHit) s -= 1
  return s
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())

export function searchAddresses(query: string, meta: Meta, limit = 8): SearchResult[] {
  if (!entries) return []
  const q = parseQuery(query)
  if (q.num == null && !q.tokens.some((t) => t.t.length >= 3)) return []
  const scored: { e: AddressEntry; s: number }[] = []
  for (const e of entries) {
    const s = score(e, q)
    if (s >= 0) scored.push({ e, s })
  }
  scored.sort((a, b) => b.s - a.s || a.e.addr.length - b.e.addr.length || a.e.addr.localeCompare(b.e.addr, 'en', { numeric: true }))
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const { e } of scored) {
    const key = `${e.pid}|${e.addr}|${e.unit ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      kind: 'address',
      label: e.unit ? `${titleCase(e.addr)} #${e.unit}` : titleCase(e.addr),
      sub: [e.city, meta.counties[e.county]?.name].filter(Boolean).join(', '),
      pid: e.pid,
      lon: e.lon,
      lat: e.lat,
      unit: e.unit ? `${e.addr} #${e.unit}` : undefined,
    })
    if (out.length >= limit) break
  }
  return out
}

// ---------- geocode / parcel id ----------

/** "06-0799-11-2-10-15-7000" or "06079911210157000" (or a 10+ digit prefix) → digits, else null. */
export function geocodeDigits(query: string): string | null {
  const d = query.replace(/[\s-]/g, '')
  return /^\d{10,17}$/.test(d) ? d : null
}

export function formatPid(pid: string) {
  return /^\d{17}$/.test(pid)
    ? [pid.slice(0, 2), pid.slice(2, 6), pid.slice(6, 8), pid.slice(8, 9), pid.slice(9, 11), pid.slice(11, 13), pid.slice(13)].join('-')
    : pid
}

export function searchGeocodes(digits: string, meta: Meta, limit = 8): SearchResult[] {
  if (!parcelsById) return []
  const out: SearchResult[] = []
  for (const p of parcelsById.values()) {
    if (!p.pid.startsWith(digits)) continue
    out.push({ kind: 'parcel', label: formatPid(p.pid), sub: `Parcel · ${meta.counties[p.county]?.name ?? ''}`, pid: p.pid, lon: p.lon, lat: p.lat })
    if (out.length >= limit) break
  }
  return out.sort((a, b) => a.pid.localeCompare(b.pid))
}

/**
 * Where a parcel is: from the address list when it has a situs address, otherwise from its county's
 * property index (picked by the DOR county code at the start of the geocode).
 */
export async function locateParcel(pid: string, meta: Meta): Promise<ParcelHit | null> {
  await loadAddresses(meta).catch(() => {})
  const hit = parcelsById?.get(pid)
  if (hit) return hit
  const county = Object.entries(meta.counties).find(([, c]) => pid.startsWith(c.dor_code))
  if (!county) return null
  const idx = await loadCountyIndex(county[0], county[1].index, () => {})
  for (let i = 0; i < idx.n; i++) {
    if (idx.pid[i] === pid && !Number.isNaN(idx.lon[i])) return { pid, lon: idx.lon[i], lat: idx.lat[i], county: county[0] }
  }
  return null
}

// ---------- Photon fallback ----------

export interface PhotonResult { label: string; sub: string; lon: number; lat: number }

let lastPhoton = 0

/** OpenStreetMap geocoding via Photon, limited to the counties' bounding box and to one request per second. */
export async function photonSearch(query: string, meta: Meta): Promise<PhotonResult[]> {
  const wait = lastPhoton + 1000 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastPhoton = Date.now()
  const bb = Object.values(meta.counties).reduce(
    (a, c) => [Math.min(a[0], c.bbox[0]), Math.min(a[1], c.bbox[1]), Math.max(a[2], c.bbox[2]), Math.max(a[3], c.bbox[3])],
    [180, 90, -180, -90],
  )
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&bbox=${bb.join(',')}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Photon: HTTP ${res.status}`)
  const json = (await res.json()) as {
    features: { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }[]
  }
  return json.features.map((f) => {
    const p = f.properties
    const street = [p.housenumber, p.street].filter(Boolean).join(' ')
    const label = p.name && p.name !== street ? (street ? `${p.name}, ${street}` : p.name) : street || p.name || 'Unnamed place'
    return {
      label,
      sub: [p.city ?? p.town ?? p.village, p.county, p.state].filter(Boolean).join(', '),
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }
  })
}
