import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import type { Levies, Meta, PropIndex, Year } from '../data/types'
import { CAT_LABEL } from '../data/types'
import { fmtInt, fmtPct, fmtUSD, fmtUSD2, fmtUSDShort } from '../format'
import { YearToggle } from '../panel/PropertyPanel'
import { TYPE_LABEL, type DistrictGroup, type Preset } from './districts'
import type { AreaFeature, Selection } from './select'
import { EXAMPLE_HOME_MARKET, EXAMPLE_HOME_TAXABLE, residentialDistribution, type BaseStats } from './stats'
import { parseUpload, type UploadedShape } from './upload'

const Histogram = lazy(() => import('./Histogram'))

const MILL_PRESETS = [1, 2, 5, 10, 15, 20]

const SPLIT_COLORS = {
  homestead: '#d25e3d',
  nonhomestead: '#eeb56a',
  residential: '#e48a4f',
  commercial: '#225f82',
  multifamily: '#5aabad',
  ag: '#8a9a5b',
  other: '#b9b4a8',
} as const
const SPLIT_LABEL: Record<keyof typeof SPLIT_COLORS, string> = {
  homestead: 'Homestead residential',
  nonhomestead: 'Non-homestead residential',
  residential: 'Residential',
  commercial: 'Commercial / industrial',
  multifamily: 'Multifamily',
  ag: 'Agricultural',
  other: 'Other / centrally assessed',
}

interface Props {
  idx: PropIndex | null
  progress: number
  levies: Levies
  meta: Meta
  year: Year
  onYear: (y: Year) => void
  groups: Map<string, DistrictGroup>
  presets: Preset[]
  selection: Selection | null
  onSelectDistrict: (id: string, label?: string) => void
  onCustom: (features: AreaFeature[], label: string, append: boolean) => void
  rows: Int32Array | null
  base: BaseStats | null
  mills: number
  onMills: (m: number) => void
  drawing: 'polygon' | 'rectangle' | null
  onDraw: (kind: 'polygon' | 'rectangle' | null) => void
  showingAdded: boolean
  onShowAdded: (on: boolean) => void
  collapsed: boolean
  onCollapse: (c: boolean) => void
}

export default function Calculator(props: Props) {
  const { idx, progress, levies, year, base, mills, selection, collapsed } = props
  const revenue = base ? base.millValue * mills : NaN

  return (
    <div className={`calc ${collapsed ? 'is-collapsed' : ''}`}>
      <button className="calc-head" onClick={() => props.onCollapse(!collapsed)} aria-expanded={!collapsed}>
        <div>
          <div className="kicker">Mill levy calculator</div>
          <div className="calc-head-line">
            <b>{selection?.label ?? 'Choose an area'}</b>
            <span className="mono">{mills.toFixed(mills % 1 ? 2 : 0)} mills</span>
            {base && <span className="mono accent">{fmtUSDShort(revenue)}/yr</span>}
          </div>
        </div>
        <span className="chev" aria-hidden>{collapsed ? '▴' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="calc-body">
          <DistrictPicker {...props} />
          <MillInput mills={mills} onMills={props.onMills} millValue={base?.millValue ?? 0} />
          {!idx && (
            <div className="loading-inline">
              <div className="bar"><div style={{ width: progress >= 0 ? `${Math.round(progress * 100)}%` : '40%' }} className={progress < 0 ? 'indeterminate' : ''} /></div>
              Loading property records…
            </div>
          )}
          {idx && base && selection && <Outputs {...props} base={base} idx={idx} levies={levies} year={year} />}
        </div>
      )}
    </div>
  )
}

