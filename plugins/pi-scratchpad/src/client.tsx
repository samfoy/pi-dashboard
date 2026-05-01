// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Scratchpad plugin — rich rendering for `note` tool results.
 *
 * Shows structured cards for set/get/list/delete/clear actions
 * with key-value formatting and action-specific icons.
 */
import { useState } from 'react'

interface ToolProps {
  toolName: string
  toolInput: Record<string, unknown>
  toolResult?: string
  isError?: boolean
  sessionId: string
}

const actionConfig: Record<string, { icon: string; label: string }> = {
  set: { icon: '📌', label: 'Set Note' },
  get: { icon: '📎', label: 'Get Note' },
  list: { icon: '📋', label: 'Notes' },
  delete: { icon: '🗑️', label: 'Delete Note' },
  clear: { icon: '🧹', label: 'Clear Notes' },
}

function parseNoteList(text: string): { key: string; value: string }[] {
  if (!text || text === 'No notes yet.') return []
  return text.split('\n').filter(l => l.trim()).map(line => {
    const idx = line.indexOf(': ')
    if (idx === -1) return { key: '', value: line }
    return { key: line.slice(0, idx), value: line.slice(idx + 2) }
  }).filter(n => n.key || n.value)
}

export function NoteRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const action = (toolInput.action as string) || 'list'
  const key = toolInput.key as string
  const value = toolInput.value as string
  const cfg = actionConfig[action] || { icon: '📝', label: action }
  const isList = action === 'list'
  const notes = isList ? parseNoteList(toolResult || '') : []

  return (
    <div className={`bg-card border rounded-lg overflow-hidden animate-scale-in ${isError ? 'border-danger/30' : 'border-border'}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-hover/50">
        <span className="text-[14px]">{cfg.icon}</span>
        <span className="text-[13px] font-semibold text-text">{cfg.label}</span>
        {key && action !== 'list' && <span className="text-[12px] font-mono text-accent">{key}</span>}
        {isList && notes.length > 0 && <span className="text-[11px] text-muted ml-auto">{notes.length} note{notes.length !== 1 ? 's' : ''}</span>}
        {!isList && !isError && (
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-ok/15 text-ok">✓</span>
        )}
        {isError && (
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-danger/15 text-danger">✗</span>
        )}
      </div>
      <div className="p-3">
        {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}

        {/* set action — show key = value */}
        {!isError && action === 'set' && (
          <div className="flex items-start gap-2 px-2 py-1.5 rounded bg-bg-hover/50 text-[13px]">
            <span className="font-mono text-accent font-medium shrink-0">{key}</span>
            <span className="text-muted">=</span>
            <span className="text-text flex-1">{value}</span>
          </div>
        )}

        {/* get action — show value */}
        {!isError && action === 'get' && (
          <div className="px-2 py-1.5 rounded bg-bg-hover/50 text-[13px]">
            <span className="text-text">{toolResult}</span>
          </div>
        )}

        {/* list action — show all notes */}
        {!isError && isList && notes.length === 0 && (
          <p className="text-muted text-[13px] italic">No notes yet.</p>
        )}
        {!isError && isList && notes.length > 0 && (
          <div className="space-y-1">
            <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer">
              {expanded ? '▼' : '▶'} {notes.length} note{notes.length !== 1 ? 's' : ''}
            </button>
            {expanded && notes.map((n, i) => (
              <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded bg-bg-hover/50 text-[13px]">
                <span className="font-mono text-accent font-medium shrink-0">{n.key}</span>
                <span className="text-text flex-1">{n.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* delete/clear — just show confirmation text */}
        {!isError && (action === 'delete' || action === 'clear') && (
          <p className="text-muted text-[13px]">{toolResult}</p>
        )}
      </div>
    </div>
  )
}
