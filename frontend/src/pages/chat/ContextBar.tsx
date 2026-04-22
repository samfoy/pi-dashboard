import { useState } from 'react'
import type { ContextUsage } from '../../store/chatSlice'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k'
  return String(n)
}

export default function ContextBar({ usage }: { usage: ContextUsage }) {
  const { tokens, contextWindow, percent } = usage
  const [showTooltip, setShowTooltip] = useState(false)
  if (!contextWindow) return null

  const pct = percent ?? 0
  const color = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warn)' : 'var(--ok)'
  const bgColor = pct >= 90 ? 'var(--danger-subtle)' : pct >= 70 ? 'var(--warn-subtle)' : 'transparent'
  const label = tokens != null
    ? `${formatTokens(tokens)} / ${formatTokens(contextWindow)}`
    : `? / ${formatTokens(contextWindow)}`

  return (
    <div
      className="relative flex items-center gap-2 px-2 py-0.5 rounded-md text-[12px] font-mono border border-border text-muted cursor-pointer transition-colors hover:border-border-strong"
      style={{ backgroundColor: bgColor }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      title={`Context: ${label} (${pct.toFixed(1)}%)`}
    >
      <div className="w-[60px] h-[6px] rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
        />
      </div>
      <span className="tabular-nums" style={{ color: pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warn)' : undefined }}>
        {pct.toFixed(0)}%
      </span>
      {showTooltip && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-lg shadow-lg p-3 min-w-[200px] text-[12px]">
          <div className="font-semibold text-text-strong mb-2">Context Window</div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-muted">Used</span>
              <span className="text-text font-mono">{tokens != null ? formatTokens(tokens) : '?'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Window</span>
              <span className="text-text font-mono">{formatTokens(contextWindow)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Remaining</span>
              <span className="text-text font-mono">{tokens != null ? formatTokens(contextWindow - tokens) : '?'}</span>
            </div>
            <div className="border-t border-border mt-2 pt-2">
              <div className="w-full h-2 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
                />
              </div>
              {pct >= 80 && (
                <div className="mt-1.5 text-[11px] text-warn">
                  ⚠ Context is {pct >= 90 ? 'nearly full' : 'getting full'} — consider using /compact
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
