import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'
import type { AreaFeature } from './select'

export interface UploadedShape { name: string; feature: AreaFeature }

const NAME_KEYS = ['NAME', 'name', 'Name', 'NAMELSAD', 'DISTRICT', 'District', 'LABEL', 'label', 'TITLE', 'id', 'ID']

function guessName(props: Record<string, unknown> | null, i: number): string {
  if (props) {
    for (const k of NAME_KEYS) if (typeof props[k] === 'string' && props[k]) return props[k] as string
    const firstStr = Object.values(props).find((v) => typeof v === 'string' && v.length > 0 && v.length < 60)
    if (firstStr) return firstStr as string
  }
  return `Shape ${i + 1}`
}

function collect(input: unknown): Feature[] {
  if (Array.isArray(input)) return input.flatMap(collect) // shpjs returns one collection per layer in multi-layer zips
  const o = input as { type?: string; features?: Feature[]; geometry?: Geometry }
  if (o?.type === 'FeatureCollection') return o.features ?? []
  if (o?.type === 'Feature') return [o as Feature]
  if (o?.type === 'Polygon' || o?.type === 'MultiPolygon') return [{ type: 'Feature', properties: {}, geometry: o as unknown as Geometry }]
  return []
}

function looksProjected(fs: AreaFeature[]): boolean {
  const c = fs[0]?.geometry.coordinates.flat(3) as number[] | undefined
  return !!c && (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90)
}

/** Parse a zipped shapefile (reprojected via its .prj) or a GeoJSON file into polygon features. */
export async function parseUpload(file: File): Promise<UploadedShape[]> {
  let data: unknown
  if (/\.zip$/i.test(file.name)) {
    const { default: shp } = await import('shpjs')
    data = await shp(await file.arrayBuffer())
  } else if (/\.(geo)?json$/i.test(file.name)) {
    data = JSON.parse(await file.text()) as FeatureCollection
  } else {
    throw new Error('Upload a zipped shapefile (.zip) or a GeoJSON file (.geojson / .json).')
  }
  const polys = collect(data)
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map(({ f, i }) => ({
      name: guessName(f.properties as Record<string, unknown> | null, i),
      feature: { type: 'Feature', properties: f.properties ?? {}, geometry: f.geometry as Polygon | MultiPolygon } as AreaFeature,
    }))
  if (!polys.length) throw new Error('No polygons found in that file.')
  if (looksProjected(polys.map((p) => p.feature))) {
    throw new Error('Coordinates look projected, not longitude/latitude. Include the .prj in the zip, or export GeoJSON in WGS84.')
  }
  return polys
}
