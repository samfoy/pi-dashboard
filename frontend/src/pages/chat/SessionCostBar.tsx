import { memo } from 'react'
import type { TokenStats } from '../../store/chatSlice'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

function formatCost(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(2)
}

const SessionCostBar = memo(function SessionCostBar({ stats }: { stats: TokenStats }) {
  const { totalInputTokens, totalOutputTokens, totalTokens, totalCost, cacheReadTokens } = stats
  if (totalTokens === 0) return null

  const cachePercent = totalInputTokens > 0 ? Math.round((cacheReadTokens / totalInputTokens) * 100) : 0

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-t border-border bg-chrome text-[11px] font-mono text-muted shrink-0">
      <span title="Total tokens used">
        📊 {formatTokens(totalTokens)}
      </span>
      <span className="text-muted/40">|</span>
      <span title="Input tokens">
        ↑ {formatTokens(totalInputTokens)}
      </span>
      <span title="Output tokens">
        ↓ {formatTokens(totalOutputTokens)}
      </span>
      {cachePercent > 0 && (
        <>
          <span className="text-muted/40">|</span>
          <span className="text-ok" title={`${formatTokens(cacheReadTokens)} tokens served from cache`}>
            ⚡ {cachePercent}% cached
          </span>
        </>
      )}
      {totalCost > 0 && (
        <>
          <span className="text-muted/40">|</span>
          <span title="Estimated session cost">
            💰 {formatCost(totalCost)}
          </span>
        </>
      )}
    </div>
  )
})

export default SessionCostBar
