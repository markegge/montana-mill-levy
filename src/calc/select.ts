import bbox from '@turf/bbox'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { Meta, PropIndex } from '../data/types'

export type AreaFeature = Feature<Polygon | MultiPolygon>

/** What the calculator is pointed at: a named district, or a set of drawn/uploaded shapes. */
export interface Selection {
  key: string // district id, or 'custom'
  label: string
  kind: 'district' | 'custom'
  features: AreaFeature[]
  /** County slugs whose property indexes this selection needs. */
  counties: string[]
  /** Select every property in the (single-county) index, including those without a polygon (county-wide preset). */
  all?: boolean
}

/** Counties whose bounding box intersects any of the shapes (drawn or uploaded areas may span a county line). */
export function countiesForShapes(features: AreaFeature[], meta: Meta): string[] {
  const boxes = features.filter((f) => f.geometry).map((f) => bbox(f))
  return Object.entries(meta.counties)
    .filter(([, c]) => boxes.some((b) => b[0] <= c.bbox[2] && b[2] >= c.bbox[0] && b[1] <= c.bbox[3] && b[3] >= c.bbox[1]))
    .map(([slug]) => slug)
}

/** Indices into PropIndex of properties whose representative point is inside any of the features. */
export function selectProperties(idx: PropIndex, sel: Selection): Int32Array {
  // Never answer from the wrong county's rows: the index must hold exactly the counties the selection needs.
  if (idx.counties.length !== sel.counties.length || sel.counties.some((c) => !idx.counties.includes(c))) {
    throw new Error(`index holds [${idx.counties}] but selection needs [${sel.counties}]`)
  }
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
