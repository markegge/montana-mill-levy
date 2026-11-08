import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { loadCondos } from '../data/load'
import { CAT_LABEL, type CondoUnit, type Condos, type Meta, type Levies, type ParcelProps, type Year } from '../data/types'
import { fmtInt, fmtMills, fmtPct, fmtUSD, fmtUSD2 } from '../format'
import type { PickEvent } from '../map/controller'
import { yf } from '../map/style'
import { computeBreakdown, formatGeocode, LAND_COLOR, num, STRUCT_COLOR } from './breakdown'

const BreakdownChart = lazy(() => import('./BreakdownChart'))

export const CAVEAT =
  'General property taxes only. Special assessments and fees (SIDs/RIDs, water/sewer, street maintenance) and overlay mills (conservation, open space bond, zoning) are excluded. Source: Montana DOR ORION; Gallatin and Yellowstone County Treasurers.'

const DOR_SEARCH = 'https://svc.mt.gov/dor/oriondataportal/Public/PropertyMTGov/PropertySearch.aspx'

function badgeFor(p: ParcelProps, year: Year, tax: number): { label: string; cls: string } {
  if (tax <= 0) return { label: 'Exempt / non-valued', cls: 'b-exempt' }
  const c = num(p.cat)
  if (year === '2025' && (c === 1 || c === 2)) return { label: 'Residential', cls: 'b-res' }
  switch (c) {
    case 1: return { label: 'Homestead', cls: 'b-home' }
    case 2: return { label: 'Non-homestead · 1.9%', cls: 'b-nonhome' }
    case 3: return { label: 'Residential', cls: 'b-res' }
    case 4: return { label: 'Commercial', cls: 'b-comm' }
    case 5: return { label: 'Multifamily', cls: 'b-comm' }
    case 6: return { label: 'Agricultural', cls: 'b-ag' }
    default: return { label: CAT_LABEL[c] ?? 'Other', cls: 'b-exempt' }
  }
}

interface Props {
  pick: PickEvent
  year: Year
  levies: Levies
  meta: Meta
  onYear: (y: Year) => void
  onClose: () => void
}

export default function PropertyPanel({ pick, year, levies, meta, onYear, onClose }: Props) {
  const p = pick.parcel
  if (!p) {
    return (
      <div className="panel-body">
        <PanelHead title="Parcel" onClose={onClose} />
        <p className="muted">Parcel {formatGeocode(pick.pid)} isn't in the loaded map tiles. Zoom in on it and click again.</p>
      </div>
    )
  }
  return <ParcelDetail p={p} building={pick.building} unit={pick.unit} year={year} levies={levies} billUrl={billUrlFor(meta, p.pid)} onYear={onYear} onClose={onClose} />
}

function PanelHead({ title, onClose, children }: { title: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <header className="pp-head">
      <div className="pp-title">
        <div className="kicker">Property</div>
        <h2>{title}</h2>
        {children}
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="Close property panel">×</button>
    </header>
  )
}

/** The county's tax-statement URL builder, picked by the geocode's DOR county code (06 Gallatin, 03 Yellowstone). */
function billUrlFor(meta: Meta, pid: string): ((ac: string, year: Year) => string) | null {
  const county = Object.values(meta.counties).find((c) => pid.startsWith(c.dor_code))
  if (!county?.bill_url) return null
  return (ac, year) => county.bill_url.replace('{ac}', encodeURIComponent(ac)).replace('{year}', year)
}

