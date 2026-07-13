import { useState, useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import { clearToolApprovalRequest } from '../store/chatSlice'
import { api } from '../api/client'

/**
 * Renders a gated tool call (slice 11, permission-gating UI) as an
 * approve/deny/edit modal. Sibling to ExtensionUiModal — subscribes to the
 * additive `tool_approval_request` WS frame (stored in chat state) and POSTs the
 * decision back to `/api/chat/slots/:key/tool-approval-response`.
 *
 * SDK-only: only SDK slots with the `toolApproval` flag ON ever raise this. The
 * tool name + args are shown; the args are editable JSON (edit-and-approve).
 *
 * Fail-closed: the server DENIES the tool after 120s if unanswered, so a closed
 * tab or unattended prompt can't leave a tool wedged (or silently approved).
 * Dismissing the modal here POSTs `deny` immediately.
 */
export default function ToolApprovalModal() {
  const dispatch = useAppDispatch()
  const req = useAppSelector(s => s.chat.toolApprovalRequest)

  const [argsText, setArgsText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!req) return
    setArgsText(JSON.stringify(req.args ?? {}, null, 2))
    setParseError(null)
    setSubmitting(false)
  }, [req?.id])

  if (!req) return null

  const respond = async (decision: 'approve' | 'deny', editedArgs?: Record<string, unknown>) => {
    if (submitting) return
    setSubmitting(true)
    const id = req.id
    const slot = req.slot
    // Clear immediately for responsive UX; server resolves the pending gate.
    dispatch(clearToolApprovalRequest({ id }))
    try {
      await api.toolApprovalResponse(slot, { id, decision, ...(editedArgs ? { editedArgs } : {}) })
    } catch {
      /* server already resolved or timed out — safe to ignore */
    }
  }

  const deny = () => respond('deny')
  const approve = () => respond('approve')

  // Edit-and-approve: parse the edited JSON; only send editedArgs when it
  // actually differs from the original, so an untouched approve is a plain
  // approve (no arg mutation).
  const approveEdited = () => {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(argsText)
    } catch (e: any) {
      setParseError(e?.message || 'invalid JSON')
      return
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setParseError('args must be a JSON object')
      return
    }
    const changed = JSON.stringify(parsed) !== JSON.stringify(req.args ?? {})
    respond('approve', changed ? parsed : undefined)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); deny() }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={deny} />
      <div
        role="dialog"
        aria-modal="true"
        onKeyDown={onKeyDown}
        className="fixed left-1/2 top-1/2 z-50 w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-elevated p-5 shadow-2xl"
      >
        <div className="mb-1 text-sm font-semibold text-text-strong">
          Approve tool call
        </div>
        <div className="mb-3 text-[13px] text-muted">
          The agent wants to run{' '}
          <span className="font-mono font-semibold text-accent">{req.toolName}</span>
        </div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Arguments (editable)</div>
        <textarea
          className="mb-1 h-48 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 font-mono text-[12px] text-text outline-none focus:border-accent"
          value={argsText}
          onChange={(e) => { setArgsText(e.target.value); setParseError(null) }}
          spellCheck={false}
        />
        {parseError && (
          <div className="mb-2 text-[12px] text-danger">JSON error: {parseError}</div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-danger hover:bg-bg disabled:opacity-40"
            onClick={deny}
            disabled={submitting}
          >Deny</button>
          <button
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg disabled:opacity-40"
            onClick={approveEdited}
            disabled={submitting}
          >Edit &amp; approve</button>
          <button
            className="rounded-lg border-none bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
            onClick={approve}
            disabled={submitting}
          >Approve</button>
        </div>
      </div>
    </>
  )
}
