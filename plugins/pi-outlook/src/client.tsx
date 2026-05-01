// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Outlook plugin — rich rendering for Outlook email/calendar and InternalSearch tools.
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
        {subtitle && <span className="text-[11px] text-muted truncate">{subtitle}</span>}
        {badge && <span className="ml-auto shrink-0">{badge}</span>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function tryParseJSON(text: string): any {
  try { return JSON.parse(text) } catch { return null }
}

function shortDate(d: string): string {
  if (!d) return ''
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch { return d.split('T')[0] || d }
}

// ── email_search ─────────────────────────────────────────────────────────────

function EmailRow({ email }: { email: any }) {
  const [open, setOpen] = useState(false)
  const from = email.from || email.sender || ''
  const subject = email.subject || '(no subject)'
  const date = email.receivedDateTime || email.date || ''
  const preview = email.bodyPreview || email.body || email.snippet || ''

  return (
    <div className="rounded border border-border overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left bg-transparent border-none cursor-pointer hover:bg-bg-hover/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className={`text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="text-[13px] text-text font-medium flex-1 truncate">{subject}</span>
        <span className="text-[11px] text-muted shrink-0">{shortDate(date)}</span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-1 border-t border-border/50 bg-bg-hover/30">
          <div className="text-[11px] text-muted">From: <span className="text-text/80">{from}</span></div>
          <p className="text-[12px] text-text/70 whitespace-pre-wrap">{preview.length > 500 ? preview.slice(0, 500) + '…' : preview}</p>
        </div>
      )}
    </div>
  )
}

export function EmailSearchRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const query = toolInput.query as string || ''
  const data = tryParseJSON(toolResult || '')
  const emails = data?.value || data?.emails || (Array.isArray(data) ? data : [])

  return (
    <CardShell icon="🔍" title={`Email: "${query}"`} badge={
      emails.length > 0 ? <span className="text-[11px] text-muted">{emails.length}</span> : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && emails.length === 0 && <p className="text-muted text-[13px] italic">{toolResult || 'No emails found.'}</p>}
      {!isError && emails.length > 0 && (
        <div className="space-y-1">{emails.slice(0, 15).map((e: any, i: number) => <EmailRow key={i} email={e} />)}</div>
      )}
    </CardShell>
  )
}

// ── email_read ───────────────────────────────────────────────────────────────

export function EmailReadRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const data = tryParseJSON(toolResult || '')
  const subject = data?.subject || ''
  const from = data?.from || ''
  const body = data?.body || data?.bodyPreview || toolResult || ''

  return (
    <CardShell icon="📧" title={subject || 'Email'} subtitle={from} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && (
        <>
          <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer mb-2">
            {expanded ? '▼ Collapse' : '▶ Expand'}
          </button>
          {expanded && (
            <div className="bg-bg-hover rounded-md px-3 py-2 text-[13px] text-text/80 overflow-y-auto max-h-[400px] whitespace-pre-wrap">
              {typeof body === 'string' ? body : JSON.stringify(body, null, 2)}
            </div>
          )}
        </>
      )}
    </CardShell>
  )
}

// ── email_inbox ──────────────────────────────────────────────────────────────

export function EmailInboxRenderer({ toolResult, isError }: ToolProps) {
  const data = tryParseJSON(toolResult || '')
  const emails = data?.value || data?.emails || (Array.isArray(data) ? data : [])

  return (
    <CardShell icon="📥" title="Inbox" badge={
      emails.length > 0 ? <span className="text-[11px] text-muted">{emails.length} emails</span> : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && emails.length === 0 && <p className="text-muted text-[13px] italic">{toolResult || 'Inbox empty.'}</p>}
      {!isError && emails.length > 0 && (
        <div className="space-y-1">{emails.slice(0, 15).map((e: any, i: number) => <EmailRow key={i} email={e} />)}</div>
      )}
    </CardShell>
  )
}

// ── email_send ───────────────────────────────────────────────────────────────

export function EmailSendRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const to = toolInput.to as string[] || []
  const subject = toolInput.subject as string || ''

  return (
    <CardShell icon="📤" title="Send Email" subtitle={subject}
      badge={!isError ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-ok/15 text-ok">✓ Sent</span> : null}
      isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && (
        <div className="text-[13px] text-muted">
          To: <span className="text-text/80">{Array.isArray(to) ? to.join(', ') : to}</span>
        </div>
      )}
    </CardShell>
  )
}

