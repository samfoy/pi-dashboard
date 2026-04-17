import type { ContextUsage } from '../../store/chatSlice'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k'
  return String(n)
}

export default function ContextBar({ usage }: { usage: ContextUsage }) {
  const { tokens, contextWindow, percent } = usage
  if (!contextWindow) return null

  const pct = percent ?? 0
  const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#eab308' : '#22c55e'
  const label = tokens != null
    ? `${formatTokens(tokens)} / ${formatTokens(contextWindow)} (${pct.toFixed(0)}%)`
    : `? / ${formatTokens(contextWindow)}`

  return (
    <div className="flex items-center gap-2 px-2 py-0.5 rounded-md text-[12px] font-mono bg-bg-elevated border border-border text-muted" title={`Context: ${label}`}>
      <span className="text-[11px] opacity-60">ctx</span>
      <div className="w-[60px] h-[6px] rounded-full bg-border overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="tabular-nums">{pct.toFixed(0)}%</span>
    </div>
  )
}
