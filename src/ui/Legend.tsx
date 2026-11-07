import type { Meta } from '../data/types'
import { fmtUSDShort } from '../format'
import { COLOR_MODES, EXEMPT, legendFor, type ColorMode } from '../map/style'

interface Props {
  mode: ColorMode
  meta: Meta
  addedBreaks: number[]
  mills: number
  year: string
  selectionLabel?: string
}

export default function Legend({ mode, meta, addedBreaks, mills, year, selectionLabel }: Props) {
  const { breaks, colors } = legendFor(mode, meta, addedBreaks, mills)
  const fmt = (v: number) => (mode === 'eff' ? `$${v.toFixed(v < 10 ? 2 : 1)}` : fmtUSDShort(v))
  const title = COLOR_MODES.find((m) => m.id === mode)?.label
  return (
    <div className="legend">
      <div className="legend-title">
        {mode === 'added' ? <>Added tax at {mills} mills{selectionLabel ? ` · ${selectionLabel}` : ''}</> : <>{title} · TY{year}</>}
      </div>
      <div className="legend-ramp">
        {colors.map((c, i) => (
          <div key={c} className="legend-cell">
            <span style={{ background: c }} />
            <small>{i === 0 ? '$0' : i === colors.length - 1 ? `${fmt(breaks[i - 1])}+` : fmt(breaks[i - 1])}</small>
          </div>
        ))}
      </div>
      <div className="legend-foot">
        <span><i style={{ background: EXEMPT }} /> {mode === 'added' ? 'Outside the area / exempt' : 'Exempt / non-valued'}</span>
        <span className="muted">Classes are septiles{mode === 'added' ? ' within the area' : ' county-wide'}</span>
      </div>
    </div>
  )
}
