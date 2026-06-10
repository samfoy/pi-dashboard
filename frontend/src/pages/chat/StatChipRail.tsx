import { memo, useState } from 'react'
import type { ContextUsage, TokenStats } from '../../store/chatSlice'

const DEFAULT_CONTEXT_WINDOW = 200_000

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k'
  return String(n)
}

function fmtCost(n: number): string {
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(2)
}

interface Props {
  stats: TokenStats
  contextUsage?: ContextUsage | null
}

/**
 * Unified session telemetry surface — the single context/usage display.
 * Consolidates what used to be three separate widgets:
 *   - glanceable chip pills (tok / cache / ctx / cost)
 *   - a thin context-window utilization bar (formerly ContextWindowBar)
 *   - a detailed breakdown popover + /compact warning (formerly ContextBar)
 *
 * Visual language ported from pi-package-webui's stat chips. Neutral in most
 * themes; glows under `aurora-glow`.
 */
const StatChipRail = memo(function StatChipRail({ stats, contextUsage }: Props) {
  const [showDetail, setShowDetail] = useState(false)
  const { totalInputTokens, totalOutputTokens, totalTokens, totalCost, cacheReadTokens, cacheWriteTokens } = stats

  if (totalTokens === 0 && !contextUsage?.tokens) return null

  const contextWindow = contextUsage?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const currentContextTokens = contextUsage?.tokens ?? null
  const usedPct = currentContextTokens != null
    ? Math.min((currentContextTokens / contextWindow) * 100, 100)
    : (contextUsage?.percent ?? 0)
  const availPct = Math.max(100 - usedPct, 0)

  // Honest cache hit rate = reads / all input traffic (reads + writes + fresh).
  // (The old reads/(reads+fresh) form omitted cache writes and pinned at ~100%.)
  const cacheInputAll = cacheReadTokens + cacheWriteTokens + totalInputTokens
  const cacheHitPct = cacheInputAll > 0 ? Math.round((cacheReadTokens / cacheInputAll) * 100) : 0

  const ctxColor = usedPct >= 90 ? 'var(--danger)' : usedPct >= 70 ? 'var(--warn)' : 'var(--ok)'
  const hasCtx = currentContextTokens != null || (contextUsage?.percent ?? 0) > 0

  return (
    <div className="stat-rail shrink-0">
      {/* Thin context-window utilization bar (formerly ContextWindowBar) */}
      {hasCtx && (
        <div
          className="stat-rail-bar"
          title={`Context: ${currentContextTokens != null ? fmt(currentContextTokens) : '?'} / ${fmt(contextWindow)} (${usedPct.toFixed(1)}%)`}
        >
          {usedPct > 0 && <div className="h-full transition-all duration-500" style={{ width: `${usedPct}%`, backgroundColor: ctxColor }} />}
          {availPct > 0 && <div className="h-full transition-all duration-500" style={{ width: `${availPct}%`, backgroundColor: 'var(--border)' }} />}
        </div>
      )}

      <div className="stat-chip-rail">
        {/* Tokens — input / output */}
        <span
          className="stat-chip"
          style={{ ['--chip-glow' as string]: 'var(--glow-blue, rgba(137,180,250,.36))' }}
          title={`Total ${fmt(totalTokens)} · ↑${fmt(totalInputTokens)} in · ↓${fmt(totalOutputTokens)} out`}
        >
          <span className="stat-chip-dot" style={{ color: 'var(--info)' }} />
          <span className="stat-chip-label">tok</span>
          <span className="stat-chip-value">↑{fmt(totalInputTokens)}</span>
          <span className="stat-chip-sub">↓{fmt(totalOutputTokens)}</span>
        </span>

        {/* Cache hit rate */}
        {/* Cache read volume — a perpetual ~100% hit rate is useless, so show
            how much was served from cache (pi's "R" convention). */}
        {cacheReadTokens > 0 && (
          <span
            className="stat-chip"
            style={{ ['--chip-glow' as string]: 'var(--glow-teal, rgba(148,226,213,.3))' }}
            title={`${fmt(cacheReadTokens)} read from cache · ${fmt(cacheWriteTokens)} written (${cacheHitPct}% of input served from cache)`}
          >
            <span className="stat-chip-dot" style={{ color: 'var(--ok)' }} />
            <span className="stat-chip-label">cache</span>
            <span className="stat-chip-value" style={{ color: 'var(--ok)' }}>R {fmt(cacheReadTokens)}</span>
          </span>
        )}

        {/* Context window — hover for full breakdown */}
        {hasCtx && (
          <span
            className="stat-chip relative cursor-pointer"
            style={{ ['--chip-glow' as string]: 'var(--glow-green, rgba(166,227,161,.42))' }}
            onMouseEnter={() => setShowDetail(true)}
            onMouseLeave={() => setShowDetail(false)}
          >
            <span className="stat-chip-dot" style={{ color: ctxColor }} />
            <span className="stat-chip-label">ctx</span>
            <span className="stat-chip-value" style={{ color: ctxColor }}>{usedPct.toFixed(0)}%</span>
            <span className="stat-chip-sub">/ {fmt(contextWindow)}</span>

            {showDetail && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 bg-card border border-border rounded-lg shadow-xl p-3 min-w-[260px] text-[12px] font-mono pointer-events-none">
                <div className="font-semibold text-text-strong mb-2 font-body">Context Window</div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: ctxColor }} />
                    <span className="text-muted flex-1">In context</span>
                    <span className="text-text tabular-nums">{currentContextTokens != null ? fmt(currentContextTokens) : '—'}</span>
                    <span className="text-muted tabular-nums w-[42px] text-right">{usedPct.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0 border border-border" style={{ backgroundColor: 'var(--border)' }} />
                    <span className="text-muted flex-1">Available</span>
                    <span className="text-text tabular-nums">{currentContextTokens != null ? fmt(Math.max(contextWindow - currentContextTokens, 0)) : '—'}</span>
                    <span className="text-muted tabular-nums w-[42px] text-right">{availPct.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="border-t border-border mt-2 pt-2 space-y-1">
                  <div className="text-[11px] text-muted font-semibold uppercase tracking-wide mb-1">Session totals</div>
                  {totalInputTokens > 0 && (
                    <div className="flex justify-between"><span className="text-muted">↑ Fresh input</span><span className="text-text tabular-nums">{fmt(totalInputTokens)}</span></div>
                  )}
                  {cacheReadTokens > 0 && (
                    <div className="flex justify-between"><span className="text-muted">⚡ Cache reads</span><span className="text-ok tabular-nums">{fmt(cacheReadTokens)}</span></div>
                  )}
                  {totalOutputTokens > 0 && (
                    <div className="flex justify-between"><span className="text-muted">↓ Output</span><span className="text-text tabular-nums">{fmt(totalOutputTokens)}</span></div>
                  )}
                  {cacheHitPct > 0 && (
                    <div className="flex justify-between"><span className="text-muted">Cache hit rate</span><span className="text-ok tabular-nums">{cacheHitPct}%</span></div>
                  )}
                  {cacheWriteTokens > 0 && (
                    <div className="flex justify-between"><span className="text-muted">Cache writes</span><span className="text-text tabular-nums">{fmt(cacheWriteTokens)}</span></div>
                  )}
                  {totalCost > 0 && (
                    <div className="flex justify-between"><span className="text-muted">Session cost</span><span className="text-text tabular-nums">{fmtCost(totalCost)}</span></div>
                  )}
                </div>
                {usedPct >= 80 && (
                  <div className="mt-2 text-[11px] text-warn font-body">
                    ⚠ Context is {usedPct >= 90 ? 'nearly full' : 'getting full'} — consider /compact
                  </div>
                )}
              </div>
            )}
          </span>
        )}

        {/* Session cost */}
        {totalCost > 0 && (
          <span
            className="stat-chip"
            style={{ ['--chip-glow' as string]: 'var(--glow-peach, rgba(250,179,135,.36))' }}
            title="Estimated session cost"
          >
            <span className="stat-chip-dot" style={{ color: 'var(--warn)' }} />
            <span className="stat-chip-label">cost</span>
            <span className="stat-chip-value">{fmtCost(totalCost)}</span>
          </span>
        )}
      </div>
    </div>
  )
})

export default StatChipRail
