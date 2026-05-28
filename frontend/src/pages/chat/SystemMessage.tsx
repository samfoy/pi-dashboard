import { memo, useState } from 'react'
import MarkdownRenderer from '../../components/MarkdownRenderer'

interface Props {
  content: string
  meta?: Record<string, unknown>
}

// ── pi-conductor ensemble-notification parsing ───────────────────────────
// The pi-conductor extension emits customType='ensemble-notification' for
// two distinct envelopes:
//   1) <sub-agent-stalled>   — watchdog soft/hard stall advisory
//   2) <sub-agent-completed> — terminal sub-agent result
// Both arrive as: "## <glyph> `<persona>` <verb> ... — id `<agent-id>`\n\n```xml\n<envelope>...</envelope>\n```"
// Without dedicated rendering, the generic fallback collapses this into a
// single truncated line.

interface EnsembleNotif {
  kind: 'stalled' | 'completed' | 'unknown'
  persona?: string
  agentId?: string
  status?: string
  duration?: string
  // stall-specific
  severity?: 'soft' | 'hard'
  silentSeconds?: number
  thresholdSeconds?: number
  lastTool?: string
  // completed-specific
  turns?: number
  cost?: number
  result?: string
  error?: string
  warning?: string
  // shared
  transcript?: string
}

function xmlField(body: string, tag: string): string | undefined {
  const m = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return m ? m[1].trim() : undefined
}

function parseEnsembleNotification(content: string): EnsembleNotif | null {
  const stalled = content.includes('<sub-agent-stalled>')
  const completed = content.includes('<sub-agent-completed>')
  if (!stalled && !completed) return null
  const kind: EnsembleNotif['kind'] = stalled ? 'stalled' : completed ? 'completed' : 'unknown'

  // Pull the XML body out of the fenced block so xmlField regex doesn't pick
  // up backtick-fenced pseudo-tags.
  const fence = content.match(/```xml\s*([\s\S]*?)```/)
  const body = fence ? fence[1] : content

  const out: EnsembleNotif = {
    kind,
    agentId: xmlField(body, 'agent-id'),
    persona: xmlField(body, 'persona'),
    status: xmlField(body, 'status'),
    duration: xmlField(body, 'duration'),
    transcript: xmlField(body, 'transcript'),
    lastTool: xmlField(body, 'last-tool'),
    error: xmlField(body, 'error'),
  }

  if (kind === 'stalled') {
    const stall = body.match(/<stall>([\s\S]*?)<\/stall>/)?.[1] ?? ''
    out.severity = (xmlField(stall, 'severity') as 'soft' | 'hard' | undefined) ?? 'soft'
    const ss = xmlField(stall, 'silent-seconds')
    const ts = xmlField(stall, 'threshold-seconds')
    if (ss) out.silentSeconds = Number(ss)
    if (ts) out.thresholdSeconds = Number(ts)
  }

  if (kind === 'completed') {
    const usage = body.match(/<usage>([\s\S]*?)<\/usage>/)?.[1] ?? ''
    const turns = xmlField(usage, 'turns')
    const cost = xmlField(usage, 'cost')
    if (turns) out.turns = Number(turns)
    if (cost) out.cost = Number(cost)
    const result = body.match(/<result>([\s\S]*?)<\/result>/)?.[1]
    if (result) out.result = result.trim()
    const warning = body.match(/<warning[^>]*>([\s\S]*?)<\/warning>/)?.[1]
    if (warning) out.warning = warning.trim()
  }

  return out
}

