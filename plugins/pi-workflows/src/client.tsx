// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Workflows plugin for pi-dashboard.
 *
 * Provides:
 *   - WriteWorkflowRenderer  — rich card for write_workflow tool calls
 *   - WorkflowResultCard     — renders pi-workflows.result system messages
 *   - WorkflowsPanel         — sidebar panel showing live workflow runs
 *
 * Data flow:
 *   - write_workflow tool result: { name, path, isOverwrite, runCommand }
 *     from toolResult JSON or details
 *   - pi-workflows.result messages: arrive as system messages with
 *     meta.customType = "pi-workflows.result" and meta.details = { runId,
 *     outcome, durationMs, agentCount, workflowName, ... }
 *   - WorkflowsPanel: subscribes to system messages with customType
 *     "pi-workflows.run.started" / "pi-workflows.run.ended" / 
 *     "pi-workflows.workflow-saved" to maintain a local runs list
 */
import { useState, useEffect, useMemo, useCallback } from 'react'

// ── Shared utilities ──────────────────────────────────────────────────────────

function formatDuration(ms) {
  if (!ms || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m${s}s`
}

function outcomeColor(outcome) {
  switch (outcome) {
    case 'done': return 'text-ok'
    case 'failed': return 'text-danger'
    case 'stopped': return 'text-warning'
    case 'cancelled-pre-run': return 'text-muted'
    default: return 'text-accent'
  }
}

function outcomeIcon(outcome) {
  switch (outcome) {
    case 'done': return '✓'
    case 'failed': return '✗'
    case 'stopped': return '■'
    case 'cancelled-pre-run': return '○'
    default: return '▶'
  }
}

// ── Shell card component ──────────────────────────────────────────────────────

function WorkflowCard({ icon, title, subtitle, badge, children, accent }) {
  return (
    <div className={`bg-card border rounded-lg overflow-hidden animate-scale-in ${accent ? 'border-accent/40' : 'border-border'}`}>
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border/60">
        <span className="text-base leading-none shrink-0 text-accent">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm font-medium text-fg truncate">{title}</div>
          {subtitle && (
            <div className="font-mono text-xs text-muted truncate mt-0.5">{subtitle}</div>
          )}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
      {children && (
        <div className="px-3.5 py-2.5">{children}</div>
      )}
    </div>
  )
}

function Badge({ label, color = 'text-muted' }) {
  return (
    <span className={`font-mono text-xs px-1.5 py-0.5 rounded bg-muted/10 ${color}`}>
      {label}
    </span>
  )
}

// ── WriteWorkflowRenderer ─────────────────────────────────────────────────────

/**
 * Renders a write_workflow tool call.
 * Props: { toolName, toolInput, toolResult, partialResult, isRunning, isError }
 */
export function WriteWorkflowRenderer({ toolInput, toolResult, partialResult, isRunning, isError }) {
  // Parse result details from toolResult JSON
  const details = useMemo(() => {
    if (partialResult?.details) return partialResult.details
    if (!toolResult) return null
    try { return JSON.parse(toolResult)?.details ?? null } catch { return null }
  }, [toolResult, partialResult])

  const name = details?.name ?? toolInput?.name ?? '...'
  const path = details?.path
  const isOverwrite = details?.isOverwrite ?? false
  const runCommand = details?.runCommand ?? `/${name}`

  if (isRunning) {
    return (
      <WorkflowCard icon="⚙" title={`Saving /${name}…`} accent>
        <div className="font-mono text-xs text-muted animate-pulse">Writing workflow script…</div>
      </WorkflowCard>
    )
  }

  if (isError) {
    // Extract validation error from toolResult text
    const errText = toolResult?.replace(/^❌ Workflow validation failed:\n\n/, '') ?? 'Unknown error'
    return (
      <WorkflowCard icon="✗" title={`Workflow validation failed`} accent={false}>
        <div className="font-mono text-xs text-danger whitespace-pre-wrap">{errText}</div>
      </WorkflowCard>
    )
  }

  const verb = isOverwrite ? 'updated' : 'saved'

  return (
    <WorkflowCard
      icon="⚡"
      title={`Workflow /${name} ${verb}`}
      subtitle={path}
      badge={<Badge label={verb} color={isOverwrite ? 'text-warning' : 'text-ok'} />}
      accent
    >
      <div className="flex items-center gap-3 mt-0.5">
        <div className="font-mono text-xs text-muted flex-1">
          Run with <span className="text-accent font-semibold">{runCommand}</span>
        </div>
        <div className="font-mono text-xs text-fg/60">
          Type <span className="text-accent">{runCommand}</span> to execute
        </div>
      </div>
      {/* Show the script snippet if toolInput has it */}
      {toolInput?.script && (
        <details className="mt-2">
          <summary className="font-mono text-xs text-muted cursor-pointer hover:text-fg transition-colors">
            View script ▸
          </summary>
          <pre className="mt-2 text-xs font-mono bg-bg/60 rounded p-2 overflow-x-auto max-h-48 text-muted/90 whitespace-pre">
            {String(toolInput.script).slice(0, 2000)}
          </pre>
        </details>
      )}
    </WorkflowCard>
  )
}

// ── WorkflowResultCard ────────────────────────────────────────────────────────

/**
 * Renders a pi-workflows.result system message.
 * Props: { customType, content, meta }
 */
export function WorkflowResultCard({ content, meta }) {
  const details = meta?.details ?? {}
  const {
    runId,
    outcome = 'done',
    durationMs,
    agentCount,
    workflowName,
    cacheHits,
    error,
  } = details

  const icon = outcomeIcon(outcome)
  const color = outcomeColor(outcome)
  const title = workflowName ? `/${workflowName}` : 'Workflow'
  const subtitle = runId ? `run ${runId}` : undefined

  return (
    <WorkflowCard
      icon={icon}
      title={`${title} ${outcome}`}
      subtitle={subtitle}
      badge={<Badge label={outcome} color={color} />}
      accent={outcome === 'done'}
    >
      <div className="flex flex-wrap gap-3 font-mono text-xs text-muted">
        {durationMs != null && (
          <span>⏱ {formatDuration(durationMs)}</span>
        )}
        {agentCount != null && (
          <span>🤖 {agentCount} agent{agentCount !== 1 ? 's' : ''}</span>
        )}
        {cacheHits != null && cacheHits > 0 && (
          <span>💾 {cacheHits} cache hit{cacheHits !== 1 ? 's' : ''}</span>
        )}
      </div>
      {outcome === 'failed' && error && (
        <div className="mt-1.5 font-mono text-xs text-danger/80 truncate" title={error}>
          {error}
        </div>
      )}
      {outcome === 'done' && content && !content.startsWith('[pi-workflows.result]') && (
        <div className="mt-1.5 font-mono text-xs text-fg/70 line-clamp-3">
          {content}
        </div>
      )}
    </WorkflowCard>
  )
}

// ── WorkflowsPanel ────────────────────────────────────────────────────────────

/**
 * Sidebar panel that tracks workflow runs from the system message stream.
 * Subscribes to: pi-workflows.run.started, pi-workflows.run.ended,
 * pi-workflows.workflow-saved, pi-workflows.result
 *
 * Since we can't access the full message history on mount (sidebar panels
 * receive no props), we build state incrementally from incoming messages
 * via a window.addEventListener('pi-dashboard:system-message', ...) bridge
 * that pi-dashboard fires when a new system message arrives.
 */
const PANEL_CUSTOM_TYPES = new Set([
  'pi-workflows.run.started',
  'pi-workflows.run.ended',
  'pi-workflows.run.transitioned',
  'pi-workflows.workflow-saved',
  'pi-workflows.result',
])

export function WorkflowsPanel() {
  const [runs, setRuns] = useState([])
  const [savedWorkflows, setSavedWorkflows] = useState([])

  const handleMessage = useCallback((evt) => {
    const { customType, details, content } = evt.detail ?? {}
    if (!PANEL_CUSTOM_TYPES.has(customType)) return

    if (customType === 'pi-workflows.run.started') {
      const { runId, workflowName, startedAt } = details ?? {}
      if (!runId) return
      setRuns(prev => {
        const idx = prev.findIndex(r => r.runId === runId)
        if (idx >= 0) return prev
        return [{ runId, workflowName, startedAt, state: 'running' }, ...prev].slice(0, 50)
      })
    }

    if (customType === 'pi-workflows.run.ended' || customType === 'pi-workflows.result') {
      const { runId, outcome, durationMs, workflowName } = details ?? {}
      if (!runId) return
      setRuns(prev => prev.map(r =>
        r.runId === runId
          ? { ...r, outcome, durationMs, state: outcome ?? 'done', workflowName: workflowName ?? r.workflowName }
          : r
      ))
    }

    if (customType === 'pi-workflows.run.transitioned') {
      const { runId, to } = details ?? {}
      if (!runId) return
      setRuns(prev => prev.map(r => r.runId === runId ? { ...r, state: to } : r))
    }

    if (customType === 'pi-workflows.workflow-saved') {
      const { name, path, savedAt } = details ?? {}
      if (!name) return
      setSavedWorkflows(prev => {
        const without = prev.filter(w => w.name !== name)
        return [{ name, path, savedAt }, ...without].slice(0, 20)
      })
    }
  }, [])

  useEffect(() => {
    window.addEventListener('pi-dashboard:system-message', handleMessage)
    return () => window.removeEventListener('pi-dashboard:system-message', handleMessage)
  }, [handleMessage])

  const activeRuns = runs.filter(r => r.state === 'running' || r.state === 'paused')
  const recentRuns = runs.filter(r => r.state !== 'running' && r.state !== 'paused').slice(0, 5)

  return (
    <div className="flex flex-col gap-3 p-3 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-accent text-sm">⚡</span>
        <span className="font-mono text-sm font-semibold text-fg">Workflows</span>
        {activeRuns.length > 0 && (
          <span className="font-mono text-xs text-accent bg-accent/10 rounded px-1.5 py-0.5">
            {activeRuns.length} active
          </span>
        )}
      </div>

      {/* Active runs */}
      {activeRuns.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="font-mono text-xs text-muted uppercase tracking-wide">Active</div>
          {activeRuns.map(r => (
            <div key={r.runId} className="flex items-center gap-2 font-mono text-xs bg-accent/5 border border-accent/20 rounded px-2 py-1.5">
              <span className="text-accent animate-pulse">▶</span>
              <span className="text-fg truncate flex-1">{r.workflowName ? `/${r.workflowName}` : r.runId}</span>
              <span className="text-muted shrink-0">{r.state}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recent completed runs */}
      {recentRuns.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="font-mono text-xs text-muted uppercase tracking-wide">Recent</div>
          {recentRuns.map(r => (
            <div key={r.runId} className="flex items-center gap-2 font-mono text-xs border border-border/40 rounded px-2 py-1.5">
              <span className={outcomeColor(r.outcome ?? r.state)}>
                {outcomeIcon(r.outcome ?? r.state)}
              </span>
              <span className="text-fg/80 truncate flex-1">{r.workflowName ? `/${r.workflowName}` : r.runId}</span>
              {r.durationMs != null && (
                <span className="text-muted shrink-0">{formatDuration(r.durationMs)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Saved workflows */}
      {savedWorkflows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="font-mono text-xs text-muted uppercase tracking-wide">Saved</div>
          {savedWorkflows.map(w => (
            <div key={w.name} className="flex items-center gap-2 font-mono text-xs text-muted px-1">
              <span className="text-accent/60">⚡</span>
              <span className="text-fg/70 truncate">/{w.name}</span>
            </div>
          ))}
        </div>
      )}

      {runs.length === 0 && savedWorkflows.length === 0 && (
        <div className="font-mono text-xs text-muted/60 text-center py-4">
          No workflows yet.<br />
          Ask the AI to create one.
        </div>
      )}
    </div>
  )
}
