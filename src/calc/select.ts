import bbox from '@turf/bbox'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { PropIndex } from '../data/types'

export type AreaFeature = Feature<Polygon | MultiPolygon>

/** What the calculator is pointed at: a named district, or a set of drawn/uploaded shapes. */
export interface Selection {
  key: string // district id, or 'custom'
  label: string
  kind: 'district' | 'custom'
  features: AreaFeature[]
  /** Select every property in the index, including those without a polygon (county-wide preset). */
  all?: boolean
}

export const COUNTY_ID = 'gallatin-county'

/** Indices into PropIndex of properties whose representative point is inside any of the features. */
export function selectProperties(idx: PropIndex, sel: Selection): Int32Array {
  if (sel.all) {
    const out = new Int32Array(idx.n)
    for (let i = 0; i < idx.n; i++) out[i] = i
    return out
  }
  const shapes = sel.features
    .filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map((f) => ({ f, b: bbox(f) }))
  if (!shapes.length) return new Int32Array(0)
  const hits: number[] = []
  const pt: [number, number] = [0, 0]
  for (let i = 0; i < idx.n; i++) {
    const x = idx.lon[i]
    const y = idx.lat[i]
    if (Number.isNaN(x)) continue
    for (const { f, b } of shapes) {
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue
      pt[0] = x
      pt[1] = y
      if (booleanPointInPolygon(pt, f)) {
        hits.push(i)
        break
      }
    }
  }
  return Int32Array.from(hits)
}