function EnsembleNotificationCard({ n }: { n: EnsembleNotif }) {
  const [expanded, setExpanded] = useState(false)

  let icon = '·'
  let tone = 'border-border bg-card'
  let iconColor = 'text-muted'
  let label = n.status ?? 'update'

  if (n.kind === 'stalled') {
    if (n.severity === 'hard') { icon = '⚠'; tone = 'border-danger/30 bg-danger/5'; iconColor = 'text-danger'; label = 'hard-stalled' }
    else { icon = '·'; tone = 'border-warning/30 bg-warning/5'; iconColor = 'text-warning'; label = 'soft-stalled' }
  } else if (n.kind === 'completed') {
    switch (n.status) {
      case 'completed': icon = '✓'; tone = 'border-ok/30 bg-ok/5'; iconColor = 'text-ok'; break
      case 'failed': icon = '✗'; tone = 'border-danger/30 bg-danger/5'; iconColor = 'text-danger'; break
      case 'killed': icon = '■'; tone = 'border-danger/30 bg-danger/5'; iconColor = 'text-danger'; break
      case 'timeout': icon = '⏱'; tone = 'border-warning/30 bg-warning/5'; iconColor = 'text-warning'; break
      default: icon = '·'
    }
    label = n.status ?? 'completed'
  }

  return (
    <div className={`px-3.5 py-2.5 rounded-md border text-[13px] font-mono animate-scale-in ${tone}`}>
      <div className="flex items-start gap-2.5">
        <span className={`text-base leading-none mt-0.5 shrink-0 ${iconColor}`}>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {n.persona && <span className="font-semibold text-text">{n.persona}</span>}
            <span className={`text-[12px] ${iconColor}`}>{label}</span>
            {n.kind === 'stalled' && typeof n.silentSeconds === 'number' && (
              <span className="text-muted text-[12px]">
                silent {n.silentSeconds}s{typeof n.thresholdSeconds === 'number' ? ` / ${n.thresholdSeconds}s` : ''}
              </span>
            )}
            {n.duration && <span className="text-muted text-[12px]">({n.duration})</span>}
            {typeof n.turns === 'number' && <span className="text-muted text-[12px]">{n.turns} turns</span>}
            {typeof n.cost === 'number' && n.cost > 0 && <span className="text-muted text-[12px]">${n.cost.toFixed(4)}</span>}
            {n.agentId && (
              <span className="ml-auto text-muted text-[11px] truncate max-w-[40%]" title={n.agentId}>
                {n.agentId}
              </span>
            )}
          </div>

          {n.lastTool && (
            <div className="mt-1.5 text-[12px] text-muted">
              <span className="opacity-60">last:</span>{' '}
              <span className="text-text-strong break-all">{n.lastTool.length > 200 ? n.lastTool.slice(0, 200) + '…' : n.lastTool}</span>
            </div>
          )}

          {n.error && (
            <pre className="mt-1.5 text-[12px] text-danger whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">{n.error}</pre>
          )}
          {n.warning && (
            <pre className="mt-1.5 text-[12px] text-warning whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">{n.warning}</pre>
          )}

          {n.result && (
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="text-[11px] text-accent hover:underline"
              >
                {expanded ? '▾ hide result' : '▸ show result'}
              </button>
              {expanded && (
                <pre className="mt-1 text-[12px] text-text whitespace-pre-wrap break-words max-h-[320px] overflow-y-auto p-2 rounded bg-bg-hover/40 border border-border">{n.result}</pre>
              )}
            </div>
          )}

          {n.transcript && (
            <div className="mt-1.5 text-[11px] text-muted truncate" title={n.transcript}>
              <span className="opacity-60">transcript:</span> {n.transcript}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Parse process update messages like "[ad-process:update] Process 'wiki-deploy' completed successfully (1m 56s)" */
function parseProcessUpdate(content: string) {
  // Strip the [ad-process:*] prefix
  const text = content.replace(/^\[ad-process:[^\]]*\]\s*/, '')

  // Try to extract structured info
  const nameMatch = text.match(/Process '([^']+)'/)
  const name = nameMatch?.[1] ?? 'process'

  const isSuccess = /completed?\s*successfully|finished|done/i.test(text)
  const isFail = /failed|crashed|error|killed|exited/i.test(text)
  const isStart = /started|running|launched/i.test(text)

  const durationMatch = text.match(/\(([^)]*\d+[^)]*)\)\s*$/)
  const duration = durationMatch?.[1]

  // Extract output lines if present (after the first line)
  const lines = text.split('\n')
  const headline = lines[0]
  const output = lines.length > 1 ? lines.slice(1).join('\n').trim() : undefined

  return { name, isSuccess, isFail, isStart, duration, headline, output }
}

