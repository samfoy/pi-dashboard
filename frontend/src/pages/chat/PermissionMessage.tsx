import { useState } from 'react'

/** Threshold (chars) above which tool_input gets an expand/collapse toggle. */
const EXPAND_THRESHOLD = 200

/** Permission approval prompt with optional expandable command details. */
export default function PermissionMessage({ title, toolInput, showButtons, onApprove }: {
  title: string; toolInput: string; showButtons: boolean
  onApprove: (decision: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const needsExpand = toolInput.length > EXPAND_THRESHOLD
  return (
    <div className="bg-card border border-border border-l-[3px] border-l-warn rounded-md px-3.5 py-2.5 text-sm animate-scale-in">
      {toolInput
        ? <><strong>Tool approval requested:</strong></>
        : <>{showButtons ? '📦 Running: ' : '🔧 '}<strong>{title}</strong>{showButtons ? ' wants to run' : ''}</>
      }
      {toolInput && (
        <div className="mt-1.5">
          {needsExpand && !expanded ? (
            <>
              <pre className="bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[4.5em] overflow-hidden text-muted">{toolInput.slice(0, EXPAND_THRESHOLD)}…</pre>
              <button className="text-accent text-[13px] mt-1 cursor-pointer bg-transparent border-none font-body hover:underline" onClick={() => setExpanded(true)}>Show full command</button>
            </>
          ) : (
            <>
              <pre className="bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[40vh] overflow-y-auto text-muted">{toolInput}</pre>
              {needsExpand && <button className="text-accent text-[13px] mt-1 cursor-pointer bg-transparent border-none font-body hover:underline" onClick={() => setExpanded(false)}>Collapse</button>}
            </>
          )}
        </div>
      )}
      {showButtons && (
        <div className="mt-1.5 flex gap-1.5 flex-wrap">
          <button className="px-2.5 py-1 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer font-body hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all" onClick={() => onApprove('approved')}>✅ Approve</button>
          <button className="px-2.5 py-1 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer font-body hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all" onClick={() => onApprove('trust')}>🤝 Trust</button>
          <button className="px-2.5 py-1 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer font-body hover:text-danger hover:border-danger transition-all" onClick={() => onApprove('rejected')}>🚫 Reject</button>
        </div>
      )}
    </div>
  )
}
