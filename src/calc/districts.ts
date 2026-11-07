import type { Districts, DistrictFeature, Meta } from '../data/types'
import { countiesForShapes, type Selection } from './select'

export interface DistrictGroup {
  id: string
  name: string
  type: string
  /** County slug */
  county: string
  features: DistrictFeature[]
}

export const TYPE_LABEL: Record<string, string> = {
  utd: 'Transportation district',
  county: 'County',
  city: 'City / town',
  elem_sd: 'Elementary school district',
  hs_sd: 'High school district',
  k12_sd: 'K-12 school district',
  fire: 'Fire district',
  cemetery: 'Cemetery district',
  mosquito: 'Mosquito district',
  tifd: 'TIF district',
}

/** Features sharing an id are pieces of one district. */
export function groupDistricts(fc: Districts): Map<string, DistrictGroup> {
  const out = new Map<string, DistrictGroup>()
  for (const f of fc.features) {
    const id = f.properties?.id
    if (!id || !f.geometry) continue
    const g = out.get(id)
    if (g) g.features.push(f)
    else out.set(id, { id, name: f.properties.name, type: f.properties.type, county: f.properties.county ?? 'gallatin', features: [f] })
  }
  return out
}

interface PresetDef { label: string; county: string; find: (g: DistrictGroup) => boolean }

const PRESET_DEFS: PresetDef[] = [
  { label: 'Gallatin County', county: 'gallatin', find: (g) => g.id === 'gallatin-county' },
  { label: 'City of Bozeman', county: 'gallatin', find: (g) => g.type === 'city' && /bozeman/i.test(g.name) },
  { label: 'City of Belgrade', county: 'gallatin', find: (g) => g.type === 'city' && /belgrade/i.test(g.name) },
  { label: 'Bozeman elementary', county: 'gallatin', find: (g) => g.type === 'elem_sd' && /bozeman/i.test(g.name) },
  { label: 'Bozeman high school', county: 'gallatin', find: (g) => g.type === 'hs_sd' && /bozeman/i.test(g.name) },
  { label: 'Belgrade SD 44', county: 'gallatin', find: (g) => (g.type === 'elem_sd' || g.type === 'k12_sd') && /belgrade/i.test(g.name) },
  { label: 'Central Valley Fire', county: 'gallatin', find: (g) => g.type === 'fire' && /central valley/i.test(g.name) },
  { label: 'Yellowstone County', county: 'yellowstone', find: (g) => g.id === 'yellowstone-county' },
  { label: 'City of Billings', county: 'yellowstone', find: (g) => g.id === 'ys-city-billings' },
  { label: 'City of Laurel', county: 'yellowstone', find: (g) => g.id === 'ys-city-laurel' },
]

export interface Preset { label: string; id: string; county: string }

export function resolvePresets(groups: Map<string, DistrictGroup>, warn = false): Preset[] {
  const all = [...groups.values()]
  const out: Preset[] = []
  for (const d of PRESET_DEFS) {
    const g = all.find((x) => x.county === d.county && d.find(x))
    if (g) out.push({ label: d.label, id: g.id, county: d.county })
    else if (warn) console.warn(`[presets] no district found for "${d.label}"`)
  }
  return out
}

export function selectionForDistrict(g: DistrictGroup, meta: Meta, label?: string): Selection {
  const counties = meta.counties[g.county] ? [g.county] : countiesForShapes(g.features, meta)
  const all = meta.counties[g.county]?.district_id === g.id
  return { key: g.id, label: label ?? g.name, kind: 'district', features: g.features, counties, all }
}
