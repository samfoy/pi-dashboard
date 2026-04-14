import { useState } from 'react'
import { truncate, parseToolArgs } from './cardHelpers'

interface Props {
  meta?: Record<string, unknown>
}

export default function ProcessCard({ meta }: Props) {
  const args = meta?.args as string | undefined
  const result = meta?.result as string | undefined
  const isError = meta?.isError as boolean | undefined
  const [expanded, setExpanded] = useState(false)

  const parsed = parseToolArgs(args)

  const action = parsed.action as string | undefined
  const name = parsed.name as string | undefined
  const command = parsed.command as string | undefined
  const procId = parsed.id as string | undefined

  const actionIcon: Record<string, string> = {
    start: '▶',
    kill: '■',
    output: '≡',
    list: '☰',
    logs: '📄',
    write: '✎',
    clear: '✕',
  }

  const icon = actionIcon[action ?? ''] ?? '⚙'
  const running = action === 'start' && !result

  // Parse result for list action
  const listItems = (() => {
    if (action !== 'list' || !result) return null
    try {
      const parsed = JSON.parse(result)
      if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>
    } catch { /* not json */ }
    return null
  })()

  return (
    <div className="msg-content bg-card border border-border rounded-md animate-scale-in">
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] font-mono bg-transparent border-none text-left hover:text-text transition-colors cursor-pointer"
        onClick={() => (result || listItems) && setExpanded(!expanded)}
        disabled={!result && !listItems}
      >
        {/* status indicator */}
        {running ? (
          <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
        ) : action === 'start' && !isError ? (
          <span className="inline-block w-2 h-2 rounded-full bg-ok shrink-0" />
        ) : action === 'kill' ? (
          <span className="inline-block w-2 h-2 rounded-full bg-muted shrink-0" />
        ) : isError ? (
          <span className="text-danger shrink-0">✗</span>
        ) : (
          <span className="text-[11px] text-muted shrink-0">{icon}</span>
        )}

        <span className="text-accent font-semibold shrink-0">process</span>
        <span className="text-muted text-[12px] shrink-0">{action}</span>

        {name && <span className="text-text text-[12px] shrink-0">{name}</span>}
        {!name && procId && <span className="text-text text-[12px] shrink-0">{procId}</span>}

        {command && (
          <span className="text-muted/60 text-[12px] font-normal truncate flex-1">{truncate(command, 50)}</span>
        )}

        {action === 'start' && !result && (
          <span className="text-ok text-[11px] shrink-0 ml-auto">Running</span>
        )}
        {action === 'kill' && result && !isError && (
          <span className="text-muted text-[11px] shrink-0 ml-auto">Stopped</span>
        )}
        {isError && <span className="text-danger text-[12px] shrink-0 ml-auto">✗ error</span>}
        {result && !isError && action !== 'kill' && (
          <span className="text-ok text-[12px] shrink-0 ml-auto">✓</span>
        )}

        {(result || listItems) && (
          <span className={`text-[11px] transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}>▶</span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-border">
          {listItems ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-[12px] font-mono">
                <thead>
                  <tr className="text-muted text-[11px] uppercase tracking-wider border-b border-border">
                    <th className="text-left py-1 pr-3">ID</th>
                    <th className="text-left py-1 pr-3">Name</th>
                    <th className="text-left py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {listItems.map((p, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0">
                      <td className="py-1 pr-3 text-muted">{String(p.id ?? '')}</td>
                      <td className="py-1 pr-3 text-text">{String(p.name ?? '')}</td>
                      <td className={`py-1 ${p.running ? 'text-ok' : 'text-muted'}`}>{p.running ? 'running' : 'stopped'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : result ? (
            <>
              <div className={`text-[11px] font-medium uppercase tracking-wider mt-2 mb-1 ${isError ? 'text-danger' : 'text-muted'}`}>
                {isError ? 'Error' : 'Result'}
              </div>
              <pre className={`bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto ${isError ? 'text-danger' : 'text-muted'}`}>
                {result}
              </pre>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
