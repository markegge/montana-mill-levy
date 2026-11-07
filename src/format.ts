const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export const fmtUSD = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : usd0.format(v))
export const fmtUSD2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : usd2.format(v))
export const fmtInt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : int.format(v))
export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`
export const fmtMills = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(2)

/** Compact money: $1.2M, $340K, $950. */
export function fmtUSDShort(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`
  if (a >= 1e4) return `$${(v / 1e3).toFixed(0)}K`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return usd0.format(v)
}
