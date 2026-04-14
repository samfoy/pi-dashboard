import { useState, useEffect } from 'react'
import { truncate, parseToolArgs } from './cardHelpers'

interface Props {
  meta?: Record<string, unknown>
}

export default function SubagentCard({ meta }: Props) {
  const args = meta?.args as string | undefined
  const result = meta?.result as string | undefined
  const isError = meta?.isError as boolean | undefined

  const parsed = parseToolArgs(args)

  const id = parsed.id as string | undefined
  const task = parsed.task as string | undefined
  const model = parsed.model as string | undefined

  const [elapsed, setElapsed] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const running = !result

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  const fmtElapsed = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`

  return (
    <div className="msg-content bg-card border border-border rounded-md animate-scale-in">
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] font-mono bg-transparent border-none text-left hover:text-text transition-colors cursor-pointer"
        onClick={() => result && setExpanded(!expanded)}
        disabled={!result}
      >
        {/* spinner or status icon */}
        {running ? (
          <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
        ) : isError ? (
          <span className="text-danger shrink-0">✗</span>
        ) : (
          <span className="text-ok shrink-0">✓</span>
        )}

        <span className="text-accent font-semibold shrink-0">subagent</span>

        {id && (
          <span className="text-text text-[12px] shrink-0">{id}</span>
        )}

        {task && (
          <span className="text-muted text-[12px] font-normal truncate flex-1">{truncate(task, 60)}</span>
        )}

        <span className="text-muted/50 text-[11px] shrink-0 ml-auto">
          {running ? fmtElapsed(elapsed) : model ? truncate(model.split('/').pop() ?? model, 20) : ''}
        </span>

        {result && (
          <span className={`text-[11px] transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}>▶</span>
        )}
      </button>

      {expanded && result && (
        <div className="px-3 pb-3 border-t border-border">
          <div className={`text-[11px] font-medium uppercase tracking-wider mt-2 mb-1 ${isError ? 'text-danger' : 'text-muted'}`}>
            {isError ? 'Error' : 'Result'}
          </div>
          <pre className={`bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto ${isError ? 'text-danger' : 'text-muted'}`}>
            {result}
          </pre>
        </div>
      )}
    </div>
  )
}
