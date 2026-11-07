import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtInt, fmtUSD } from '../format'

interface Props {
  bins: { x0: number; x1: number; count: number }[]
  /** dollars per dollar of taxable value (mills / 1000) */
  scale: number
  median: number
}

export default function Histogram({ bins, scale, median }: Props) {
  const data = bins.map((b) => ({ x0: b.x0 * scale, x1: b.x1 * scale, count: b.count, mid: ((b.x0 + b.x1) / 2) * scale }))
  const medScaled = median * scale
  return (
    <div className="chart hist" style={{ height: 150 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barCategoryGap={1}>
          <XAxis
            dataKey="mid"
            tickFormatter={(v: number) => fmtUSD(v)}
            tick={{ fontSize: 10.5, fill: 'var(--ink-3)' }}
            interval={4}
            axisLine={{ stroke: 'var(--rule)' }}
            tickLine={false}
          />
          <YAxis tick={{ fontSize: 10.5, fill: 'var(--ink-3)' }} width={38} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtInt(v)} />
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.05)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload as (typeof data)[number]
              return (
                <div className="chart-tip">
                  {fmtUSD(d.x0)}–{fmtUSD(d.x1)} / yr
                  <div><b>{fmtInt(d.count)}</b> residential properties</div>
                </div>
              )
            }}
          />
          <Bar
            dataKey="count"
            isAnimationActive={false}
            shape={(props: unknown) => {
              const p = props as { x: number; y: number; width: number; height: number; payload: (typeof data)[number] }
              const hasMedian = medScaled >= p.payload.x0 && medScaled < p.payload.x1
              return <rect x={p.x} y={p.y} width={Math.max(0, p.width)} height={Math.max(0, p.height)} rx={1.5} fill={hasMedian ? '#1d3b66' : '#5aabad'} />
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
