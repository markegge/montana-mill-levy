import type { Districts, DistrictFeature } from '../data/types'
import { COUNTY_ID, type Selection } from './select'

export interface DistrictGroup {
  id: string
  name: string
  type: string
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
    else out.set(id, { id, name: f.properties.name, type: f.properties.type, features: [f] })
  }
  return out
}

interface PresetDef { label: string; find: (g: DistrictGroup) => boolean }

const PRESET_DEFS: PresetDef[] = [
  { label: 'Gallatin County', find: (g) => g.id === COUNTY_ID },
  { label: 'City of Bozeman', find: (g) => g.type === 'city' && /bozeman/i.test(g.name) },
  { label: 'City of Belgrade', find: (g) => g.type === 'city' && /belgrade/i.test(g.name) },
  { label: 'Bozeman elementary', find: (g) => g.type === 'elem_sd' && /bozeman/i.test(g.name) },
  { label: 'Bozeman high school', find: (g) => g.type === 'hs_sd' && /bozeman/i.test(g.name) },
  { label: 'Belgrade SD 44', find: (g) => (g.type === 'elem_sd' || g.type === 'k12_sd') && /belgrade/i.test(g.name) },
  { label: 'Central Valley Fire', find: (g) => g.type === 'fire' && /central valley/i.test(g.name) },
]

export interface Preset { label: string; id: string }

export function resolvePresets(groups: Map<string, DistrictGroup>, warn = false): Preset[] {
  const all = [...groups.values()]
  const out: Preset[] = []
  for (const d of PRESET_DEFS) {
    const g = all.find(d.find)
    if (g) out.push({ label: d.label, id: g.id })
    else if (warn) console.warn(`[presets] no district found for "${d.label}"`)
  }
  return out
}

export function selectionForDistrict(g: DistrictGroup, label?: string): Selection {
  return { key: g.id, label: label ?? g.name, kind: 'district', features: g.features, all: g.id === COUNTY_ID }
}
