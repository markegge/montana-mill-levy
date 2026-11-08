import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Calculator from './calc/Calculator'
import { groupDistricts, resolvePresets, selectionForDistrict } from './calc/districts'
import { countiesForShapes, selectProperties, type AreaFeature, type Selection } from './calc/select'
import { computeBase, taxableBreaks } from './calc/stats'
import { concatIndexes, loadCondos, loadCore, loadCountyIndex, type CoreData } from './data/load'
import type { Condos, PropIndex, Year } from './data/types'
import { COUNTY_VIEWS, MapController, type PickEvent, type ViewState } from './map/controller'
import { COLOR_MODES, type ColorMode } from './map/style'
import PropertyPanel, { YearToggle } from './panel/PropertyPanel'
import { locateParcel } from './search/addressIndex'
import SearchBox, { type SearchPick } from './search/SearchBox'
import About from './ui/About'
import Legend from './ui/Legend'
import { readUrl, writeUrl } from './urlState'

const initialUrl = readUrl()

export default function App() {
  const [core, setCore] = useState<CoreData | null>(null)
  const [coreErr, setCoreErr] = useState<string | null>(null)
  const [indexes, setIndexes] = useState<Record<string, PropIndex>>({})
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [viewCounty, setViewCounty] = useState<string | null>(null)
  const [condos, setCondos] = useState<Condos | null>(null)
  const [year, setYear] = useState<Year>(initialUrl.year ?? '2026')
  const [mills, setMills] = useState(initialUrl.mills ?? 5)
  const [mode, setMode] = useState<ColorMode>(initialUrl.color ?? 'tax')
  const [selection, setSelection] = useState<Selection | null>(null)
  const [pick, setPick] = useState<PickEvent | null>(null)
  const [drawing, setDrawing] = useState<'polygon' | 'rectangle' | null>(null)
  const [about, setAbout] = useState(false)
  const [buildings, setBuildings] = useState(true)
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 768)
  const [mapReady, setMapReady] = useState(false)
  const mapEl = useRef<HTMLDivElement>(null)
  const ctrl = useRef<MapController | null>(null)
  const fitNext = useRef(false)

  // Data
  useEffect(() => {
    loadCore().then((c) => {
      setCore(c)
      // Initial district from the URL, else Gallatin County.
      const gs = groupDistricts(c.districts)
      const g = gs.get(initialUrl.district ?? 'gallatin-county') ?? gs.get('gallatin-county')
      if (g) {
        // A shared link with a district but no map position should land on that district.
        fitNext.current = !initialUrl.view && !!initialUrl.district
        setSelection(selectionForDistrict(g, c.meta, resolvePresets(gs).find((p) => p.id === g.id)?.label))
      }
    }, (e: Error) => setCoreErr(e.message))
  }, [])

  // Property indexes load per county, only when the selection needs them.
  const needed = useMemo(() => selection?.counties ?? [], [selection])
  const started = useRef(new Set<string>())
  useEffect(() => {
    if (!core) return
    for (const county of needed) {
      if (started.current.has(county)) continue
      const cm = core.meta.counties[county]
      if (!cm) continue
      started.current.add(county)
      loadCountyIndex(county, cm.index, (f) => setProgress((p) => ({ ...p, [county]: f }))).then(
        (i) => {
          setIndexes((x) => ({ ...x, [county]: i }))
          loadCondos().then(setCondos, () => console.warn('condos.json failed to load; condo unit counts unavailable'))
        },
        (e: Error) => setCoreErr(e.message),
      )
    }
  }, [core, needed])

  const idx = useMemo(() => {
    if (!needed.every((c) => indexes[c])) return null
    return concatIndexes(needed.map((c) => indexes[c]))
  }, [needed, indexes])
  const loadingCounties = needed.filter((c) => !indexes[c])
  const loadProgress = loadingCounties.length
    ? loadingCounties.reduce((s, c) => s + Math.max(0, progress[c] ?? 0), 0) / loadingCounties.length
    : 1

  const groups = useMemo(() => (core ? groupDistricts(core.districts) : new Map()), [core])
  const presets = useMemo(() => resolvePresets(groups, groups.size > 0), [groups])

  // Map
  useEffect(() => {
    if (!core || !mapEl.current || ctrl.current) return
    ctrl.current = new MapController({
      container: mapEl.current,
      meta: core.meta,
      view: initialUrl.view,
      onPick: (e) => setPick(e),
      onMove: (v: ViewState) => {
        writeUrl({ view: v })
        const inside = Object.entries(core.meta.counties).find(([, c]) => v.lon >= c.bbox[0] && v.lon <= c.bbox[2] && v.lat >= c.bbox[1] && v.lat <= c.bbox[3])
        setViewCounty(inside ? inside[0] : null)
      },
      onReady: () => setMapReady(true),
    })
    if (import.meta.env.DEV) (window as unknown as { __mill: MapController }).__mill = ctrl.current
    return () => {
      ctrl.current?.destroy()
      ctrl.current = null
    }
  }, [core])

  // Calculator
  const rows = useMemo(() => (idx && selection ? selectProperties(idx, selection) : null), [idx, selection])
  const base = useMemo(
    () => (idx && core && rows ? computeBase(idx, core.levies, rows, year, condos) : null),
    [idx, core, rows, year, condos],
  )
  const addedBreaks = useMemo(() => (base ? taxableBreaks(base.parcelTaxable) : [1, 2, 3, 4, 5, 6]), [base])
  const selPids = useMemo(() => {
    if (!idx || !rows) return []
    const set = new Set<string>()
    for (const i of rows) {
      const pid = idx.pid[i]
      if (pid && !Number.isNaN(idx.lon[i])) set.add(pid)
    }
    return [...set]
  }, [idx, rows])

  // Cross-check client-side membership against the pipeline's precomputed district stats.
  useEffect(() => {
    if (!base || !selection || selection.kind !== 'district' || !core) return
    const s = core.stats[selection.key]?.[year]
    if (!s) return
    const diff = Math.abs(base.taxable - s.taxable) / Math.max(1, s.taxable)
    if (diff > 0.001 || base.nProps !== s.n_props || (s.n_parcels != null && base.nParcels !== s.n_parcels) || (s.mill_value_net_tif != null && Math.abs((base.taxable - base.tifIncrement) / 1000 - s.mill_value_net_tif) > 1) || Math.abs(base.households - s.hh) > 1) {
      console.warn(`[calc] ${selection.key} TY${year}: client taxable ${Math.round(base.taxable)} / ${base.nProps} props / ${base.nParcels} parcels / ${Math.round(base.households)} hh vs district_stats ${s.taxable} / ${s.n_props} / ${s.n_parcels} / ${s.hh} (${(diff * 100).toFixed(2)}%)`)
    } else if (import.meta.env.DEV) {
      console.info(`[calc] ${selection.key} TY${year} matches district_stats: mill value ${base.millValue.toFixed(0)}`)
    }
  }, [base, selection, core, year])

  useEffect(() => {
    ctrl.current?.setStyle(mode, year, addedBreaks, mills)
  }, [mode, year, addedBreaks, mills, mapReady])

  useEffect(() => {
    if (mapReady) ctrl.current?.setSelectedParcels(selPids)
  }, [selPids, mapReady])

  useEffect(() => {
    if (!ctrl.current || !selection) return
    const county = selection.all && core ? core.meta.counties[selection.counties[0]] : undefined
    ctrl.current.setArea(selection.all ? [] : selection.features, fitNext.current, county?.bbox)
    fitNext.current = false
  }, [selection, mapReady, core])

  useEffect(() => {
    ctrl.current?.setBuildingsVisible(buildings)
  }, [buildings, mapReady])

  useEffect(() => {
    ctrl.current?.setPicked(pick?.pid ?? null)
  }, [pick, mapReady])

  useEffect(() => {
    writeUrl({ mills, year, color: mode, district: selection?.kind === 'district' ? selection.key : undefined })
  }, [mills, year, mode, selection])

  useEffect(() => {
    ctrl.current?.resize()
  }, [pick, collapsed])

  // The open parcel is part of the shareable URL.
  useEffect(() => {
    if (!core) return
    writeUrl({ parcel: pick?.pid, unit: pick?.unit })
  }, [pick, core])

  const onSearchPick = useCallback(async (p: SearchPick) => {
    const c = ctrl.current
    if (!c) return
    setPick(null)
    await c.flyToPoint(p.lon, p.lat)
    if (p.kind === 'parcel') {
      setPick({ pid: p.pid, parcel: c.findParcel(p.pid) ?? c.parcelAt(p.lon, p.lat), building: null, unit: p.unit })
    } else {
      const parcel = c.parcelAt(p.lon, p.lat)
      if (parcel?.pid) setPick({ pid: parcel.pid, parcel, building: null })
    }
  }, [])

  // A shared ?parcel= link flies there and opens the panel once the map is up.
  const openedFromUrl = useRef(false)
  useEffect(() => {
    if (!core || !mapReady || openedFromUrl.current || !initialUrl.parcel) return
    openedFromUrl.current = true
    const pid = initialUrl.parcel
    locateParcel(pid, core.meta).then((hit) => {
      if (hit) onSearchPick({ kind: 'parcel', pid, lon: hit.lon, lat: hit.lat, unit: initialUrl.unit })
    })
  }, [core, mapReady, onSearchPick])

  const onSelectDistrict = useCallback(
    (id: string, label?: string) => {
      const g = groups.get(id)
      if (!g) return
      fitNext.current = true
      if (!core) return
      setSelection(selectionForDistrict(g, core.meta, label ?? presets.find((p) => p.id === id)?.label))
    },
    [groups, presets, core],
  )

  const onCustom = useCallback((features: AreaFeature[], label: string, append: boolean) => {
    if (!core) return
    setSelection((cur) => {
      const prev = append && cur?.kind === 'custom' ? cur.features : []
      const all = [...prev, ...features]
      fitNext.current = !append
      return {
        key: 'custom',
        kind: 'custom',
        label: append && prev.length ? `Drawn area (${all.length} shapes)` : label,
        features: all,
        counties: countiesForShapes(all, core.meta),
      }
    })
  }, [core])

  const onDraw = useCallback(
    (kind: 'polygon' | 'rectangle' | null) => {
      const c = ctrl.current
      if (!c) return
      if (!kind) {
        c.stopDraw()
        setDrawing(null)
        return
      }
      setDrawing(kind)
      setPick(null)
      c.startDraw(kind, (f) => {
        setDrawing(null)
        if (f) onCustom([f], kind === 'rectangle' ? 'Drawn rectangle' : 'Drawn polygon', true)
      })
    },
    [onCustom],
  )

  const onShowAdded = (on: boolean) => setMode(on ? 'added' : 'tax')

  if (coreErr) {
    return (
      <div className="splash">
        <div className="splash-card">
          <h1>Couldn't load the data</h1>
          <p className="mono small">{coreErr}</p>
          <p className="muted">The data files in <code>/data/</code> may not be published yet.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <a className="home-link" href="https://egge.us" title="Back to egge.us" aria-label="egge.us">
            <img className="brand-mark" src="/favicon-monogram.svg" width="30" height="30" alt="" />
            <span>egge.us</span>
          </a>
          <span className="brand-sep" aria-hidden>/</span>
          <div className="brand-title">
            <h1>Montana Mill Levy Calculator</h1>
            <p className="scope">
              Gallatin &amp; Yellowstone Counties, MT · General property taxes only · special assessments excluded ·{' '}
              {core ? <>DOR ORION data as of {core.meta.vintages.orion ?? core.meta.generated}</> : 'loading…'}{' '}
              <button className="linkish" onClick={() => setAbout(true)}>Methods &amp; caveats</button>
            </p>
          </div>
        </div>
        {core && <SearchBox meta={core.meta} onPick={onSearchPick} />}
        <div className="top-controls">
          {core && (
            <div className="seg county-switch" role="group" aria-label="Fly to county">
              {Object.entries(core.meta.counties).map(([slug, c]) => (
                <button
                  key={slug}
                  className={viewCounty === slug ? 'on' : ''}
                  onClick={() => ctrl.current?.flyTo(COUNTY_VIEWS[slug] ?? { center: [(c.bbox[0] + c.bbox[2]) / 2, (c.bbox[1] + c.bbox[3]) / 2], zoom: 10 })}
                  title={`Fly to ${c.name}`}
                >
                  {c.name.replace(/ County$/, '')}
                </button>
              ))}
            </div>
          )}
          <label className="select">
            <span>Color by</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as ColorMode)}>
              {COLOR_MODES.map((m) => (
                <option key={m.id} value={m.id} disabled={m.id === 'added' && !base}>{m.short}</option>
              ))}
            </select>
          </label>
          <YearToggle year={year} onYear={setYear} />
          <label className="toggle" title="Show 3D building footprints">
            <input type="checkbox" checked={buildings} onChange={(e) => setBuildings(e.target.checked)} />
            <span>3D</span>
          </label>
          <button className="btn ghost about-btn" onClick={() => setAbout(true)}>About</button>
        </div>
      </header>

      <main className={`stage ${pick ? 'has-pick' : ''}`}>
        <div ref={mapEl} className="map" />
        {core && (
          <aside className="calc-panel">
            <Calculator
              idx={idx}
              progress={loadProgress}
              loadingLabel={loadingCounties.map((c) => core.meta.counties[c]?.name ?? c).join(' and ')}
              levies={core.levies}
              meta={core.meta}
              year={year}
              onYear={setYear}
              groups={groups}
              presets={presets}
              selection={selection}
              onSelectDistrict={onSelectDistrict}
              onCustom={onCustom}
              rows={rows}
              base={base}
              mills={mills}
              onMills={setMills}
              drawing={drawing}
              onDraw={onDraw}
              showingAdded={mode === 'added'}
              onShowAdded={onShowAdded}
              collapsed={collapsed}
              onCollapse={setCollapsed}
            />
          </aside>
        )}
        {core && pick && (
          <aside className="prop-panel" aria-label="Property details">
            <PropertyPanel pick={pick} year={year} levies={core.levies} meta={core.meta} onYear={setYear} onClose={() => setPick(null)} />
          </aside>
        )}
        {core && (
          <Legend mode={mode} meta={core.meta} addedBreaks={addedBreaks} mills={mills} year={year} selectionLabel={selection?.label} />
        )}
        {!core && (
          <div className="splash overlay">
            <div className="splash-card">
              <div className="spinner" />
              <p>Loading property tax data…</p>
            </div>
          </div>
        )}
      </main>
      {about && core && <About meta={core.meta} onClose={() => setAbout(false)} />}
    </div>
  )
}
