import { useState, useEffect, useRef } from 'react'
import { useAppSelector, useAppDispatch } from '../store'
import { clearExtensionUiRequest } from '../store/chatSlice'
import { api } from '../api/client'

/**
 * Renders extension-raised dialogs (confirm / select / input / editor) as a
 * web modal over the current RPC transport. Subscribes to the additive
 * `extension_ui_request` WS frame (stored in chat state) and POSTs the answer
 * back to `/api/chat/slots/:key/extension-ui-response`.
 *
 * Anti-wedge: the server auto-cancels the request after 60s if unanswered,
 * so a closed tab or unattended dialog can't wedge the slot. Dismissing the
 * modal here POSTs `cancelled: true` immediately.
 */
export default function ExtensionUiModal() {
  const dispatch = useAppDispatch()
  const req = useAppSelector(s => s.chat.extensionUiRequest)

  // Local draft for input/editor/select controls. Reset whenever a new
  // request (different id) arrives.
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const firstFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (!req) return
    // Seed the draft value ONLY from a real prefill/default (editor prefill, or
    // the legacy defaultValue which now carries prefill only). A `placeholder`
    // is a non-submitting hint and must NOT seed the value — otherwise a blind
    // submit would send the hint text back to the extension.
    setValue(req.prefill ?? req.defaultValue ?? '')
    setSubmitting(false)
    // Focus the primary control on open.
    const t = setTimeout(() => firstFieldRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [req?.id])

  if (!req) return null

  const respond = async (body: { cancelled?: boolean; value?: string | boolean }) => {
    if (submitting) return
    setSubmitting(true)
    const id = req.id
    const slot = req.slot
    // Clear immediately for responsive UX; server resolves the RPC promise.
    dispatch(clearExtensionUiRequest({ id }))
    try {
      await api.extensionUiResponse(slot, { id, ...body })
    } catch {
      /* server already cleared or timed out — safe to ignore */
    }
  }

  const cancel = () => respond({ cancelled: true })

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={cancel} />
      <div
        role="dialog"
        aria-modal="true"
        onKeyDown={onKeyDown}
        className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-elevated p-5 shadow-2xl"
      >
        <div className="mb-3 text-sm font-semibold text-text-strong">
          {req.prompt || 'Extension request'}
        </div>
        {req.message && (
          <div className="mb-3 whitespace-pre-wrap text-[13px] text-muted">{req.message}</div>
        )}

        {req.method === 'confirm' && (
          <div className="flex justify-end gap-2">
            <button
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg disabled:opacity-40"
              onClick={cancel}
              disabled={submitting}
            >No</button>
            <button
              className="rounded-lg border-none bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
              onClick={() => respond({ value: true })}
              disabled={submitting}
            >Yes</button>
          </div>
        )}

        {req.method === 'select' && (
          <div className="flex flex-col gap-1.5">
            {(req.options || []).map((opt, i) => (
              <button
                key={i}
                className="rounded-lg border border-border px-3 py-2 text-left text-sm text-text hover:bg-accent-subtle hover:border-accent disabled:opacity-40"
                onClick={() => respond({ value: opt })}
                disabled={submitting}
              >{opt}</button>
            ))}
            <button
              className="mt-1 self-end rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg disabled:opacity-40"
              onClick={cancel}
              disabled={submitting}
            >Cancel</button>
          </div>
        )}

        {req.method === 'input' && (
          <form onSubmit={(e) => { e.preventDefault(); respond({ value }) }}>
            <input
              ref={firstFieldRef as React.RefObject<HTMLInputElement>}
              className="mb-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={req.placeholder}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg disabled:opacity-40" onClick={cancel} disabled={submitting}>Cancel</button>
              <button type="submit" className="rounded-lg border-none bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40" disabled={submitting}>Submit</button>
            </div>
          </form>
        )}

        {req.method === 'editor' && (
          <form onSubmit={(e) => { e.preventDefault(); respond({ value }) }}>
            <textarea
              ref={firstFieldRef as React.RefObject<HTMLTextAreaElement>}
              className="mb-3 h-40 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 font-mono text-[13px] text-text outline-none focus:border-accent"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg disabled:opacity-40" onClick={cancel} disabled={submitting}>Cancel</button>
              <button type="submit" className="rounded-lg border-none bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40" disabled={submitting}>Save</button>
            </div>
          </form>
        )}
      </div>
    </>
  )
}
