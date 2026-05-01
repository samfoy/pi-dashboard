// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Slack plugin — rich rendering for Slack MCP tools.
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

function formatTs(ts: string): string {
  if (!ts) return ''
  // Slack timestamps: "1234567890.123456" → Date
  const secs = parseFloat(ts)
  if (isNaN(secs)) return ts
  const d = new Date(secs * 1000)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function SlackMessage({ msg }: { msg: any }) {
  const user = msg.user || msg.username || msg.user_id || 'unknown'
  const text = msg.text || msg.message || ''
  const ts = msg.ts || msg.timestamp || ''

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded bg-bg-hover/50 text-[13px]">
      <span className="text-accent font-medium shrink-0 text-[12px]">@{user}</span>
      <span className="text-text/80 flex-1 whitespace-pre-wrap break-words">{text.length > 200 ? text.slice(0, 200) + '…' : text}</span>
      {ts && <span className="text-muted/50 text-[10px] shrink-0">{formatTs(ts)}</span>}
    </div>
  )
}

// ── search ───────────────────────────────────────────────────────────────────

export function SlackSearchRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const query = toolInput.query as string || ''
  const data = tryParseJSON(toolResult || '')
  const messages = data?.messages?.matches || data?.messages || (Array.isArray(data) ? data : [])

  return (
    <CardShell icon="🔍" title={`Slack: "${query}"`} badge={
      messages.length > 0 ? <span className="text-[11px] text-muted">{messages.length} results</span> : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && messages.length === 0 && <p className="text-muted text-[13px] italic">{toolResult || 'No messages found.'}</p>}
      {!isError && messages.length > 0 && (
        <div className="space-y-1">
          <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer">
            {expanded ? '▼' : '▶'} {messages.length} message{messages.length !== 1 ? 's' : ''}
          </button>
          {expanded && messages.slice(0, 15).map((m: any, i: number) => <SlackMessage key={i} msg={m} />)}
          {expanded && messages.length > 15 && <span className="text-muted text-[11px] px-2">+{messages.length - 15} more</span>}
        </div>
      )}
    </CardShell>
  )
}

// ── post_message ─────────────────────────────────────────────────────────────

export function SlackPostRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const channel = toolInput.channelId as string || ''
  const text = toolInput.text as string || ''

  return (
    <CardShell icon="💬" title="Post Message" subtitle={channel}
      badge={!isError ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-ok/15 text-ok">✓ Sent</span> : null}
      isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && (
        <div className="px-2 py-1.5 rounded bg-bg-hover/50 text-[13px] text-text/80 whitespace-pre-wrap">
          {text}
        </div>
      )}
    </CardShell>
  )
}

// ── batch_get_conversation_history ───────────────────────────────────────────

export function SlackHistoryRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const channels = toolInput.channels as any[]
  const channelId = channels?.[0]?.channelId || ''
  const data = tryParseJSON(toolResult || '')
  // Result is typically { channels: [{ channelId, messages: [...] }] } or flat array
  const allMessages = data?.channels?.[0]?.messages || data?.messages || (Array.isArray(data) ? data : [])

  return (
    <CardShell icon="📜" title="Channel History" subtitle={channelId} badge={
      allMessages.length > 0 ? <span className="text-[11px] text-muted">{allMessages.length} msgs</span> : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && allMessages.length === 0 && <p className="text-muted text-[13px] italic">{toolResult || 'No messages.'}</p>}
      {!isError && allMessages.length > 0 && (
        <div className="space-y-1">
          <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer">
            {expanded ? '▼' : '▶'} {allMessages.length} message{allMessages.length !== 1 ? 's' : ''}
          </button>
          {expanded && allMessages.slice(0, 20).map((m: any, i: number) => <SlackMessage key={i} msg={m} />)}
          {expanded && allMessages.length > 20 && <span className="text-muted text-[11px] px-2">+{allMessages.length - 20} more</span>}
        </div>
      )}
    </CardShell>
  )
}

// ── batch_get_thread_replies ─────────────────────────────────────────────────

export function SlackThreadRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const threads = toolInput.threads as any[]
  const threadTs = threads?.[0]?.threadTs || ''
  const data = tryParseJSON(toolResult || '')
  const replies = data?.threads?.[0]?.messages || data?.messages || (Array.isArray(data) ? data : [])

  return (
    <CardShell icon="🧵" title="Thread Replies" subtitle={threadTs ? `thread ${threadTs}` : undefined} badge={
      replies.length > 0 ? <span className="text-[11px] text-muted">{replies.length} replies</span> : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && replies.length === 0 && <p className="text-muted text-[13px] italic">{toolResult || 'No replies.'}</p>}
      {!isError && replies.length > 0 && (
        <div className="space-y-1">
          <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer">
            {expanded ? '▼' : '▶'} {replies.length} repl{replies.length !== 1 ? 'ies' : 'y'}
          </button>
          {expanded && replies.map((m: any, i: number) => <SlackMessage key={i} msg={m} />)}
        </div>
      )}
    </CardShell>
  )
}
