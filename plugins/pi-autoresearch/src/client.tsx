// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Autoresearch plugin — rich rendering for experiment tools.
 *
 * - init_experiment: session config card
 * - run_experiment: command execution with timing, pass/fail, output
 * - log_experiment: result card with metric delta, confidence, status badge
 */
import { useState } from 'react'

interface ToolProps {
  toolName: string
  toolInput: Record<string, unknown>
  toolResult?: string
  isError?: boolean
  sessionId: string
}

function CardShell({ icon, title, subtitle, badge, children, isError }: {
  icon: string; title: string; subtitle?: string; badge?: React.ReactNode; children: React.ReactNode; isError?: boolean
}) {
  return (
    <div className={`bg-card border rounded-lg overflow-hidden animate-scale-in ${isError ? 'border-danger/30' : 'border-border'}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-hover/50">
        <span className="text-[14px]">{icon}</span>
        <span className="text-[13px] font-semibold text-text">{title}</span>
        {subtitle && <span className="text-[11px] text-muted font-mono truncate">{subtitle}</span>}
        {badge && <span className="ml-auto shrink-0">{badge}</span>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

// ── init_experiment ──────────────────────────────────────────────────────────

export function InitExperimentRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const name = toolInput.name as string || ''
  const metric = toolInput.metric_name as string || ''
  const unit = toolInput.metric_unit as string || ''
  const direction = toolInput.direction as string || 'lower'

  const ok = !isError && toolResult?.startsWith('✅')

  return (
    <CardShell icon="🧪" title="Init Experiment" badge={
      ok ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-ok/15 text-ok">✓ Ready</span>
         : isError ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-danger/15 text-danger">✗ Failed</span>
         : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && (
        <div className="space-y-2">
          <div className="text-[15px] font-semibold text-text">{name}</div>
          <div className="flex gap-4 text-[12px]">
            <div className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg bg-bg-hover/50">
              <span className="text-muted text-[10px] uppercase tracking-wider">Metric</span>
              <span className="text-accent font-mono font-medium">{metric}</span>
            </div>
            {unit && (
              <div className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg bg-bg-hover/50">
                <span className="text-muted text-[10px] uppercase tracking-wider">Unit</span>
                <span className="text-text font-mono">{unit}</span>
              </div>
            )}
            <div className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg bg-bg-hover/50">
              <span className="text-muted text-[10px] uppercase tracking-wider">Direction</span>
              <span className="text-text font-mono">{direction === 'lower' ? '↓ lower' : '↑ higher'} is better</span>
            </div>
          </div>
        </div>
      )}
    </CardShell>
  )
}

// ── run_experiment ───────────────────────────────────────────────────────────

function parseRunResult(text: string): {
  passed: boolean; crashed: boolean; timedOut: boolean
  duration?: string; exitCode?: string; command?: string
  checksPass?: boolean; metrics: { name: string; value: string }[]
  output: string
} {
  const passed = /✅|passed|exit code: 0/i.test(text)
  const crashed = /❌|crashed|failed|exit code: [^0]/i.test(text)
  const timedOut = /timed out|timeout/i.test(text)

  const durationMatch = text.match(/Duration:\s*([\d.]+s)/i) || text.match(/([\d.]+)s\s*wall/i)
  const exitMatch = text.match(/exit code:\s*(\d+)/i)

  // Parse METRIC lines
  const metrics: { name: string; value: string }[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/METRIC\s+(\S+?)=(\S+)/)
    if (m) metrics.push({ name: m[1], value: m[2] })
  }

  // Parse suggested values
  const suggestMatch = text.match(/Suggested log_experiment values:[\s\S]*?metric:\s*([\d.]+)/)

  return {
    passed: passed && !crashed,
    crashed,
    timedOut,
    duration: durationMatch?.[1],
    exitCode: exitMatch?.[1],
    metrics,
    output: text,
  }
}

export function RunExperimentRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(false)
  const command = toolInput.command as string || ''
  const timeout = toolInput.timeout_seconds as number

  const result = parseRunResult(toolResult || '')
  const running = !toolResult

  const statusBadge = running
    ? <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    : result.crashed || isError
      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-danger/15 text-danger">✗ {result.timedOut ? 'Timeout' : 'Failed'}</span>
      : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-ok/15 text-ok">✓ Passed</span>

  return (
    <CardShell icon="⚡" title="Run Experiment" subtitle={result.duration} badge={statusBadge} isError={isError}>
      <div className="space-y-2">
        {/* Command */}
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-bg-hover/50">
          <span className="text-muted text-[11px] shrink-0">$</span>
          <code className="text-[12px] font-mono text-text truncate">{command}</code>
          {result.exitCode && <span className="text-muted text-[11px] ml-auto shrink-0">exit {result.exitCode}</span>}
        </div>

        {/* Parsed metrics */}
        {result.metrics.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {result.metrics.map((m, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded bg-accent/10 border border-accent/20 text-[12px]">
                <span className="text-muted font-mono">{m.name}</span>
                <span className="text-accent font-mono font-bold">{m.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Expandable output */}
        {toolResult && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer"
            >
              {expanded ? '▼ Hide output' : '▶ Show output'}
            </button>
            {expanded && (
              <pre className="bg-bg-hover rounded-md px-3 py-2 text-[12px] font-mono overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto text-text/80">
                {toolResult}
              </pre>
            )}
          </>
        )}
      </div>
    </CardShell>
  )
}

// ── log_experiment ───────────────────────────────────────────────────────────

const statusStyles: Record<string, { icon: string; bg: string; text: string; label: string }> = {
  keep:          { icon: '✓', bg: 'bg-ok/15',     text: 'text-ok',     label: 'Keep' },
  discard:       { icon: '✗', bg: 'bg-muted/15',  text: 'text-muted',  label: 'Discard' },
  crash:         { icon: '💥', bg: 'bg-danger/15', text: 'text-danger', label: 'Crash' },
  checks_failed: { icon: '⚠', bg: 'bg-warn/15',  text: 'text-warn',   label: 'Checks Failed' },
}

function parseConfidence(text: string): { value: number; label: string } | null {
  const match = text.match(/Confidence:\s*([\d.]+)×/)
  if (!match) return null
  const v = parseFloat(match[1])
  if (v >= 2.0) return { value: v, label: 'likely real' }
  if (v >= 1.0) return { value: v, label: 'marginal' }
  return { value: v, label: 'within noise' }
}

function parseDelta(text: string): { baseline: string; current: string; pct: string } | null {
  const match = text.match(/Baseline .+?:\s*([\d.]+\S*)\s*\|\s*this:\s*([\d.]+\S*)\s*\(([^)]+)\)/)
  if (!match) return null
  return { baseline: match[1], current: match[2], pct: match[3] }
}

export function LogExperimentRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const status = toolInput.status as string || 'discard'
  const metric = toolInput.metric as number
  const description = toolInput.description as string || ''
  const commit = toolInput.commit as string || ''
  const secondaryMetrics = toolInput.metrics as Record<string, number> | undefined
  const asi = toolInput.asi as Record<string, unknown> | undefined

  const style = statusStyles[status] || statusStyles.discard
  const confidence = parseConfidence(toolResult || '')
  const delta = parseDelta(toolResult || '')
  const experimentNum = toolResult?.match(/Logged #(\d+)/)?.[1]

  return (
    <CardShell
      icon="📊"
      title={`Experiment${experimentNum ? ` #${experimentNum}` : ''}`}
      subtitle={commit ? `${commit}` : undefined}
      badge={
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${style.bg} ${style.text}`}>
          {style.icon} {style.label}
        </span>
      }
      isError={isError}
    >
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && (
        <div className="space-y-2.5">
          {/* Description */}
          <p className="text-[13px] text-text">{description}</p>

          {/* Primary metric with delta */}
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center gap-0.5 px-4 py-2.5 rounded-lg bg-bg-hover/50 min-w-[80px]">
              <span className="text-muted text-[10px] uppercase tracking-wider">Metric</span>
              <span className={`text-[18px] font-bold font-mono ${status === 'keep' ? 'text-ok' : status === 'crash' ? 'text-danger' : 'text-text'}`}>
                {metric === 0 && status === 'crash' ? '—' : metric}
              </span>
            </div>
            {delta && (
              <div className="flex flex-col gap-0.5 text-[12px]">
                <span className="text-muted">Baseline: <span className="font-mono">{delta.baseline}</span></span>
                <span className={`font-mono font-medium ${delta.pct.startsWith('+') ? 'text-danger' : 'text-ok'}`}>
                  {delta.pct}
                </span>
              </div>
            )}
          </div>

          {/* Secondary metrics */}
          {secondaryMetrics && Object.keys(secondaryMetrics).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(secondaryMetrics).map(([name, value]) => (
                <div key={name} className="flex items-center gap-1.5 px-2 py-1 rounded bg-bg-hover/50 text-[11px] font-mono">
                  <span className="text-muted">{name}</span>
                  <span className="text-text font-medium">{value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Confidence */}
          {confidence && (
            <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-[12px] ${
              confidence.value >= 2.0 ? 'bg-ok/10 border border-ok/20' :
              confidence.value >= 1.0 ? 'bg-warn/10 border border-warn/20' :
              'bg-danger/10 border border-danger/20'
            }`}>
              <span className="font-mono font-bold">{confidence.value.toFixed(1)}×</span>
              <span className="text-muted">{confidence.label}</span>
            </div>
          )}

          {/* ASI hypothesis */}
          {asi?.hypothesis && (
            <div className="px-2 py-1.5 rounded bg-bg-hover/50 text-[12px]">
              <span className="text-muted text-[10px] uppercase tracking-wider mr-2">Hypothesis:</span>
              <span className="text-text/80">{String(asi.hypothesis)}</span>
            </div>
          )}
        </div>
      )}
    </CardShell>
  )
}