// ── calendar_view ────────────────────────────────────────────────────────────

export function CalendarViewRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const data = tryParseJSON(toolResult || '')
  const events = data?.value || data?.events || (Array.isArray(data) ? data : [])

  return (
    <CardShell icon="📅" title="Calendar" badge={
      events.length > 0 ? <span className="text-[11px] text-muted">{events.length} events</span> : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && events.length === 0 && <p className="text-muted text-[13px] italic">{toolResult || 'No events.'}</p>}
      {!isError && events.length > 0 && (
        <div className="space-y-1">
          <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer">
            {expanded ? '▼' : '▶'} {events.length} event{events.length !== 1 ? 's' : ''}
          </button>
          {expanded && events.map((e: any, i: number) => (
            <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded bg-bg-hover/50 text-[13px]">
              <span className="text-accent shrink-0">•</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text truncate">{e.subject || e.title || '(no title)'}</div>
                <div className="text-[11px] text-muted">
                  {shortDate(e.start?.dateTime || e.startDateTime || e.start || '')}
                  {e.location?.displayName && <span className="ml-2">📍 {e.location.displayName}</span>}
                </div>
              </div>
              {e.isAllDay && <span className="text-[10px] text-muted shrink-0">all day</span>}
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

// ── calendar_meeting ─────────────────────────────────────────────────────────

export function CalendarMeetingRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const operation = toolInput.operation as string || 'read'
  const data = tryParseJSON(toolResult || '')
  const meeting = data?.meeting || data || {}
  const icon = operation === 'create' ? '➕' : operation === 'delete' ? '🗑️' : '📅'
  const title = operation === 'create' ? 'Create Meeting' : operation === 'delete' ? 'Delete Meeting' : 'Meeting Details'

  return (
    <CardShell icon={icon} title={title} subtitle={meeting.subject || meeting.title} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && !data && <pre className="text-muted text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && data && (
        <div className="space-y-1.5 text-[13px]">
          {meeting.subject && <div className="font-medium text-text">{meeting.subject}</div>}
          {(meeting.start || meeting.startDateTime) && <div className="text-muted">🕐 {shortDate(meeting.start?.dateTime || meeting.startDateTime || meeting.start)}</div>}
          {meeting.location?.displayName && <div className="text-muted">📍 {meeting.location.displayName}</div>}
          {meeting.attendees?.length > 0 && (
            <div className="text-muted">👥 {meeting.attendees.map((a: any) => a.emailAddress?.name || a.name || a).join(', ')}</div>
          )}
        </div>
      )}
    </CardShell>
  )
}

// ── InternalSearch ───────────────────────────────────────────────────────────

export function InternalSearchRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0)
  const query = toolInput.query as string || ''
  const domain = toolInput.domain as string || 'ALL'
  const data = tryParseJSON(toolResult || '')
  const results = data?.results || data?.items || (Array.isArray(data) ? data : [])

  return (
    <CardShell icon="🏢" title={`Internal: "${query}"`} subtitle={domain !== 'ALL' ? domain : undefined} badge={
      results.length > 0 ? <span className="text-[11px] text-muted">{results.length} results</span> : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && results.length === 0 && <p className="text-muted text-[13px] italic">{toolResult || 'No results.'}</p>}
      {!isError && results.length > 0 && (
        <div className="space-y-1">
          {results.slice(0, 10).map((r: any, i: number) => (
            <div key={i} className="rounded border border-border overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left bg-transparent border-none cursor-pointer hover:bg-bg-hover/50 transition-colors"
                onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
              >
                <span className={`text-[10px] transition-transform ${expandedIdx === i ? 'rotate-90' : ''}`}>▶</span>
                <span className="text-[13px] text-text font-medium flex-1 truncate">{r.title || r.name || '(untitled)'}</span>
                {r.source && <span className="text-[10px] text-muted shrink-0">{r.source}</span>}
              </button>
              {expandedIdx === i && (
                <div className="px-3 pb-2.5 space-y-1 border-t border-border/50 bg-bg-hover/30">
                  {r.url && <div className="text-[11px] text-accent font-mono truncate">{r.url}</div>}
                  {(r.snippet || r.description || r.body) && (
                    <p className="text-[12px] text-text/70 whitespace-pre-wrap">
                      {(r.snippet || r.description || r.body || '').slice(0, 400)}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}
