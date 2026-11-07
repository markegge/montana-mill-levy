declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson'
  type Result = FeatureCollection & { fileName?: string }
  export default function shp(input: ArrayBuffer | string | Record<string, ArrayBuffer>): Promise<Result | Result[]>
}