function DistrictPicker({ groups, presets, selection, onSelectDistrict, onCustom, drawing, onDraw }: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [upload, setUpload] = useState<{ file: string; shapes: UploadedShape[]; on: boolean[] } | null>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...groups.values()]
      .filter((g) => !needle || g.name.toLowerCase().includes(needle) || (TYPE_LABEL[g.type] ?? g.type).toLowerCase().includes(needle))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : (TYPE_LABEL[a.type] ?? a.type).localeCompare(TYPE_LABEL[b.type] ?? b.type)))
  }, [groups, q])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setUploadErr(null)
    try {
      const shapes = await parseUpload(file)
      const on = shapes.map(() => true)
      setUpload({ file: file.name, shapes, on })
      setFilter('')
      onCustom(shapes.map((s) => s.feature), file.name, false)
    } catch (e) {
      setUploadErr((e as Error).message)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const applyUpload = (on: boolean[]) => {
    if (!upload) return
    setUpload({ ...upload, on })
    const feats = upload.shapes.filter((_, i) => on[i]).map((s) => s.feature)
    const n = feats.length
    onCustom(feats, n === 1 ? upload.shapes[on.indexOf(true)].name : `${upload.file} (${n} shapes)`, false)
  }

  return (
    <section className="picker">
      <div className="label">Area</div>
      <div className="chips">
        {presets.map((p) => (
          <button key={p.id} className={`chip ${selection?.key === p.id ? 'on' : ''}`} onClick={() => onSelectDistrict(p.id, p.label)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="picker-row">
        <div className="combo">
          <input
            type="search"
            placeholder={`Search ${groups.size} boundaries…`}
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            aria-label="Search district boundaries"
          />
          {open && (
            <ul className="combo-list" role="listbox">
              {list.slice(0, 80).map((g) => (
                <li key={g.id}>
                  <button onMouseDown={(e) => e.preventDefault()} onClick={() => { onSelectDistrict(g.id); setOpen(false); setQ('') }}>
                    <span>{g.name}</span>
                    <small>{TYPE_LABEL[g.type] ?? g.type}</small>
                  </button>
                </li>
              ))}
              {!list.length && <li className="muted small pad">No matches</li>}
            </ul>
          )}
        </div>
      </div>
      <div className="picker-row tools">
        <button className={`tool ${drawing === 'rectangle' ? 'on' : ''}`} onClick={() => onDraw(drawing === 'rectangle' ? null : 'rectangle')} title="Drag a rectangle on the map">
          <svg viewBox="0 0 16 16" aria-hidden><rect x="2.5" y="3.5" width="11" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.5" /></svg>
          Rectangle
        </button>
        <button className={`tool ${drawing === 'polygon' ? 'on' : ''}`} onClick={() => onDraw(drawing === 'polygon' ? null : 'polygon')} title="Click vertices; click the first point to finish">
          <svg viewBox="0 0 16 16" aria-hidden><path d="M3 12 L2.5 5 L8 2.5 L13.5 6 L11 13 Z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          Polygon
        </button>
        <button className="tool" onClick={() => fileRef.current?.click()} title="Zipped shapefile or GeoJSON">
          <svg viewBox="0 0 16 16" aria-hidden><path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
          Upload
        </button>
        <input ref={fileRef} type="file" accept=".zip,.geojson,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      {drawing && (
        <p className="hint">
          {drawing === 'rectangle' ? 'Click two opposite corners on the map.' : 'Click to add points; click the first point to close.'}
          {selection?.kind === 'custom' && ' New shapes are added to the current custom area.'}
          {' '}<button className="linkish" onClick={() => onDraw(null)}>Cancel</button>
        </p>
      )}
      {uploadErr && <p className="error">{uploadErr}</p>}
      {upload && selection?.kind === 'custom' && upload.shapes.length > 1 && (
        <details className="upload-list">
          <summary>{upload.on.filter(Boolean).length} of {upload.shapes.length} shapes from {upload.file}</summary>
          <div className="upload-tools">
            <input type="search" placeholder="Filter shapes…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="linkish" onClick={() => applyUpload(upload.shapes.map((s, i) => (s.name.toLowerCase().includes(filter.toLowerCase()) ? true : upload.on[i])))}>all</button>
            <button className="linkish" onClick={() => applyUpload(upload.shapes.map((s, i) => (s.name.toLowerCase().includes(filter.toLowerCase()) ? false : upload.on[i])))}>none</button>
          </div>
          <ul>
            {upload.shapes.map((s, i) =>
              !filter || s.name.toLowerCase().includes(filter.toLowerCase()) ? (
                <li key={i}>
                  <label>
                    <input type="checkbox" checked={upload.on[i]} onChange={() => applyUpload(upload.on.map((v, j) => (j === i ? !v : v)))} />
                    {s.name}
                  </label>
                </li>
              ) : null,
            )}
          </ul>
        </details>
      )}
    </section>
  )
}

function MillInput({ mills, onMills, millValue }: { mills: number; onMills: (m: number) => void; millValue: number }) {
  const [mode, setMode] = useState<'mills' | 'dollars'>('mills')
  const [dollars, setDollars] = useState('')
  const clamp = (v: number) => Math.max(0, Math.min(500, Math.round(v * 1000) / 1000))
  return (
    <section className="mills">
      <div className="mills-head">
        <div className="label">Levy</div>
        <div className="seg small" role="group" aria-label="Input mode">
          <button className={mode === 'mills' ? 'on' : ''} onClick={() => setMode('mills')}>Mills</button>
          <button className={mode === 'dollars' ? 'on' : ''} onClick={() => setMode('dollars')}>Dollar target</button>
        </div>
      </div>
      {mode === 'mills' ? (
        <>
          <div className="mills-row">
            <input
              type="range" min={0} max={50} step={0.1} value={Math.min(50, mills)}
              onChange={(e) => onMills(clamp(Number(e.target.value)))}
              aria-label="Mills"
              style={{ ['--pct' as string]: `${(Math.min(50, mills) / 50) * 100}%` }}
            />
            <label className="num-field">
              <input type="number" min={0} step={0.1} value={Number(mills.toFixed(3))} onChange={(e) => onMills(clamp(Number(e.target.value) || 0))} aria-label="Mills (number)" />
              <span>mills</span>
            </label>
          </div>
          <div className="chips tight">
            {MILL_PRESETS.map((m) => (
              <button key={m} className={`chip ${mills === m ? 'on' : ''}`} onClick={() => onMills(m)}>{m}</button>
            ))}
          </div>
        </>
      ) : (
        <div className="dollar-mode">
          <label className="num-field wide">
            <span>$</span>
            <input
              type="number" min={0} step={10000} placeholder="e.g. 5000000" value={dollars}
              onChange={(e) => {
                setDollars(e.target.value)
                const d = Number(e.target.value)
                if (millValue > 0 && d >= 0) onMills(clamp(d / millValue))
              }}
              aria-label="Annual dollar target"
            />
            <span>/ yr</span>
          </label>
          <p className="small muted">
            = <b className="mono">{mills.toFixed(3)} mills</b> at {fmtUSD(millValue)} per mill.
          </p>
        </div>
      )}
    </section>
  )
}

function Outputs(p: Props & { base: BaseStats; idx: PropIndex }) {
  const { base, mills, year, rows, idx, levies, selection } = p
  const scale = mills / 1000
  const dist = useMemo(() => residentialDistribution(base.resTaxable), [base])
  const revenue = base.millValue * mills
  const [copied, setCopied] = useState(false)

  const splitEntries = (Object.keys(SPLIT_COLORS) as (keyof typeof SPLIT_COLORS)[])
    .map((k) => ({ k, v: base.byCat[k] }))
    .filter((e) => e.v > 0)
  const resShare = base.taxable ? (base.byCat.homestead + base.byCat.nonhomestead + base.byCat.residential) / base.taxable : 0
  const commShare = base.taxable ? base.byCat.commercial / base.taxable : 0
  const cityShare = base.taxable ? base.cityTaxable / base.taxable : 0

  const summary = () =>
    [
      `${selection?.label}: ${mills} mills, TY${year} taxable values`,
      `Value of a mill (mapped real property): ${fmtUSD(base.millValue)}${base.tifIncrement > 0 ? `; net of est. TIF increment ${fmtUSD((base.taxable - base.tifIncrement) / 1000)}` : ''}`,
      `Revenue at ${mills} mills: ${fmtUSD(revenue)} per year`,
      `${fmtInt(base.nProps)} properties on ${fmtInt(base.nParcels)} parcels${base.condoUnits ? ` (${fmtInt(base.condoUnits)} condo units)` : ''}, ~${fmtInt(base.households)} households`,
      `Added cost per residential property: median ${fmtUSD2(dist.median * scale)}, P25 ${fmtUSD2(dist.p25 * scale)}, P75 ${fmtUSD2(dist.p75 * scale)}, P90 ${fmtUSD2(dist.p90 * scale)}, mean ${fmtUSD2(dist.mean * scale)}`,
      `A $378,000 homestead pays ${fmtUSD2(EXAMPLE_HOME_TAXABLE * scale)} per year`,
      `Revenue share: residential ${fmtPct(resShare)}, commercial ${fmtPct(commShare)}; incorporated cities ${fmtPct(cityShare)}`,
      'General property taxes only. Source: Montana DOR ORION; Gallatin County.',
    ].join('\n')

  const copy = () => navigator.clipboard?.writeText(summary()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => {})

  const downloadCsv = () => {
    if (!rows) return
    const tv = idx.tv[year]
    const tax = idx.tax[year]
    const cat = idx.cat[year]
    const lines = [`pid,levy_district,category,taxable_value_${year},current_tax_${year},added_tax_${mills}_mills`]
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k]
      const L = idx.levy[i]
      lines.push([idx.pid[i] ?? '', L >= 0 ? levies.codes[L] : '', `"${CAT_LABEL[cat[i]] ?? ''}"`, tv[i], tax[i].toFixed(2), (tv[i] * scale).toFixed(2)].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `mill-levy-${(selection?.key ?? 'area').replace(/[^\w-]+/g, '_')}-${mills}mills-TY${year}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  if (!base.nProps) {
    return <p className="note">No properties fall inside this area. Try a larger shape, or check that it overlaps Gallatin County.</p>
  }

  return (
    <div className="outputs">
      <div className="out-year">
        <span className="small muted">Using TY{year} certified taxable values</span>
        <YearToggle year={year} onYear={p.onYear} />
      </div>

      <section className="headline">
        <div>
          <div className="label">Revenue at {mills} mills</div>
          <div className="hero-num">{fmtUSD(revenue)}<small>/yr</small></div>
        </div>
        <div>
          <div className="label">Value of a mill</div>
          <div className="mid-num mono">{fmtUSD(base.millValue)}</div>
          <div className="small muted">mapped real property · base {fmtUSDShort(base.taxable)}</div>
        </div>
      </section>

      <BaseAdjustments base={base} mills={mills} meta={p.meta} year={year} selectionKey={selection?.key} />

      <section className="counts">
        <div><b>{fmtInt(base.nProps)}</b><span>properties</span></div>
        <div><b>{fmtInt(base.nParcels)}</b><span>parcels</span></div>
        <div><b>{base.condoUnits == null ? '…' : fmtInt(base.condoUnits)}</b><span>condo units</span></div>
        <div><b>{fmtInt(base.households)}</b><span>households (est.)</span></div>
      </section>
      {base.nUnmapped > 0 && (
        <p className="small muted">Includes {fmtInt(base.nUnmapped)} properties with no mapped parcel (counted only in the county-wide total).</p>
      )}

      <section className="examples">
        <div className="ex">
          <div className="ex-amt mono">{fmtUSD2(EXAMPLE_HOME_TAXABLE * scale)}<small>/yr</small></div>
          <div className="ex-txt">A ${fmtInt(EXAMPLE_HOME_MARKET)} homestead (taxable {fmtUSD(EXAMPLE_HOME_TAXABLE)}, the statewide median home)</div>
        </div>
        {dist.n > 0 && (
          <div className="ex">
            <div className="ex-amt mono">{fmtUSD2(dist.median * scale)}<small>/yr</small></div>
            <div className="ex-txt">Median residential property in this area (taxable value {fmtUSD(dist.median)})</div>
          </div>
        )}
      </section>

      {dist.n > 0 && (
        <section>
          <h3>Added cost per residential property</h3>
          <table className="stats-table">
            <tbody>
              <tr>
                <th>P25</th><th>Median</th><th>P75</th><th>P90</th><th>Mean</th><th>Max</th>
              </tr>
              <tr className="mono">
                <td>{fmtUSD(dist.p25 * scale)}</td>
                <td><b>{fmtUSD(dist.median * scale)}</b></td>
                <td>{fmtUSD(dist.p75 * scale)}</td>
                <td>{fmtUSD(dist.p90 * scale)}</td>
                <td>{fmtUSD(dist.mean * scale)}</td>
                <td>{fmtUSD(dist.max * scale)}</td>
              </tr>
            </tbody>
          </table>
          <Suspense fallback={<div className="chart" style={{ height: 150 }} />}>
            <Histogram bins={dist.bins} scale={scale} median={dist.median} />
          </Suspense>
          <p className="small muted">{fmtInt(dist.n)} residential properties with taxable value; histogram clipped at the 99th percentile; dark bar holds the median.</p>
        </section>
      )}

      <section>
        <h3>Taxable base by property type</h3>
        <div className="stack-bar">
          {splitEntries.map((e) => (
            <div key={e.k} style={{ width: `${(e.v / base.taxable) * 100}%`, background: SPLIT_COLORS[e.k] }} title={`${SPLIT_LABEL[e.k]} ${fmtPct(e.v / base.taxable)}`} />
          ))}
        </div>
        <table className="split-table">
          <tbody>
            {splitEntries.map((e) => (
              <tr key={e.k}>
                <td><i style={{ background: SPLIT_COLORS[e.k] }} />{SPLIT_LABEL[e.k]}</td>
                <td className="r mono">{fmtPct(e.v / base.taxable)}</td>
                <td className="r mono">{fmtUSDShort(e.v * scale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="kv-row">
          <span>Residential share of revenue <b className="mono">{fmtPct(resShare)}</b></span>
          <span>Commercial <b className="mono">{fmtPct(commShare)}</b></span>
        </div>
        <div className="kv-row">
          <span>Incorporated cities <b className="mono">{fmtPct(cityShare)}</b> · {fmtUSDShort(base.cityTaxable * scale)}</span>
          <span>Unincorporated <b className="mono">{fmtPct(1 - cityShare)}</b> · {fmtUSDShort(base.ruralTaxable * scale)}</span>
        </div>
      </section>

      <section className="actions">
        <button className={`btn ${p.showingAdded ? 'on' : 'primary'}`} onClick={() => p.onShowAdded(!p.showingAdded)}>
          {p.showingAdded ? 'Showing added tax on map' : 'Map the added tax'}
        </button>
        <button className="btn" onClick={downloadCsv}>Download CSV</button>
        <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy summary'}</button>
      </section>

      <StatuteNote />
    </div>
  )
}

const NON_REAL_KEY: Record<string, string> = { 'city-bozeman': 'BOZEMAN', 'city-belgrade': 'BELGRAD' }

function BaseAdjustments({ base, mills, meta, year, selectionKey }: { base: BaseStats; mills: number; meta: Meta; year: Year; selectionKey?: string }) {
  const nrKey = (selectionKey && NON_REAL_KEY[selectionKey]) || 'CNTYWID'
  const nr = meta.non_real?.[year]?.[nrKey]
  const netTaxable = base.taxable - base.tifIncrement
  if (base.tifIncrement <= 0 && !nr) return null
  return (
    <section className="adjust">
      <div className="label">Levy base adjustments</div>
      <table className="adjust-table">
        <thead>
          <tr><th /><th className="r">per mill</th><th className="r">at {mills} mills</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Mapped real property</td>
            <td className="r mono">{fmtUSD(base.millValue)}</td>
            <td className="r mono">{fmtUSDShort(base.millValue * mills)}</td>
          </tr>
          {base.tifIncrement > 0 && (
            <>
              <tr className="minus">
                <td>Less est. TIF increment <span className="muted">({fmtUSDShort(base.tifIncrement)} taxable)</span></td>
                <td className="r mono">−{fmtUSD(base.tifIncrement / 1000)}</td>
                <td className="r mono">−{fmtUSDShort((base.tifIncrement / 1000) * mills)}</td>
              </tr>
              <tr className="net">
                <td>Net to the levying district</td>
                <td className="r mono">{fmtUSD(netTaxable / 1000)}</td>
                <td className="r mono">{fmtUSDShort((netTaxable / 1000) * mills)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      {base.tifIncrement > 0 && (
        <p className="small muted">Mills levied on a TIF district's increment go to the TIF (Bozeman, Belgrade urban renewal districts), not to the levying district.</p>
      )}
      {nr && (
        <p className="small muted">
          Not mapped: personal property and centrally assessed utilities and railroads would add roughly <b>{fmtPct(nr.non_real_ratio)}</b> to the base
          ({nrKey === 'CNTYWID' ? 'county-wide' : nrKey === 'BOZEMAN' ? 'City of Bozeman' : 'City of Belgrade'} DOR certified TY{year}), about {fmtUSD(netTaxable / 1000 * nr.non_real_ratio)} per mill here.
        </p>
      )}
    </section>
  )
}

function StatuteNote() {
  return (
    <details className="statute">
      <summary>What limits the mills? (statute)</summary>
      <p>
        <b>Existing levies</b> are capped by{' '}
        <a href="https://mca.legmt.gov/bills/mca/title_0150/chapter_0100/part_0040/section_0200/0150-0100-0040-0200.html" target="_blank" rel="noreferrer">MCA 15-10-420</a>:
        a jurisdiction may levy enough mills to raise last year's property-tax revenue plus an inflation allowance (capped at 4%), computed without
        newly taxable property. Those mills then apply to all property. Unused authority can be carried forward. Judgment, emergency and some school
        levies are excluded.
      </p>
      <p>
        <b>New voted levies</b> must be stated in dollars, not mills, under HB 20 (2025), so the mill rate changes with taxable value. The calculator
        shows the arithmetic (revenue = value of a mill × mills) and does not compute 15-10-420 limits.
      </p>
    </details>
  )
}