const SystemMessage = memo(function SystemMessage({ content, meta }: Props) {
  const customType = meta?.customType as string | undefined

  // Process updates get a styled notification bar
  if (customType?.startsWith('ad-process:')) {
    const { name, isSuccess, isFail, isStart, duration, output } = parseProcessUpdate(content)

    const colorClass = isSuccess ? 'border-ok/30 bg-ok/5' : isFail ? 'border-danger/30 bg-danger/5' : isStart ? 'border-accent/30 bg-accent/5' : 'border-border bg-card'
    const iconColorClass = isSuccess ? 'text-ok' : isFail ? 'text-danger' : isStart ? 'text-accent' : 'text-muted'
    const icon = isSuccess ? '✓' : isFail ? '✗' : isStart ? '▶' : '⚙'
    const statusLabel = isSuccess ? 'completed' : isFail ? 'failed' : isStart ? 'started' : 'update'

    return (
      <div className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-md border text-[13px] font-mono animate-scale-in ${colorClass}`}>
        <span className={`text-base leading-none mt-0.5 shrink-0 ${iconColorClass}`}>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-text">{name}</span>
            <span className={`text-[12px] ${iconColorClass}`}>{statusLabel}</span>
            {duration && <span className="text-muted text-[12px]">({duration})</span>}
          </div>
          {output && (
            <pre className="mt-1.5 text-[12px] text-muted whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">{output}</pre>
          )}
        </div>
      </div>
    )
  }

  // Subagent updates
  if (customType?.startsWith('ad-subagent:')) {
    const text = content.replace(/^\[ad-subagent:[^\]]*\]\s*/, '')
    const isComplete = /complete|finished|done/i.test(text)
    const isFail = /failed|crashed|error/i.test(text)

    const colorClass = isComplete ? 'border-ok/30 bg-ok/5' : isFail ? 'border-danger/30 bg-danger/5' : 'border-accent/30 bg-accent/5'
    const icon = isComplete ? '✓' : isFail ? '✗' : '⧖'
    const iconColor = isComplete ? 'text-ok' : isFail ? 'text-danger' : 'text-accent'

    return (
      <div className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-md border text-[13px] font-mono animate-scale-in ${colorClass}`}>
        <span className={`text-base leading-none shrink-0 ${iconColor}`}>{icon}</span>
        <span className="text-text truncate">{text}</span>
      </div>
    )
  }

  // pi-conductor stall / completion advisories
  if (customType === 'ensemble-notification') {
    const stripped = content.replace(/^\[[^\]]*\]\s*/, '')
    const parsed = parseEnsembleNotification(stripped)
    if (parsed) return <EnsembleNotificationCard n={parsed} />
    // fall through to generic if parse fails
  }

  // pi-essentials subagent_* tool result envelopes (subagent-result)
  if (customType === 'subagent-result') {
    const stripped = content.replace(/^\[[^\]]*\]\s*/, '')
    return <SubagentResultCard content={stripped} />
  }

  // pi-knowledge-search startup overview
  if (customType === 'knowledge-overview') {
    const stripped = content.replace(/^\[[^\]]*\]\s*/, '')
    return <CollapsibleMarkdownCard
      icon="📚"
      title="Knowledge base overview"
      subtitle={typeof meta?.totalNotes === 'number' ? `${meta.totalNotes} note${meta.totalNotes === 1 ? '' : 's'}` : undefined}
      content={stripped}
      defaultOpen={false}
      tone="info"
    />
  }

  // ralph hat orchestration message
  if (customType === 'ralph-hat') {
    const stripped = content.replace(/^\[[^\]]*\]\s*/, '')
    return <CollapsibleMarkdownCard
      icon="🎩"
      title="Ralph hat"
      content={stripped}
      defaultOpen
      tone="info"
    />
  }

  // pi-conductor item 11 (D4) defense — if the customType branch above
  // didn't fire (e.g. customType is missing because of an older pi
  // version, a routing-channel quirk, or session-replay), fall back to
  // sniffing the message body for a sub-agent envelope. The conductor's
  // notifications.ts always emits both a markdown header ("## ✓ `persona`
  // completed ...") and an xml fence (<sub-agent-completed> ...).
  // parseEnsembleNotification only requires the xml fence; if it matches,
  // render the structured card even without the customType marker. This
  // closes the residual visual gap where a witnessed completion rendered
  // as a lowercase-`i` info line instead of a structured card. See
  // pi-conductor docs/items-1-11-pi-dashboard-inspector-map.md §4 D4.
  {
    const stripped = content.replace(/^\[[^\]]*\]\s*/, '')
    const parsed = parseEnsembleNotification(stripped)
    if (parsed) return <EnsembleNotificationCard n={parsed} />
  }

  // Generic system/custom message — simple muted bar
  const text = content.replace(/^\[[^\]]*\]\s*/, '')
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md border border-border bg-card text-[13px] text-muted font-mono animate-scale-in">
      <span className="text-base leading-none shrink-0">ℹ</span>
      <span className="truncate">{text}</span>
    </div>
  )
})

