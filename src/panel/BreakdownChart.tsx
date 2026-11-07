import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtUSD, fmtUSD2, fmtUSDShort } from '../format'
import { LAND_COLOR, STRUCT_COLOR, type GroupRow } from './breakdown'

export default function BreakdownChart({ groups }: { groups: GroupRow[] }) {
  const height = 34 + groups.length * 30
  return (
    <div className="chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={groups} layout="vertical" margin={{ top: 4, right: 14, bottom: 4, left: 4 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke="var(--rule)" />
          <XAxis type="number" tickFormatter={(v: number) => fmtUSDShort(v)} tick={{ fontSize: 11, fill: 'var(--ink-3)' }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="group" width={86} tick={{ fontSize: 12, fill: 'var(--ink-2)' }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const g = payload[0].payload as GroupRow
              return (
                <div className="chart-tip">
                  <b>{g.group}</b> · {g.mills.toFixed(2)} mills
                  <div><i style={{ background: LAND_COLOR }} /> Land {fmtUSD2(g.land)}</div>
                  <div><i style={{ background: STRUCT_COLOR }} /> Structures {fmtUSD2(g.structure)}</div>
                  <div className="chart-tip-total">Total {fmtUSD(g.total)}</div>
                </div>
              )
            }}
          />
          <Bar dataKey="land" stackId="a" fill={LAND_COLOR} name="Land" isAnimationActive={false} />
          <Bar dataKey="structure" stackId="a" fill={STRUCT_COLOR} name="Structures" radius={[0, 3, 3, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
