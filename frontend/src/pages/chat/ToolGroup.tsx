import { useState, useMemo, memo } from 'react'
import type { ChatMessage } from '../../types'

interface ToolGroupProps {
  tools: { index: number; message: ChatMessage }[]
  renderTool: (i: number, m: ChatMessage) => React.ReactNode
}

/** Collapsible group of consecutive tool calls with a live counter. */
const ToolGroup = memo(function ToolGroup({ tools, renderTool }: ToolGroupProps) {
  const [expanded, setExpanded] = useState(false)

  const summary = useMemo(() => {
    const names = new Map<string, number>()
    let errors = 0
    let completed = 0
    const files: string[] = []
    for (const { message: m } of tools) {
      const name = (m.meta?.toolName as string) || m.content.replace('🔧 ', '')
      names.set(name, (names.get(name) || 0) + 1)
      if (m.meta?.result) completed++
      if (m.meta?.isError) errors++
      // Extract file paths from tool args for richer summary
      if (m.meta?.args && (name === 'edit' || name === 'write' || name === 'read')) {
        try {
          const parsed = JSON.parse(m.meta.args as string)
          if (parsed.path) {
            const short = parsed.path.split('/').pop() || parsed.path
            if (!files.includes(short)) files.push(short)
          }
        } catch { /* ignore */ }
      }
    }
    return { names, errors, completed, total: tools.length, files }
  }, [tools])

  // Don't group single tool calls
  if (tools.length <= 1) {
    return <>{tools.map(t => renderTool(t.index, t.message))}</>
  }

  const nameStr = Array.from(summary.names.entries())
    .map(([name, count]) => count > 1 ? `${name} ×${count}` : name)
    .join(', ')

  return (
    <div className="animate-scale-in">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-muted font-mono bg-card border border-border rounded-md hover:text-text hover:border-border-strong transition-all cursor-pointer mb-1"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse tool calls' : 'Expand tool calls'}
      >
        <span className={`text-[11px] transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <span className="text-accent font-semibold">{summary.total}</span>
        <span>tool calls</span>
        <span className="text-muted/60 text-[12px] truncate flex-1 text-left">
          {nameStr}
          {summary.files.length > 0 && <span className="text-text/50 ml-1.5">— {summary.files.slice(0, 3).join(', ')}{summary.files.length > 3 ? ` +${summary.files.length - 3}` : ''}</span>}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {summary.completed > 0 && <span className="text-ok text-[12px]">✓{summary.completed}</span>}
          {summary.errors > 0 && <span className="text-danger text-[12px]">✗{summary.errors}</span>}
          {summary.completed < summary.total - summary.errors && (
            <span className="inline-block w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="pl-3 border-l-2 border-border ml-3 space-y-1">
          {tools.map(t => (
            <div key={t.index}>{renderTool(t.index, t.message)}</div>
          ))}
        </div>
      )}
    </div>
  )
})

export default ToolGroup

/**
 * Group consecutive tool messages into ToolGroup clusters.
 * Returns an array of { type: 'single', index, message } | { type: 'group', tools }.
 */
export function groupToolMessages(messages: ChatMessage[]): ({ type: 'single'; index: number; message: ChatMessage } | { type: 'group'; tools: { index: number; message: ChatMessage }[] })[] {
  const result: ({ type: 'single'; index: number; message: ChatMessage } | { type: 'group'; tools: { index: number; message: ChatMessage }[] })[] = []
  let currentGroup: { index: number; message: ChatMessage }[] = []

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'tool') {
      // Never group subagent calls — they're long-running and need individual visibility
      const toolName = (m.meta?.toolName as string) || ''
      if (toolName === 'subagent') {
        if (currentGroup.length > 0) {
          if (currentGroup.length > 2) {
            result.push({ type: 'group', tools: currentGroup })
          } else {
            for (const t of currentGroup) result.push({ type: 'single', ...t })
          }
          currentGroup = []
        }
        result.push({ type: 'single', index: i, message: m })
      } else {
        currentGroup.push({ index: i, message: m })
      }
    } else {
      if (currentGroup.length > 0) {
        if (currentGroup.length > 2) {
          result.push({ type: 'group', tools: currentGroup })
        } else {
          for (const t of currentGroup) result.push({ type: 'single', ...t })
        }
        currentGroup = []
      }
      result.push({ type: 'single', index: i, message: m })
    }
  }
  // Flush remaining
  if (currentGroup.length > 0) {
    if (currentGroup.length > 2) {
      result.push({ type: 'group', tools: currentGroup })
    } else {
      for (const t of currentGroup) result.push({ type: 'single', ...t })
    }
  }

  return result
}
