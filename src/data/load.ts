import type { Condos, Districts, DistrictStats, Levies, Meta, PropIndex, Validation } from './types'

const DATA: string = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? `${import.meta.env.BASE_URL}data`
export const TILES_BASE: string = (import.meta.env.VITE_TILES_BASE as string | undefined) ?? '/tiles'

async function getJSON<T>(name: string): Promise<T> {
  const res = await fetch(`${DATA}/${name}`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** Fetch with a progress callback (fraction 0–1, or -1 if the size is unknown). */
async function getJSONWithProgress<T>(name: string, onProgress: (f: number) => void): Promise<T> {
  const res = await fetch(`${DATA}/${name}`)
  if (!res.ok || !res.body) throw new Error(`${name}: HTTP ${res.status}`)
  // Content-Length is the compressed size when the server gzips, so treat it as a rough guide only.
  const total = Number(res.headers.get('content-length')) || 0
  const encoded = !!res.headers.get('content-encoding')
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    onProgress(total && !encoded ? Math.min(1, got / total) : -1)
  }
  const buf = new Uint8Array(got)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.length
  }
  return JSON.parse(new TextDecoder().decode(buf)) as T
}

export interface CoreData {
  meta: Meta
  levies: Levies
  districts: Districts
  stats: DistrictStats
}

export async function loadCore(): Promise<CoreData> {
  const [meta, levies, districts, stats] = await Promise.all([
    getJSON<Meta>('meta.json'),
    getJSON<Levies>('levies.json'),
    getJSON<Districts>('districts.json'),
    getJSON<DistrictStats>('district_stats.json'),
  ])
  return { meta, levies, districts, stats }
}

type RawIndex = { cols: string[]; rows: (string | number | null)[][] }

export async function loadIndex(onProgress: (f: number) => void): Promise<PropIndex> {
  const raw = await getJSONWithProgress<RawIndex>('parcels_index.json', onProgress)
  const c = (name: string) => {
    const i = raw.cols.indexOf(name)
    if (i < 0) throw new Error(`parcels_index.json is missing column "${name}"`)
    return i
  }
  const [iPid, iLon, iLat, iLevy, iTv26, iTax26, iTv25, iTax25, iCat26, iCat25, iHh] = [
    'pid', 'lon', 'lat', 'levy', 'tv26', 'tax26', 'tv25', 'tax25', 'cat26', 'cat25', 'hh',
  ].map(c)
  const n = raw.rows.length
  const idx: PropIndex = {
    n,
    pid: new Array(n),
    lon: new Float64Array(n),
    lat: new Float64Array(n),
    levy: new Int32Array(n),
    tv: { '2026': new Float64Array(n), '2025': new Float64Array(n) },
    tax: { '2026': new Float64Array(n), '2025': new Float64Array(n) },
    cat: { '2026': new Int8Array(n), '2025': new Int8Array(n) },
    hh: new Float32Array(n),
  }
  const num = (v: unknown) => (typeof v === 'number' ? v : v == null ? 0 : Number(v) || 0)
  for (let i = 0; i < n; i++) {
    const r = raw.rows[i]
    idx.pid[i] = (r[iPid] as string | null) ?? null
    idx.lon[i] = r[iLon] == null ? NaN : num(r[iLon])
    idx.lat[i] = r[iLat] == null ? NaN : num(r[iLat])
    idx.levy[i] = r[iLevy] == null ? -1 : num(r[iLevy])
    idx.tv['2026'][i] = num(r[iTv26])
    idx.tax['2026'][i] = num(r[iTax26])
    idx.tv['2025'][i] = num(r[iTv25])
    idx.tax['2025'][i] = num(r[iTax25])
    idx.cat['2026'][i] = num(r[iCat26])
    idx.cat['2025'][i] = num(r[iCat25])
    idx.hh[i] = num(r[iHh])
  }
  return idx
}

let condosPromise: Promise<Condos> | null = null
export function loadCondos(): Promise<Condos> {
  condosPromise ??= getJSON<Condos>('condos.json').catch((e) => {
    condosPromise = null
    throw e
  })
  return condosPromise
}

export async function loadValidation(): Promise<Validation | null> {
  try {
    const res = await fetch(`${DATA}/validation.json`)
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
    return (await res.json()) as Validation
  } catch {
    return null
  }
}
