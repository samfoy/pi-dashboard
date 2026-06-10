import { memo, useState, useEffect } from 'react'
import type { ChatSlot } from '../../types'

function basename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

function useRuntime(startedIso?: string): string | null {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!startedIso) return
    const id = setInterval(() => tick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [startedIso])
  if (!startedIso) return null
  const started = new Date(startedIso).getTime()
  if (Number.isNaN(started)) return null
  const secs = Math.max(0, Math.floor((Date.now() - started) / 1000))
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

function Cell({ label, value, title, accent }: { label: string; value: string; title?: string; accent?: boolean }) {
  return (
    <span
      className="status-cell"
      title={title ?? `${label}: ${value}`}
      style={accent ? { color: 'var(--accent)' } : undefined}
    >
      <span className="status-cell-label">{label}</span>
      <span className="status-cell-value">{value}</span>
    </span>
  )
}

interface Props {
  slot?: ChatSlot
  modelDisplay?: string
  running?: boolean
}

/**
 * Monospace status-line footer — bordered cells (CWD · MODEL · THINKING · AGENT ·
 * MSGS · RUNTIME), terminal-statusline style. Structure ported from
 * pi-package-webui's footer bar.
 */
const StatusLine = memo(function StatusLine({ slot, modelDisplay, running }: Props) {
  const runtime = useRuntime(slot?.created)
  if (!slot) return null

  return (
    <div className="status-line shrink-0" role="contentinfo" aria-label="Session status">
      {slot.cwd && <Cell label="cwd" value={basename(slot.cwd)} title={slot.cwd} />}
      {(modelDisplay || slot.model) && <Cell label="model" value={modelDisplay || slot.model!} title={slot.model} />}
      {slot.thinkingLevel && <Cell label="think" value={slot.thinkingLevel} />}
      {slot.agent && <Cell label="agent" value={slot.agent} />}
      <Cell
        label="msgs"
        value={slot.tool_calls ? `${slot.messages} · ${slot.tool_calls}⚒` : String(slot.messages)}
        title={`${slot.messages} messages · ${slot.tool_calls ?? 0} tool calls`}
      />
      {runtime && <Cell label="runtime" value={running ? `${runtime} ·` : runtime} title="Time since session created" accent={running} />}
    </div>
  )
})

export default StatusLine
