import { useEffect, useState } from 'react'
import { loadValidation } from '../data/load'
import type { Meta, Validation } from '../data/types'
import { CAVEAT } from '../panel/PropertyPanel'

const fmtVal = (v: unknown) => {
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (v == null) return '—'
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

function groupByCounty(checks: Validation['checks']) {
  const out: Record<string, Validation['checks']> = {}
  for (const c of checks) (out[c.county ?? 'other'] ??= []).push(c)
  return out
}

export default function About({ meta, onClose }: { meta: Meta; onClose: () => void }) {
  const [validation, setValidation] = useState<Validation | null | undefined>(undefined)
  useEffect(() => {
    loadValidation().then(setValidation)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const v = meta.vintages
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="kicker">About &amp; methods</div>
            <h2 id="about-title">How these numbers are made</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body prose">
          <p className="lede">
            This map covers Gallatin and Yellowstone Counties. Taxable values and class rates come from the Montana Department of Revenue's ORION
            assessment database. Gallatin's mills come from the Gallatin County Treasurer's tax comparison statements. Yellowstone's come from the
            Yellowstone County Treasurer's property tax statements, which itemize the mills for each levy district. The validation table below
            compares the results with Treasurer statements and DOR certified values. Some figures are estimates; the notes below say which.
          </p>

          <h3>Coverage and exclusions</h3>
          <p>{CAVEAT}</p>
          <p>
            TY2026 is the default. The year toggle switches the map, panel and calculator to TY2025 values and mills.
            TY2026 bills had not been mailed when this data was pulled. Taxes are each property's taxable value × the mills on the Treasurer's
            statements for its levy district, because ORION's stored mills were out of date for some districts (most of them in TY2025).
          </p>

          <h3>Formulas</h3>
          <pre className="formula">{`taxable value = market value × class rate
tax (each levy) = taxable value × mills ÷ 1,000
annual tax = taxable value × total mills ÷ 1,000
value of a mill = Σ taxable value in the district ÷ 1,000
revenue at N mills = value of a mill × N`}</pre>
          <p>
            <b>Land vs. structures.</b> For residential and commercial property the class rate is applied to the property's total market value, and the
            resulting effective rate is applied to the land and building rows separately. Land tax and structure tax are those rows' taxable values × the same mills.
          </p>
          <p>
            <b>Class rates.</b> TY2025 residential: first $400,000 at 0.76%, $400,000–$1.5M at 1.10%, above at 2.20%. TY2026 homestead (principal residence or
            qualified long-term rental): up to the $378,000 statewide median at 0.76%, to 2× at 0.90%, to 4× at 1.10%, above at 1.90%. TY2026 non-homestead
            residential (second homes, short-term rentals, unenrolled): flat 1.90%. Commercial TY2026: 1.50% below $2,274,000, 1.90% above. Agricultural land is valued
            on productivity (2.05%; non-qualified ag land 14.35%). DOR records each property's applied rate, so homestead status comes from the data.
          </p>
          <p>
            <b>By jurisdiction.</b> A parcel's tax is split across State, County, City, Elementary, High school, Fire and Other districts in proportion to each
            levy's mills in the parcel's levy district. Each levy's mills come from Treasurer tax statements. In most levy
            districts total mills fell from 2025 to 2026 because many levies are set in dollars, so their mill rates drop as taxable value rises.
          </p>
          <p>
            <b>3D structures.</b> Footprints are from Overture Maps. Each parcel's structure tax is split across its footprints in proportion to footprint
            area × height; sheds under 30 m² get none unless they are the only building. Condo units' taxes are summed to the condo's master parcel.
          </p>
          <p>
            <b>Calculator.</b> A property is in an area when its parcel's representative point falls inside the boundary. Added tax = taxable value × N ÷ 1,000.
            In TY2026, about 630 Gallatin properties (0.5% of the county's taxable value) and 230 Yellowstone properties (0.2%) have no matching parcel polygon.
            They are counted only when the whole county is selected. A drawn or uploaded shape that crosses the county line uses both counties' properties.
            The calculator does not apply 15-10-420 levy limits.
          </p>

          <p>
            <b>Levy base.</b> The value of a mill counts mapped real property only. Inside TIF (urban renewal) districts, mills levied on the increment
            above the base year go to the TIF, so the calculator also shows a net figure with the estimated increment removed. Bozeman and Belgrade have
            TIF districts; Billings has three and Laurel has one. Personal property and centrally assessed utilities and railroads are also taxed but are
            not mapped. Per DOR certified values they add about 7% to Gallatin County's taxable value and about 26% to Yellowstone County's. The
            calculator shows their approximate effect.
          </p>

          <h3>Data vintages</h3>
          <dl className="vintages">
            {v.orion && <><dt>Montana DOR ORION (values, mills, tax)</dt><dd>{v.orion}</dd></>}
            {v.cadastral && <><dt>Montana State Library cadastral parcels</dt><dd>{v.cadastral}</dd></>}
            {v.overture && <><dt>Overture Maps buildings</dt><dd>{v.overture}</dd></>}
            {v.mills_2025 && <><dt>TY2025 mills</dt><dd>{v.mills_2025}</dd></>}
            {v.mills_2026 && <><dt>TY2026 mills</dt><dd>{v.mills_2026}</dd></>}
            {meta.generated && <><dt>Generated</dt><dd>{meta.generated}</dd></>}
          </dl>

          <h3>Validation</h3>
          {validation === undefined && <p className="muted">Loading…</p>}
          {validation === null && <p className="muted">No validation report is available for this build.</p>}
          {validation && Object.entries(groupByCounty(validation.checks)).map(([county, checks]) => (
            <div className="table-scroll" key={county}>
              <h4 className="val-county">{meta.counties[county]?.name ?? (county === 'other' ? 'Other checks' : county)}</h4>
              <table className="validation">
                <thead><tr><th>Check</th><th className="r">Expected</th><th className="r">Actual</th><th>Status</th></tr></thead>
                <tbody>
                  {checks.map((c) => (
                    <tr key={c.id}>
                      <td><span className="mono small">{c.id}</span> {c.name}{c.detail ? <div className="small muted">{c.detail}</div> : null}</td>
                      <td className="r mono">{fmtVal(c.expected)}</td>
                      <td className="r mono">{fmtVal(c.actual)}</td>
                      <td><span className={`status s-${String(c.status).toLowerCase()}`}>{c.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <h3>Sources</h3>
          <ul className="sources">
            <li><a href="https://ftpgeoinfo.msl.mt.gov/Data/Spatial/MSDI/Cadastral/ORION_SQLDatabases/" target="_blank" rel="noreferrer">Montana DOR ORION database</a> (via Montana State Library)</li>
            <li><a href="https://ftpgeoinfo.msl.mt.gov/Data/Spatial/MSDI/Cadastral/Parcels/" target="_blank" rel="noreferrer">Montana cadastral parcels</a></li>
            <li><a href="https://gallatinmt.gov/DocumentCenter/View/2785/2025-MILL-LEVY-INFORMATION" target="_blank" rel="noreferrer">Gallatin County 2025 mill levy book</a> and county tax comparison statements</li>
            <li><a href="https://www.yellowstonecountymt.gov/treasurer/" target="_blank" rel="noreferrer">Yellowstone County Treasurer</a> property tax statements</li>
            <li><a href="https://svc.mt.gov/dor/oriondataportal/Public/PropertyMTGov/CertifiedValues.aspx" target="_blank" rel="noreferrer">DOR certified values</a> (validation)</li>
            <li><a href="https://overturemaps.org/" target="_blank" rel="noreferrer">Overture Maps Foundation</a> buildings; basemap © OpenFreeMap, OpenMapTiles, OpenStreetMap contributors</li>
            <li>Boundaries: Montana State Library Administrative Boundaries Framework</li>
          </ul>
          <p className="small muted">Owner names and mailing addresses are not shown.</p>
        </div>
      </div>
    </div>
  )
}