function ParcelDetail({ p, building, unit, year, levies, billUrl, onYear, onClose }: {
  p: ParcelProps; building: Record<string, unknown> | null; unit?: string; year: Year; levies: Levies
  billUrl: ((ac: string, year: Year) => string) | null; onYear: (y: Year) => void; onClose: () => void
}) {
  const bd = useMemo(() => computeBreakdown(p, year, levies), [p, year, levies])
  const f = (base: string) => num(p[yf(base, year)])
  const levy = (p.levy as string) || ''
  const district = levy ? levies.districts[levy] : undefined
  const ac = (p.ac as string) || ''
  const badge = badgeFor(p, year, bd.tax)
  const mkt = f('mkt')
  const tv = f('tv')
  const nUnits = num(p.n_units)
  const geocode = formatGeocode(p.pid)
  const [copied, setCopied] = useState(false)

  const copyGeocode = () => {
    navigator.clipboard?.writeText(geocode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }, () => {})
  }

  const structShare = bd.tax > 0 ? bd.taxBldg / bd.tax : 0

  return (
    <div className="panel-body">
      <PanelHead title={(p.addr as string) || 'No situs address'} onClose={onClose}>
        <div className="pp-meta">
          <span className={`badge ${badge.cls}`}>{badge.label}</span>
          <span className="mono small">{geocode}</span>
        </div>
      </PanelHead>

      <div className="pp-levy">
        <div>
          <div className="label">Levy district</div>
          <div className="mono">{levy || '—'}</div>
          {district && <div className="small">{district.name} · {district.city_rural === 'City' ? 'Incorporated' : 'Unincorporated'}</div>}
        </div>
        <YearToggle year={year} onYear={onYear} />
      </div>

      <section className="pp-hero">
        <div>
          <div className="label">TY{year} general property tax</div>
          <div className="hero-num">{fmtUSD2(bd.tax)}</div>
        </div>
        <div className="hero-side">
          <div><span className="label">Mills</span> <b className="mono">{fmtMills(f('mills'))}</b></div>
          <div><span className="label">Per $1k market</span> <b className="mono">{f('eff') ? `$${f('eff').toFixed(2)}` : '—'}</b></div>
        </div>
      </section>

      {building && <BuildingNote b={building} year={year} />}

      {bd.tax > 0 && (
        <section>
          <div className="share-bar" role="img" aria-label={`Land ${fmtPct(1 - structShare, 0)}, structures ${fmtPct(structShare, 0)}`}>
            <div style={{ width: `${(1 - structShare) * 100}%`, background: LAND_COLOR }} />
            <div style={{ width: `${structShare * 100}%`, background: STRUCT_COLOR }} />
          </div>
          <div className="share-legend">
            <span><i style={{ background: LAND_COLOR }} /> Land {fmtUSD(bd.taxLand)} · {fmtPct(1 - structShare, 0)}</span>
            <span><i style={{ background: STRUCT_COLOR }} /> Structures {fmtUSD(bd.taxBldg)} · {fmtPct(structShare, 0)}</span>
          </div>
        </section>
      )}

      <section>
        <table className="values">
          <thead>
            <tr><th /><th>Land</th><th>Structures</th><th>Total</th></tr>
          </thead>
          <tbody>
            <tr><th>Market value</th><td>{fmtUSD(f('mkt_l'))}</td><td>{fmtUSD(f('mkt_b'))}</td><td>{fmtUSD(mkt)}</td></tr>
            <tr><th>Taxable value</th><td>{fmtUSD(f('tv_l'))}</td><td>{fmtUSD(f('tv_b'))}</td><td>{fmtUSD(tv)}</td></tr>
            <tr><th>Tax</th><td>{fmtUSD(bd.taxLand)}</td><td>{fmtUSD(bd.taxBldg)}</td><td><b>{fmtUSD(bd.tax)}</b></td></tr>
          </tbody>
        </table>
        <div className="kv-row">
          <span>Effective class rate <b className="mono">{mkt > 0 ? fmtPct(tv / mkt, 3) : '—'}</b></span>
          {num(p.acres) > 0 && <span>{num(p.acres).toFixed(2)} acres</span>}
          {num(p.n_props) > 1 && <span>{fmtInt(num(p.n_props))} ORION properties</span>}
        </div>
      </section>

      {bd.groups && bd.tax > 0 && (
        <section>
          <h3>Who levies it</h3>
          <Suspense fallback={<div className="chart" style={{ height: 34 + bd.groups.length * 30 }} />}>
            <BreakdownChart groups={bd.groups} />
          </Suspense>
          {bd.estimated && <p className="note">TY{year} component mills for this district are estimated (scaled from TY2025); the total is exact.</p>}
        </section>
      )}

      {bd.lines && bd.tax > 0 && (
        <section>
          <h3>Levy line items</h3>
          <div className="table-scroll">
            <table className="lines">
              <thead><tr><th>Levy</th><th className="r">Mills</th><th className="r">Tax</th></tr></thead>
              <tbody>
                {bd.lines.map((l, i) => {
                  const first = i === 0 || bd.lines![i - 1].group !== l.group
                  return (
                    <tr key={i} className={first ? 'group-start' : ''}>
                      <td>{first && <span className="grp">{l.group}</span>}{l.name}</td>
                      <td className="r mono">{l.mills.toFixed(2)}</td>
                      <td className="r mono">{fmtUSD2(l.amount)}</td>
                    </tr>
                  )
                })}
                {Math.abs(bd.residual) >= 0.005 && (
                  <tr className="residual">
                    <td>Rounding (line mills vs. certified total)</td>
                    <td className="r mono" />
                    <td className="r mono">{fmtUSD2(bd.residual)}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr><td>Total</td><td className="r mono">{fmtMills(bd.levyTotal)}</td><td className="r mono">{fmtUSD2(bd.tax)}</td></tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
      {bd.lines && bd.tax > 0 && bd.levyTotal != null && Math.abs(f('mills') - bd.levyTotal) > 0.05 && (
        <p className="note">
          This property was billed at {fmtMills(f('mills'))} mills, not the district's {fmtMills(bd.levyTotal)} (mobile homes on others' land are
          billed on the prior year's mills). Line items are scaled to the actual tax.
        </p>
      )}
      {!bd.lines && bd.tax > 0 && <p className="note">No component mill breakdown is available for this levy district in TY{year}; the total above is exact.</p>}

      {nUnits > 0 && <CondoUnits pid={p.pid} n={nUnits} year={year} billUrl={billUrl} highlight={unit} />}

      <section className="pp-links">
        {ac && billUrl && (
          <a href={billUrl(ac, year)} target="_blank" rel="noreferrer" className="link-btn">
            County tax statement ↗
          </a>
        )}
        <a href={DOR_SEARCH} target="_blank" rel="noreferrer" className="link-btn">DOR property search ↗</a>
        <button className="link-btn ghost" onClick={copyGeocode}>{copied ? 'Copied' : `Copy geocode ${geocode}`}</button>
      </section>

      <footer className="caveat">{CAVEAT}</footer>
    </div>
  )
}

function BuildingNote({ b, year }: { b: Record<string, unknown>; year: Year }) {
  const tb = b[yf('tax_b', year)]
  const h = num(b.h)
  return (
    <section className="bldg-note">
      <div className="label">Selected structure</div>
      {tb == null || num(tb) <= 0 ? (
        <div>No structure tax is allocated to this footprint{tb != null ? ' (small outbuildings get none when the parcel has a larger building)' : ''}.</div>
      ) : (
        <div>
          <b>{fmtUSD2(num(tb))}</b> of this parcel's structure tax
          {b.share != null && <> ({fmtPct(num(b.share), 0)})</>}
          {h > 0 && <> · {Math.round(h * 3.281)} ft tall</>}
          {b.cls ? <> · {String(b.cls)}</> : null}
        </div>
      )}
      <div className="small muted">Structure tax is split among a parcel's footprints by area × height.</div>
    </section>
  )
}

function CondoUnits({ pid, n, year, billUrl, highlight }: { pid: string; n: number; year: Year; billUrl: ((ac: string, year: Year) => string) | null; highlight?: string }) {
  const [condos, setCondos] = useState<Condos | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    loadCondos().then(setCondos, () => setErr(true))
  }, [])
  const units = condos?.[pid]
  const matchKey = highlight?.toUpperCase()
  const isMatch = (u: CondoUnit) => !!matchKey && (u[0].toUpperCase() === matchKey || u[0].toUpperCase().startsWith(`${matchKey},`))
  const hlRef = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    hlRef.current?.scrollIntoView({ block: 'center' })
  }, [units, matchKey])
  const tvOf = (u: CondoUnit) => (year === '2026' ? u[2] : u[4])
  const taxOf = (u: CondoUnit) => (year === '2026' ? u[3] : u[5])
  return (
    <section>
      <h3>{fmtInt(n)} condo units</h3>
      {err && <p className="note">Couldn't load the unit list.</p>}
      {!condos && !err && <p className="muted small">Loading units…</p>}
      {condos && !units && <p className="muted small">No unit list for this parcel.</p>}
      {units && (
        <div className="table-scroll tall">
          <table className="lines">
            <thead><tr><th>Unit</th><th className="r">Taxable</th><th className="r">Tax</th></tr></thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={i} ref={isMatch(u) ? hlRef : undefined} className={isMatch(u) ? 'unit-hl' : undefined} aria-current={isMatch(u) || undefined}>
                  <td>
                    {u[1] && billUrl ? (
                      <a href={billUrl(u[1], year)} target="_blank" rel="noreferrer">{u[0] || u[1]}</a>
                    ) : (u[0] || '—')}
                  </td>
                  <td className="r mono">{fmtUSD(tvOf(u))}</td>
                  <td className="r mono">{fmtUSD2(taxOf(u))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Σ {units.length} units</td>
                <td className="r mono">{fmtUSD(units.reduce((s, u) => s + tvOf(u), 0))}</td>
                <td className="r mono">{fmtUSD2(units.reduce((s, u) => s + taxOf(u), 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

export function YearToggle({ year, onYear }: { year: Year; onYear: (y: Year) => void }) {
  return (
    <div className="seg" role="group" aria-label="Tax year">
      {(['2026', '2025'] as Year[]).map((y) => (
        <button key={y} className={y === year ? 'on' : ''} onClick={() => onYear(y)} aria-pressed={y === year}>
          TY{y}
        </button>
      ))}
    </div>
  )
}