export default SystemMessage

// ── subagent-result (pi-essentials) ────────────────────────────────────────
// Header shape from pi-essentials/src/subagent.ts:
//   `## Subagent \`<id>\` <verb> (<elapsed>[, <usage>])`
// followed by markdown body (output / failure detail / post-mortem hint).

function parseSubagentResultHeader(content: string) {
  const firstLine = content.split('\n', 1)[0] ?? ''
  const m = firstLine.match(/^##\s+Subagent\s+`([^`]+)`\s+(.+?)(?:\s+\(([^)]+)\))?\s*$/)
  if (!m) return null
  const [, id, verb, info] = m
  const lower = verb.toLowerCase()
  let status: 'completed' | 'failed' | 'killed' | 'timeout' | 'unknown' = 'unknown'
  if (lower.includes('complete')) status = 'completed'
  else if (lower.includes('fail')) status = 'failed'
  else if (lower.includes('kill')) status = 'killed'
  else if (lower.includes('time')) status = 'timeout'
  return { id, verb: verb.trim(), info: info?.trim(), status }
}

function SubagentResultCard({ content }: { content: string }) {
  const header = parseSubagentResultHeader(content)
  const body = header ? content.split('\n').slice(1).join('\n').trim() : content
  const [open, setOpen] = useState(false)

  let icon = '·'
  let tone = 'border-border bg-card'
  let iconColor = 'text-muted'
  switch (header?.status) {
    case 'completed': icon = '✓'; tone = 'border-ok/30 bg-ok/5'; iconColor = 'text-ok'; break
    case 'failed':    icon = '✗'; tone = 'border-danger/30 bg-danger/5'; iconColor = 'text-danger'; break
    case 'killed':    icon = '■'; tone = 'border-danger/30 bg-danger/5'; iconColor = 'text-danger'; break
    case 'timeout':   icon = '⏱'; tone = 'border-warning/30 bg-warning/5'; iconColor = 'text-warning'; break
    default: icon = '🤖'
  }

  return (
    <div className={`px-3.5 py-2.5 rounded-md border text-[13px] animate-scale-in ${tone}`}>
      <div className="flex items-center gap-2.5 font-mono">
        <span className={`text-base leading-none shrink-0 ${iconColor}`}>{icon}</span>
        <span className="font-semibold text-text">subagent</span>
        {header?.id && (
          <span className="text-muted text-[12px] truncate" title={header.id}>{header.id}</span>
        )}
        {header?.verb && <span className={`text-[12px] ${iconColor}`}>{header.verb}</span>}
        {header?.info && <span className="text-muted text-[12px]">({header.info})</span>}
        {body && (
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            className="ml-auto text-[11px] text-accent hover:underline shrink-0"
          >
            {open ? '▾ hide' : '▸ show'}
          </button>
        )}
      </div>
      {body && open && (
        <div className="mt-2 max-h-[480px] overflow-y-auto">
          <MarkdownRenderer content={body} />
        </div>
      )}
    </div>
  )
}

// ── Generic collapsible markdown card ─────────────────────────────────
// Used for knowledge-overview, ralph-hat, and any future custom-type that
// just needs a tidy header + collapsible markdown body.

function CollapsibleMarkdownCard({
  icon,
  title,
  subtitle,
  content,
  defaultOpen = false,
  tone = 'muted',
}: {
  icon: string
  title: string
  subtitle?: string
  content: string
  defaultOpen?: boolean
  tone?: 'info' | 'muted' | 'ok' | 'warn'
}) {
  const [open, setOpen] = useState(defaultOpen)
  const toneClass =
    tone === 'info' ? 'border-accent/30 bg-accent/5' :
    tone === 'ok'   ? 'border-ok/30 bg-ok/5' :
    tone === 'warn' ? 'border-warning/30 bg-warning/5' :
                      'border-border bg-card'

  return (
    <div className={`px-3.5 py-2.5 rounded-md border text-[13px] animate-scale-in ${toneClass}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2.5 w-full text-left font-mono hover:opacity-80"
      >
        <span className="text-base leading-none shrink-0">{icon}</span>
        <span className="font-semibold text-text">{title}</span>
        {subtitle && <span className="text-muted text-[12px]">{subtitle}</span>}
        <span className="ml-auto text-[11px] text-accent">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-2 max-h-[480px] overflow-y-auto">
          <MarkdownRenderer content={content} />
        </div>
      )}
    </div>
  )
}
