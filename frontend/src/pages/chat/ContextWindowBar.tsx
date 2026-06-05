import { useState } from 'react'
import type { ContextUsage, TokenStats } from '../../store/chatSlice'

const DEFAULT_CONTEXT_WINDOW = 200_000

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

function fmtCost(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.001) return '<$0.001'
  if (n < 0.01) return '$' + n.toFixed(3)
  return '$' + n.toFixed(2)
}

interface Props {
  stats: TokenStats
  contextUsage?: ContextUsage | null
}

export default function ContextWindowBar({ stats, contextUsage }: Props) {
  const [showTooltip, setShowTooltip] = useState(false)

  const { totalInputTokens, totalOutputTokens, totalCost, cacheReadTokens, cacheWriteTokens } = stats
  const contextWindow = contextUsage?.contextWindow ?? DEFAULT_CONTEXT_WINDOW

  // currentContextTokens is the estimated tokens currently in the context window (not cumulative session total)
  const currentContextTokens = contextUsage?.tokens ?? null

  if (totalInputTokens === 0 && totalOutputTokens === 0 && cacheReadTokens === 0) return null

  // Bar shows current context window utilization from contextUsage, not cumulative session totals
  const totalUsedPct = currentContextTokens != null
    ? Math.min((currentContextTokens / contextWindow) * 100, 100)
    : 0
  const availPct = Math.max(100 - totalUsedPct, 0)

  // Cache hit rate: cache reads as % of all input traffic (cached + non-cached)
  const totalInputAll = cacheReadTokens + totalInputTokens
  const cachePercent = totalInputAll > 0 ? Math.round((cacheReadTokens / totalInputAll) * 100) : 0

  return (
    <div
      className="relative group px-0 shrink-0"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Stacked bar — full width, 7px tall */}
      <div
        className="w-full h-[7px] flex overflow-hidden cursor-pointer"
        title={`Context: ${currentContextTokens != null ? fmt(currentContextTokens) : '?'} / ${fmt(contextWindow)} (${totalUsedPct.toFixed(1)}%)`}
      >
        {/* Used context — teal */}
        {totalUsedPct > 0 && (
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${totalUsedPct}%`, backgroundColor: 'var(--ok)' }}
          />
        )}
        {/* Available — muted track */}
        {availPct > 0 && (
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${availPct}%`, backgroundColor: 'var(--border)' }}
          />
        )}
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 bg-card border border-border rounded-lg shadow-xl p-3 min-w-[260px] text-[12px] font-mono pointer-events-none">
          <div className="font-semibold text-text-strong mb-2 font-body">Context Window Breakdown</div>

          {/* Context window utilization */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: 'var(--ok)' }} />
              <span className="text-muted flex-1">In context</span>
              <span className="text-text tabular-nums">{currentContextTokens != null ? fmt(currentContextTokens) : '—'}</span>
              <span className="text-muted tabular-nums w-[42px] text-right">{totalUsedPct.toFixed(1)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0 border border-border" style={{ backgroundColor: 'var(--border)' }} />
              <span className="text-muted flex-1">Available</span>
              <span className="text-text tabular-nums">{currentContextTokens != null ? fmt(Math.max(contextWindow - currentContextTokens, 0)) : '—'}</span>
              <span className="text-muted tabular-nums w-[42px] text-right">{availPct.toFixed(1)}%</span>
            </div>
          </div>

          {/* Divider + session totals */}
          <div className="border-t border-border mt-2 pt-2 space-y-1">
            <div className="text-[11px] text-muted font-semibold uppercase tracking-wide mb-1">Session totals</div>
            <div className="flex justify-between">
              <span className="text-muted">Total used</span>
              <span className="text-text tabular-nums">{currentContextTokens != null ? fmt(currentContextTokens) : '—'} / {fmt(contextWindow)}</span>
            </div>
            {totalInputTokens > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">↑ Fresh input</span>
                <span className="text-text tabular-nums">{fmt(totalInputTokens)}</span>
              </div>
            )}
            {cacheReadTokens > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">⚡ Cache reads</span>
                <span className="text-ok tabular-nums">{fmt(cacheReadTokens)}</span>
              </div>
            )}
            {totalOutputTokens > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">↓ Output</span>
                <span className="text-text tabular-nums">{fmt(totalOutputTokens)}</span>
              </div>
            )}
            {cachePercent > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Cache hit rate</span>
                <span className="text-ok tabular-nums">{cachePercent}%</span>
              </div>
            )}
            {cacheWriteTokens > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Cache writes</span>
                <span className="text-text tabular-nums">{fmt(cacheWriteTokens)}</span>
              </div>
            )}
            {totalCost > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Session cost</span>
                <span className="text-text tabular-nums">{fmtCost(totalCost)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
