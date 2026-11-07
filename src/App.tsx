import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Calculator from './calc/Calculator'
import { groupDistricts, resolvePresets, selectionForDistrict } from './calc/districts'
import { COUNTY_ID } from './calc/select'
import { selectProperties, type AreaFeature, type Selection } from './calc/select'
import { computeBase, taxableBreaks } from './calc/stats'
import { loadCondos, loadCore, loadIndex, type CoreData } from './data/load'
import type { Condos, PropIndex, Year } from './data/types'
import { MapController, type PickEvent, type ViewState } from './map/controller'
import { COLOR_MODES, type ColorMode } from './map/style'
import PropertyPanel, { YearToggle } from './panel/PropertyPanel'
import About from './ui/About'
import Legend from './ui/Legend'
import { readUrl, writeUrl } from './urlState'

const initialUrl = readUrl()

export default function App() {
  const [core, setCore] = useState<CoreData | null>(null)
  const [coreErr, setCoreErr] = useState<string | null>(null)
  const [idx, setIdx] = useState<PropIndex | null>(null)
  const [progress, setProgress] = useState(0)
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
      // Initial district from the URL, else the whole county.
      const gs = groupDistricts(c.districts)
      const g = gs.get(initialUrl.district ?? COUNTY_ID) ?? gs.get(COUNTY_ID)
      if (g) setSelection(selectionForDistrict(g, resolvePresets(gs).find((p) => p.id === g.id)?.label))
    }, (e: Error) => setCoreErr(e.message))
    loadIndex(setProgress).then(
      (i) => {
        setIdx(i)
        loadCondos().then(setCondos, () => console.warn('condos.json failed to load; condo unit counts unavailable'))
      },
      (e: Error) => setCoreErr(e.message),
    )
  }, [])

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
      onMove: (v: ViewState) => writeUrl({ view: v }),
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
    ctrl.current.setArea(selection.all ? [] : selection.features, fitNext.current)
    fitNext.current = false
  }, [selection, mapReady])

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

  const onSelectDistrict = useCallback(
    (id: string, label?: string) => {
      const g = groups.get(id)
      if (!g) return
      fitNext.current = true
      setSelection(selectionForDistrict(g, label ?? presets.find((p) => p.id === id)?.label))
    },
    [groups, presets],
  )

  const onCustom = useCallback((features: AreaFeature[], label: string, append: boolean) => {
    setSelection((cur) => {
      const prev = append && cur?.kind === 'custom' ? cur.features : []
      const all = [...prev, ...features]
      fitNext.current = !append
      return { key: 'custom', kind: 'custom', label: append && prev.length ? `Drawn area (${all.length} shapes)` : label, features: all }
    })
  }, [])

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
              Gallatin County, MT · General property taxes only · special assessments excluded ·{' '}
              {core ? <>DOR ORION data as of {core.meta.vintages.orion ?? core.meta.generated}</> : 'loading…'}{' '}
              <button className="linkish" onClick={() => setAbout(true)}>Methods &amp; caveats</button>
            </p>
          </div>
        </div>
        <div className="top-controls">
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
              progress={progress}
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
            <PropertyPanel pick={pick} year={year} levies={core.levies} onYear={setYear} onClose={() => setPick(null)} />
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
