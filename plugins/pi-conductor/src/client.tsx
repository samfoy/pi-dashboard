// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Conductor plugin — rich rendering for ensemble_* sub-agent tools.
 *
 * Tools rendered:
 *   - ensemble_list    persona roster
 *   - ensemble_status  running / queued / paused / finished groups
 *   - ensemble_spawn   foreground/background spawn with status, final excerpt
 *   - ensemble_send    follow-up to existing sub-agent
 *   - ensemble_pause / resume / kill   small action cards
 *   - ensemble_focus   focused-stream overlay request
 *
 * Implementation note: pi-dashboard's ToolRendererSlot only forwards
 * { toolInput, toolResult, isError, sessionId } — not the structured
 * `details` payload — so result text is parsed back into structure here.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

interface ToolProps {
  toolName: string
  toolInput: Record<string, unknown>
  toolResult?: string
  /**
   * Streaming partial result emitted by the tool's onUpdate handler while
   * still running. Conductor pushes `{ content: [{type:'text', text}],
   * details: { agent_id, status, lastToolCall } }` on every transcript
   * tick — we use details.agent_id to start polling record.json /
   * transcript.jsonl immediately, instead of waiting for the final
   * toolResult (which only arrives on completion for fg spawns).
   */
  partialResult?: {
    content?: Array<{ type?: string; text?: string }>
    details?: Record<string, unknown>
  }
  isRunning?: boolean
  isError?: boolean
  sessionId: string
}

// ── Streamed-details synthesis ────────────────────────────────────────────
//
// Foreground ensemble_spawn doesn't return a toolResult until completion.
// While running, conductor pushes partialResult.details with agent_id /
// status / lastToolCall, plus a rendered transcript text in
// partialResult.content[0].text. We synthesise a minimal SpawnParse from
// those so LiveRunInline can start its disk-polling stream right away —
// otherwise the card just sits at "info / TASK" until the spawn finishes.

function synthFromPartial(
  partialResult: ToolProps['partialResult'],
  toolInput: Record<string, unknown>,
  fg: boolean,
): SpawnParse | null {
  const details = partialResult?.details
  const agentId = typeof details?.agent_id === 'string' ? details.agent_id : undefined
  if (!agentId) return null
  const rawStatus = typeof details?.status === 'string' ? details.status : 'running'
  // Conductor's RunStatus values map cleanly onto the parser's status enum.
  const status = ACTIVE_RUN_STATUSES.has(rawStatus) || rawStatus === 'running' ? rawStatus : 'running'
  const persona = typeof toolInput.persona === 'string' ? toolInput.persona : undefined
  return {
    status,
    agentId,
    persona,
    mode: fg ? 'foreground' : 'background',
  }
}

// ── Shared shell ──────────────────────────────────────────────────────────

function Shell({ icon, title, subtitle, badge, children, isError }: {
  icon: string
  title: string
  subtitle?: React.ReactNode
  badge?: React.ReactNode
  children: React.ReactNode
  isError?: boolean
}) {
  return (
    <div className={`bg-card border rounded-lg overflow-hidden animate-scale-in ${isError ? 'border-danger/30' : 'border-border'}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-hover/50">
        <span className="text-[14px]">{icon}</span>
        <span className="text-[13px] font-semibold text-text">{title}</span>
        {subtitle && <span className="text-[11px] text-muted font-mono truncate min-w-0">{subtitle}</span>}
        {badge && <span className="ml-auto shrink-0">{badge}</span>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted'; children: React.ReactNode }) {
  const map = {
    ok: 'bg-ok/15 text-ok',
    warn: 'bg-warning/15 text-warning',
    danger: 'bg-danger/15 text-danger',
    info: 'bg-accent/15 text-accent',
    muted: 'bg-bg-hover text-muted',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${map[tone]}`}>
      {children}
    </span>
  )
}

function ErrorBody({ text }: { text?: string }) {
  return <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{text || '(error)'}</pre>
}

function statusTone(status?: string): 'ok' | 'warn' | 'danger' | 'info' | 'muted' {
  switch (status) {
    case 'completed': return 'ok'
    case 'running': return 'info'
    case 'queued':
    case 'queued-as-background':
    case 'detached-as-background':
    case 'paused': return 'warn'
    case 'failed':
    case 'killed':
    case 'timeout': return 'danger'
    default: return 'muted'
  }
}

function statusGlyph(status?: string): string {
  switch (status) {
    case 'completed': return '✓'
    case 'failed': return '✗'
    case 'killed': return '⊘'
    case 'timeout': return '⏱'
    case 'running': return '▶'
    case 'paused': return '⏸'
    case 'queued':
    case 'queued-as-background':
    case 'detached-as-background': return '⏳'
    default: return '·'
  }
}

// ── ensemble_list ─────────────────────────────────────────────────────────
//
// Output text shape (formatPersonaListForLLM):
//   N personas:
//
//     name           — description
//                      [source=builtin, model=inherited, thinking=inherited, context=filtered]
//     ...

interface PersonaEntry {
  name: string
  description: string
  source?: string
  model?: string
  thinking?: string
  context?: string
}

function parsePersonaList(text: string): PersonaEntry[] {
  if (!text) return []
  const lines = text.split('\n')
  const out: PersonaEntry[] = []
  let current: PersonaEntry | null = null
  for (const raw of lines) {
    const line = raw.trimEnd()
    const m = line.match(/^\s{2,}([a-zA-Z0-9_\-]+)\s+—\s+(.+)$/)
    if (m) {
      if (current) out.push(current)
      current = { name: m[1], description: m[2].trim() }
      continue
    }
    const cfg = line.match(/^\s+\[(.+)\]$/)
    if (cfg && current) {
      for (const part of cfg[1].split(',')) {
        const [k, v] = part.split('=').map(s => s.trim())
        if (k === 'source') current.source = v
        else if (k === 'model') current.model = v
        else if (k === 'thinking') current.thinking = v
        else if (k === 'context') current.context = v
      }
    }
  }
  if (current) out.push(current)
  return out
}

const SOURCE_GLYPH: Record<string, string> = {
  builtin: '📦',
  user: '👤',
  project: '📁',
}

export function EnsembleListRenderer({ toolResult, isError }: ToolProps) {
  const personas = !isError ? parsePersonaList(toolResult || '') : []
  const count = personas.length

  return (
    <Shell
      icon="🎭"
      title="Personas"
      badge={!isError ? <Badge tone="info">{count} available</Badge> : <Badge tone="danger">Failed</Badge>}
      isError={isError}
    >
      {isError && <ErrorBody text={toolResult} />}
      {!isError && count === 0 && (
        <div className="text-[12px] text-muted italic">No personas resolved.</div>
      )}
      {!isError && count > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {personas.map(p => (
            <div key={p.name} className="rounded-md border border-border bg-bg-hover/30 p-2">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-accent font-mono">{p.name}</span>
                {p.source && (
                  <span className="text-[10px] text-muted" title={`source=${p.source}`}>
                    {SOURCE_GLYPH[p.source] ?? '·'} {p.source}
                  </span>
                )}
              </div>
              <div className="text-[12px] text-text/80 mt-0.5">{p.description}</div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {p.model && p.model !== 'inherited' && <Badge tone="muted">{p.model}</Badge>}
                {p.thinking && p.thinking !== 'inherited' && <Badge tone="muted">think:{p.thinking}</Badge>}
                {p.context && <Badge tone="muted">ctx:{p.context}</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}

// ── ensemble_status ───────────────────────────────────────────────────────
//
// Output text shape (formatStatusForLLM):
//   Sub-agents: 1 running, 2 finished.
//
//   Running:
//     <id>                <persona>      <elapsed> [<usage>] → <lastToolCall>
//   Completed:
//     ...

interface StatusEntry {
  id: string
  persona: string
  elapsed: string
  usage?: string
  lastToolCall?: string
}

interface StatusParse {
  summary: string
  groups: Record<string, StatusEntry[]>
  empty: boolean
}

const STATUS_GROUP_LABELS = ['Running', 'Paused', 'Queued', 'Completed', 'Failed', 'Killed', 'Timeout']

function parseStatus(text: string): StatusParse {
  const lines = (text || '').split('\n')
  const summary = lines[0] || ''
  const empty = /^No sub-agents/i.test(summary)
  const groups: Record<string, StatusEntry[]> = {}
  let current: string | null = null
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const header = line.match(/^([A-Z][a-z]+):\s*$/)
    if (header && STATUS_GROUP_LABELS.includes(header[1])) {
      current = header[1]
      groups[current] = []
      continue
    }
    if (!current) continue
    // "  <id> <persona> <elapsed> [usage] → lastToolCall"
    const m = line.match(/^\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+\[([^\]]+)\])?(?:\s+→\s+(.+))?$/)
    if (m) {
      groups[current].push({
        id: m[1],
        persona: m[2],
        elapsed: m[3],
        usage: m[4]?.trim(),
        lastToolCall: m[5]?.trim(),
      })
    }
  }
  return { summary, groups, empty }
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'info' | 'muted'> = {
  Running: 'info',
  Paused: 'warn',
  Queued: 'warn',
  Completed: 'ok',
  Failed: 'danger',
  Killed: 'danger',
  Timeout: 'danger',
}

const STATUS_GLYPH: Record<string, string> = {
  Running: '▶',
  Paused: '⏸',
  Queued: '⏳',
  Completed: '✓',
  Failed: '✗',
  Killed: '⊘',
  Timeout: '⏱',
}

export function EnsembleStatusRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const filterId = toolInput.agent_id as string | undefined
  const parse = !isError ? parseStatus(toolResult || '') : null
  const total = parse ? Object.values(parse.groups).reduce((s, l) => s + l.length, 0) : 0

  return (
    <Shell
      icon="🪄"
      title="Sub-agent status"
      subtitle={filterId ? `filter: ${filterId}` : undefined}
      badge={
        isError ? <Badge tone="danger">Failed</Badge>
        : parse?.empty ? <Badge tone="muted">none</Badge>
        : <Badge tone="info">{total}</Badge>
      }
      isError={isError}
    >
      {isError && <ErrorBody text={toolResult} />}
      {!isError && parse && parse.empty && (
        <div className="text-[12px] text-muted italic">No sub-agents.</div>
      )}
      {!isError && parse && !parse.empty && (
        <div className="space-y-2.5">
          {STATUS_GROUP_LABELS.map(label => {
            const list = parse.groups[label]
            if (!list || list.length === 0) return null
            return (
              <div key={label}>
                <div className="flex items-center gap-2 mb-1">
                  <Badge tone={STATUS_TONE[label]}>
                    <span>{STATUS_GLYPH[label]}</span>
                    <span>{label}</span>
                    <span className="opacity-60">·{list.length}</span>
                  </Badge>
                </div>
                <div className="space-y-1">
                  {list.map(e => (
                    <div key={e.id} className="rounded border border-border/60 bg-bg-hover/30 px-2 py-1 text-[12px] flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-accent">{e.id}</span>
                      <span className="text-text/80">{e.persona}</span>
                      <span className="text-muted">{e.elapsed}</span>
                      {e.usage && <span className="text-muted font-mono text-[11px]">[{e.usage}]</span>}
                      {e.lastToolCall && (
                        <span className="text-muted truncate min-w-0 flex-1">→ {e.lastToolCall}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Shell>
  )
}

// ── ensemble_spawn / ensemble_send shared rendering ───────────────────────
//
// Result text shapes:
//   Foreground completed (renderForegroundSummary):
//     ✓ persona:id completed in 14s [3t ↑1.2k ↓800 $0.012]
//       → "first 120 chars of final assistant text…"
//       Transcript: /path/to/transcript.jsonl
//
//   Background:
//     running: <id>
//     persona=<name> mode=background[ (resumed)]
//
//     Spawned in background. ...
//
//   Queued:
//     queued[-as-background]: <id>
//     persona=<name> queue_position=N
//
//     Spawn queued; ...
//
//   Detached:
//     detached-as-background: <id>
//     persona=<name> mode=background (was foreground)
//
//     Foreground stream detached on user request. ...

interface SpawnParse {
  status: string                 // running | queued | queued-as-background | detached-as-background | completed | failed | killed | timeout
  agentId?: string
  persona?: string
  mode?: string
  queuePosition?: string
  elapsed?: string
  usage?: string
  excerpt?: string
  transcriptPath?: string
  errorMessage?: string
  notice?: string                // trailing prose
}

function parseSpawnResult(text: string): SpawnParse {
  const lines = (text || '').split('\n')
  const head = lines[0] || ''

  // Foreground summary path: starts with a status glyph.
  const fgGlyph = head.match(/^([✓✗⊘⏱])\s+([^:]+):(\S+)\s+(completed|failed|killed|timed out)\s+in\s+(\S+)(?:\s+\[([^\]]+)\])?\s*$/)
  if (fgGlyph) {
    const verbStatus: Record<string, string> = {
      completed: 'completed',
      failed: 'failed',
      killed: 'killed',
      'timed out': 'timeout',
    }
    const out: SpawnParse = {
      status: verbStatus[fgGlyph[4]] || fgGlyph[4],
      persona: fgGlyph[2].trim(),
      agentId: fgGlyph[3].trim(),
      elapsed: fgGlyph[5],
      usage: fgGlyph[6]?.trim(),
    }
    for (let i = 1; i < lines.length; i++) {
      const ln = lines[i]
      const ex = ln.match(/^\s+→\s+"(.*)"\s*$/)
      if (ex) { out.excerpt = ex[1]; continue }
      const errLn = ln.match(/^\s+→\s+(.+)$/)
      if (errLn && !out.excerpt) { out.errorMessage = errLn[1]; continue }
      const tp = ln.match(/^\s+Transcript:\s+(.+)$/)
      if (tp) out.transcriptPath = tp[1].trim()
    }
    return out
  }

  // Status-line shapes: "<status>: <id>"
  const slm = head.match(/^(running|queued|queued-as-background|detached-as-background|paused):\s+(\S+)\s*$/)
  if (slm) {
    const out: SpawnParse = { status: slm[1], agentId: slm[2] }
    const meta = lines[1] || ''
    const personaM = meta.match(/persona=(\S+)/)
    if (personaM) out.persona = personaM[1]
    const modeM = meta.match(/mode=([^\s]+(?:\s+\([^)]*\))?)/)
    if (modeM) out.mode = modeM[1]
    const qpM = meta.match(/queue_position=(\S+)/)
    if (qpM) out.queuePosition = qpM[1]
    // Trailing notice: everything after a blank line.
    const blank = lines.findIndex((l, i) => i > 1 && l.trim() === '')
    if (blank >= 0) {
      const notice = lines.slice(blank + 1).join('\n').trim()
      if (notice) out.notice = notice
    }
    return out
  }

  // Fallback — unknown format.
  return { status: 'info', notice: text }
}

// ── Live run polling (drives inline transcript inside tool cards) ────────
//
// When ensemble_spawn / ensemble_send returns a background or queued status,
// we know the agent_id. We poll record.json and transcript.jsonl from disk
// (~/.pi/agent/conductor/runs/<id>/) until terminal status, then stop. This
// turns the in-chat tool card into a live sub-agent stream — no separate page.

interface RunRecord {
  id: string
  persona: string
  status: 'running' | 'queued' | 'paused' | 'completed' | 'failed' | 'killed' | 'timeout'
  startTime: number
  finishedAt?: number
  errorMessage?: string
  usage?: {
    input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
    cost?: number; turns?: number
  }
  transcriptPath?: string
  finalPath?: string
  recordPath?: string
}

const ACTIVE_RUN_STATUSES = new Set(['running', 'queued', 'paused'])
const RUNS_DIR = '~/.pi/agent/conductor/runs'

async function fetchText(path: string, tailBytes?: number): Promise<string | null> {
  try {
    const url = `/api/file-read?path=${encodeURIComponent(path)}${tailBytes ? `&tail=${tailBytes}` : ''}`
    const res = await fetch(url)
    if (!res.ok) return null
    return res.text()
  } catch {
    return null
  }
}

async function fetchJSON<T>(path: string): Promise<T | null> {
  const t = await fetchText(path)
  if (!t) return null
  try { return JSON.parse(t) as T } catch { return null }
}

interface ActivityEvent {
  kind: 'tool' | 'thinking' | 'text' | 'turn'
  label: string
  detail?: string
}

function summarizeToolInput(name: string, input: any): string {
  if (input == null) return ''
  try {
    if (typeof input === 'string') {
      return input.length > 120 ? input.slice(0, 120) + '…' : input
    }
    // Pull the most informative single field for common tools.
    const pick = (k: string) => typeof input[k] === 'string' ? input[k] : undefined
    const candidate =
      pick('command') ||
      pick('path') ||
      pick('query') ||
      pick('pattern') ||
      pick('url') ||
      pick('file_path') ||
      pick('description')
    const s = candidate ?? JSON.stringify(input)
    return s.length > 140 ? s.slice(0, 140) + '…' : s
  } catch {
    return ''
  }
}

function parseActivity(jsonl: string, max = 60): ActivityEvent[] {
  const out: ActivityEvent[] = []
  if (!jsonl) return out
  // Track in-flight tool calls by contentIndex so we can update detail
  // when toolcall_end carries the final arguments.
  const toolByIdx: Record<number, ActivityEvent> = {}
  const lastTextIdx: Record<number, ActivityEvent> = {}
  for (const ln of jsonl.split('\n')) {
    if (!ln) continue
    let ev: any
    try { ev = JSON.parse(ln) } catch { continue }
    // turn_start is emitted at the top level.
    if (ev.type === 'turn_start') {
      out.push({ kind: 'turn', label: '— turn —' })
      continue
    }
    // Other interesting events are wrapped under message_update.assistantMessageEvent.
    const ame = ev.assistantMessageEvent
    const t = ame?.type
    if (!t) continue
    if (t === 'toolcall_start') {
      const idx = ame.contentIndex
      const content = ame.partial?.content
      const last = Array.isArray(content)
        ? [...content].reverse().find((c: any) => c?.type === 'toolCall')
        : null
      const name = last?.name || '(tool)'
      const detail = summarizeToolInput(name, last?.arguments)
      const evOut: ActivityEvent = { kind: 'tool', label: name, detail }
      out.push(evOut)
      if (typeof idx === 'number') toolByIdx[idx] = evOut
    } else if (t === 'toolcall_end') {
      const idx = ame.contentIndex
      const content = ame.partial?.content
      const last = Array.isArray(content)
        ? [...content].reverse().find((c: any) => c?.type === 'toolCall')
        : null
      const target = (typeof idx === 'number' && toolByIdx[idx]) || null
      if (target) {
        if (last?.name) target.label = last.name
        const detail = summarizeToolInput(last?.name || target.label, last?.arguments)
        if (detail) target.detail = detail
      }
    } else if (t === 'thinking_start') {
      out.push({ kind: 'thinking', label: 'thinking…' })
    } else if (t === 'text_start') {
      const idx = ame.contentIndex
      const evOut: ActivityEvent = { kind: 'text', label: 'response…' }
      out.push(evOut)
      if (typeof idx === 'number') lastTextIdx[idx] = evOut
    } else if (t === 'text_end') {
      const idx = ame.contentIndex
      const content = ame.partial?.content
      const last = Array.isArray(content)
        ? [...content].reverse().find((c: any) => c?.type === 'text')
        : null
      const text: string = (last?.text || '').replace(/\s+/g, ' ').trim()
      const target = typeof idx === 'number' ? lastTextIdx[idx] : null
      if (target && text) {
        target.label = text.length > 140 ? text.slice(0, 140) + '…' : text
      }
    }
  }
  return out.length <= max ? out : out.slice(out.length - max)
}

function fmtElapsed(start?: number, end?: number): string {
  if (!start) return '—'
  const ms = (end || Date.now()) - start
  if (ms < 0) return '0s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60 ? ` ${s % 60}s` : ''}`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function fmtUsage(u?: RunRecord['usage']): string {
  if (!u) return ''
  const parts: string[] = []
  if (u.turns) parts.push(`${u.turns}t`)
  if (u.input) parts.push(`↑${u.input >= 1000 ? (u.input / 1000).toFixed(1) + 'k' : u.input}`)
  if (u.output) parts.push(`↓${u.output >= 1000 ? (u.output / 1000).toFixed(1) + 'k' : u.output}`)
  if (u.cost) parts.push(`$${u.cost.toFixed(4)}`)
  return parts.join(' ')
}

/**
 * Poll a run's record.json + transcript.jsonl while it is non-terminal.
 * Returns null until the first record load completes.
 * Stops polling once the run hits a terminal status.
 */
function useRunStream(agentId: string | undefined, initialStatus: string | undefined) {
  const [record, setRecord] = useState<RunRecord | null>(null)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [final, setFinal] = useState<string | null>(null)
  const stoppedRef = useRef(false)
  const recordRef = useRef<RunRecord | null>(null)
  const transcriptRef = useRef<string | null>(null)

  useEffect(() => {
    if (!agentId) return
    stoppedRef.current = false
    const recordPath = `${RUNS_DIR}/${agentId}/record.json`
    const transcriptPath = `${RUNS_DIR}/${agentId}/transcript.jsonl`
    const finalPath = `${RUNS_DIR}/${agentId}/final.md`

    let cancelled = false

    const tick = async () => {
      const [rec, tx] = await Promise.all([
        fetchJSON<RunRecord>(recordPath),
        // Tail the last 256KB only — transcripts can grow to 100MB+ for long
        // running sub-agents, and we only render the last ~60 events anyway.
        fetchText(transcriptPath, 256 * 1024),
      ])
      if (cancelled) return
      if (rec) { setRecord(rec); recordRef.current = rec }
      if (tx !== null) { setTranscript(tx); transcriptRef.current = tx }
      const status = rec?.status || initialStatus
      const isActive = status && ACTIVE_RUN_STATUSES.has(status)
      if (!isActive) {
        // Load final.md once on terminal.
        if (status === 'completed' || status === 'failed' || status === 'killed' || status === 'timeout') {
          fetchText(finalPath).then(t => { if (!cancelled) setFinal(t || '') })
        }
        stoppedRef.current = true
      }
    }

    tick()
    // Fast cadence until the first record loads, then back off to 2s.
    // Without this, a sub-agent that takes >0s to write record.json shows
    // "loading…" for a full 2s before the second poll.
    let interval: ReturnType<typeof setInterval>
    const schedule = (ms: number) => {
      interval = setInterval(() => {
        if (stoppedRef.current) return
        tick().then(() => {
          if (ms === 500 && (recordRef.current || transcriptRef.current)) {
            clearInterval(interval)
            schedule(2000)
          }
        })
      }, ms)
    }
    schedule(500)

    return () => { cancelled = true; clearInterval(interval) }
  }, [agentId, initialStatus])

  return { record, transcript, final }
}

function ActivityRow({ ev }: { ev: ActivityEvent }) {
  if (ev.kind === 'turn') {
    return (
      <div className="flex items-center gap-2 my-1">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] text-muted">turn</span>
        <div className="flex-1 h-px bg-border" />
      </div>
    )
  }
  const icon = ev.kind === 'tool' ? '🔧' : ev.kind === 'thinking' ? '💭' : '💬'
  const tone = ev.kind === 'tool' ? 'text-accent' : ev.kind === 'thinking' ? 'text-muted italic' : 'text-text/80'
  return (
    <div className="flex items-start gap-2 px-1.5 py-0.5 text-[12px] hover:bg-bg-hover/30 rounded">
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <span className={`font-mono ${tone}`}>{ev.label}</span>
        {ev.detail && (
          <div className="text-[11px] text-muted font-mono truncate" title={ev.detail}>{ev.detail}</div>
        )}
      </div>
    </div>
  )
}

function LiveRunInline({ p, taskInput, sendInput }: {
  p: SpawnParse
  taskInput?: string
  sendInput?: string
}) {
  const [showTask, setShowTask] = useState(false)
  const [showActivity, setShowActivity] = useState(true)
  const [showFinal, setShowFinal] = useState(true)
  const { record, transcript, final } = useRunStream(p.agentId, p.status)

  // Live status (record wins once loaded), else parsed from initial result.
  const status = record?.status || p.status
  const isActive = ACTIVE_RUN_STATUSES.has(status)
  const persona = record?.persona || p.persona
  const elapsed = record
    ? fmtElapsed(record.startTime, record.finishedAt)
    : p.elapsed
  const usage = record?.usage ? fmtUsage(record.usage) : p.usage
  const activity = transcript ? parseActivity(transcript) : []
  const taskOrMsg = taskInput || sendInput || ''
  const taskLabel = sendInput ? 'Message' : 'Task'

  return (
    <div className="space-y-2">
      {/* Status bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone={statusTone(status)}>
          <span>{statusGlyph(status)}</span>
          <span>{status}</span>
          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
        </Badge>
        {persona && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-bg-hover text-[12px]">
            <span className="text-[11px]">🎭</span>
            <span className="font-mono text-accent">{persona}</span>
          </span>
        )}
        {p.agentId && <span className="text-[11px] font-mono text-muted">{p.agentId}</span>}
        {p.mode && <Badge tone="muted">{p.mode}</Badge>}
        {p.queuePosition && <Badge tone="warn">queue #{p.queuePosition}</Badge>}
        {elapsed && <Badge tone="muted">⏱ {elapsed}</Badge>}
        {usage && <span className="text-[11px] font-mono text-muted">[{usage}]</span>}
      </div>

      {/* Task / message — collapsed by default to keep card compact */}
      {taskOrMsg && (
        <div className="rounded border border-border/60 bg-bg-hover/30 overflow-hidden">
          <button
            onClick={() => setShowTask(s => !s)}
            className="w-full flex items-center gap-2 px-2 py-1 hover:bg-bg-hover/60 text-left"
          >
            <span className="text-[10px] uppercase tracking-wider text-muted">{taskLabel}</span>
            <span className="text-[11px] text-text/70 truncate flex-1 min-w-0">
              {taskOrMsg.replace(/\s+/g, ' ').slice(0, 100)}
              {taskOrMsg.length > 100 ? '…' : ''}
            </span>
            <span className="text-[10px] text-muted shrink-0">
              {showTask ? '▾' : '▸'} {taskOrMsg.length}c
            </span>
          </button>
          {showTask && (
            <pre className="px-2 pb-2 pt-0 text-[12px] text-text/85 whitespace-pre-wrap font-mono leading-snug max-h-72 overflow-y-auto">
              {taskOrMsg}
            </pre>
          )}
        </div>
      )}

      {/* Live activity (only meaningful if we have a transcript). */}
      {p.agentId && (transcript !== null || isActive) && (
        <div className="rounded border border-border/60 overflow-hidden">
          <button
            onClick={() => setShowActivity(s => !s)}
            className="w-full flex items-center gap-2 px-2 py-1 bg-bg-hover/40 hover:bg-bg-hover/70 text-left"
          >
            <span className="text-[11px]">📜</span>
            <span className="text-[11px] font-semibold text-text">Activity</span>
            {isActive && (
              <span className="inline-flex items-center gap-1 text-[10px] text-accent">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                live
              </span>
            )}
            <span className="text-[10px] text-muted ml-auto">
              {transcript === null ? 'loading…' : `${activity.length} events ${showActivity ? '▾' : '▸'}`}
            </span>
          </button>
          {showActivity && (
            <div className="p-1 max-h-72 overflow-y-auto">
              {transcript === null && <div className="px-2 py-1 text-muted italic text-[11px]">loading…</div>}
              {transcript !== null && activity.length === 0 && (
                <div className="px-2 py-1 text-muted italic text-[11px]">(no activity yet)</div>
              )}
              {activity.map((e, i) => <ActivityRow key={i} ev={e} />)}
            </div>
          )}
        </div>
      )}

      {/* Final output / excerpt on terminal status. */}
      {!isActive && status === 'completed' && (final || p.excerpt) && (
        <div className="rounded border border-ok/20 bg-ok/5 overflow-hidden">
          <button
            onClick={() => setShowFinal(s => !s)}
            className="w-full flex items-center gap-2 px-2 py-1 hover:bg-ok/10 text-left"
          >
            <span className="text-[11px]">📝</span>
            <span className="text-[11px] font-semibold text-text">Final output</span>
            <span className="text-[10px] text-muted ml-auto">{showFinal ? '▾' : '▸'}</span>
          </button>
          {showFinal && (
            <div className="px-2 pb-2 pt-0 text-[12px] text-text/85 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
              {final !== null && final !== '' ? final
                : p.excerpt ? `"${p.excerpt}"`
                : <span className="text-muted italic">loading…</span>}
            </div>
          )}
        </div>
      )}

      {/* Error / non-completed terminal */}
      {!isActive && status !== 'completed' && (record?.errorMessage || p.errorMessage) && (
        <div className="rounded border border-danger/20 bg-danger/5 p-2 text-[12px] text-text/90">
          {record?.errorMessage || p.errorMessage}
        </div>
      )}

      {/* Notice (queued message etc.) — only show pre-record. */}
      {!record && p.notice && !p.excerpt && !p.errorMessage && (
        <div className="text-[11px] text-muted leading-relaxed">{p.notice}</div>
      )}

      {/* Transcript path footer */}
      {(record?.transcriptPath || p.transcriptPath) && (
        <div
          className="text-[10px] text-muted font-mono truncate"
          title={record?.transcriptPath || p.transcriptPath}
        >
          📜 {record?.transcriptPath || p.transcriptPath}
        </div>
      )}
    </div>
  )
}

export function EnsembleSpawnRenderer({ toolInput, toolResult, partialResult, isRunning, isError }: ToolProps) {
  const persona = (toolInput.persona as string) || ''
  const task = (toolInput.task as string) || ''
  const fg = toolInput.foreground !== false
  // Prefer the final toolResult; fall back to partialResult.details for
  // mid-run streaming (fg spawns don't have a toolResult until they finish).
  const parsedFromResult = !isError ? parseSpawnResult(toolResult || '') : null
  const isUnknown = parsedFromResult?.status === 'info' && !parsedFromResult.agentId
  const synth = (isRunning || isUnknown) && !isError ? synthFromPartial(partialResult, toolInput, fg) : null
  const parsed = synth || parsedFromResult

  return (
    <Shell
      icon="🚀"
      title="Spawn sub-agent"
      subtitle={persona ? `${persona}${fg ? ' · fg' : ' · bg'}` : undefined}
      badge={
        isError ? <Badge tone="danger">Failed</Badge>
        : parsed ? <Badge tone={statusTone(parsed.status)}>{statusGlyph(parsed.status)} {parsed.status}</Badge>
        : null
      }
      isError={isError}
    >
      {isError && <ErrorBody text={toolResult} />}
      {!isError && parsed && <LiveRunInline p={parsed} taskInput={task} />}
    </Shell>
  )
}

export function EnsembleSendRenderer({ toolInput, toolResult, partialResult, isRunning, isError }: ToolProps) {
  const agentId = (toolInput.agent_id as string) || ''
  const message = (toolInput.message as string) || ''
  const fg = toolInput.foreground !== false
  const parsedFromResult = !isError ? parseSpawnResult(toolResult || '') : null
  const isUnknown = parsedFromResult?.status === 'info' && !parsedFromResult.agentId
  const synth = (isRunning || isUnknown) && !isError
    ? synthFromPartial(partialResult, { ...toolInput, persona: undefined }, fg)
    : null
  const parsed = synth || parsedFromResult
  // For send, ensure parsed has agentId even if missing from result text.
  if (parsed && !parsed.agentId && agentId) parsed.agentId = agentId

  return (
    <Shell
      icon="✉️"
      title="Send to sub-agent"
      subtitle={agentId ? `${agentId}${fg ? ' · fg' : ' · bg'}` : undefined}
      badge={
        isError ? <Badge tone="danger">Failed</Badge>
        : parsed ? <Badge tone={statusTone(parsed.status)}>{statusGlyph(parsed.status)} {parsed.status}</Badge>
        : null
      }
      isError={isError}
    >
      {isError && <ErrorBody text={toolResult} />}
      {!isError && parsed && <LiveRunInline p={parsed} sendInput={message} />}
    </Shell>
  )
}

// ── ensemble_pause / resume / kill — small action cards ───────────────────
//
// Result text shapes:
//   "paused: <id>"
//   "resumed: <id>"
//   "killed: <id>"
//   "already <status>: <id> (no-op)"

function ActionRenderer({
  icon, title, action, toolInput, toolResult, isError,
  okWord, okTone,
}: {
  icon: string
  title: string
  action: 'paused' | 'resumed' | 'killed'
  toolInput: Record<string, unknown>
  toolResult?: string
  isError?: boolean
  okWord: string
  okTone: 'ok' | 'warn' | 'danger' | 'info'
}) {
  const agentId = (toolInput.agent_id as string) || ''
  const text = toolResult || ''
  const noop = /^already\s+/.test(text)
  const noopMatch = text.match(/^already\s+(\S+):\s+(\S+)\s+\(no-op\)/)

  return (
    <Shell
      icon={icon}
      title={title}
      subtitle={agentId ? agentId : undefined}
      badge={
        isError ? <Badge tone="danger">✗ Failed</Badge>
        : noop ? <Badge tone="muted">no-op</Badge>
        : <Badge tone={okTone}>{statusGlyph(action)} {okWord}</Badge>
      }
      isError={isError}
    >
      {isError && <ErrorBody text={toolResult} />}
      {!isError && !noop && (
        <div className="text-[12px] text-text/80">
          Sub-agent <span className="font-mono text-accent">{agentId}</span> {okWord.toLowerCase()}.
        </div>
      )}
      {!isError && noop && noopMatch && (
        <div className="text-[12px] text-muted">
          Already <span className="font-mono text-text/80">{noopMatch[1]}</span>; no action taken.
        </div>
      )}
    </Shell>
  )
}

export function EnsemblePauseRenderer(props: ToolProps) {
  return <ActionRenderer icon="⏸" title="Pause sub-agent" action="paused"
    okWord="Paused" okTone="warn" {...props} />
}

export function EnsembleResumeRenderer(props: ToolProps) {
  return <ActionRenderer icon="▶" title="Resume sub-agent" action="resumed"
    okWord="Resumed" okTone="ok" {...props} />
}

export function EnsembleKillRenderer(props: ToolProps) {
  return <ActionRenderer icon="⊘" title="Kill sub-agent" action="killed"
    okWord="Killed" okTone="danger" {...props} />
}

// ── ensemble_focus ────────────────────────────────────────────────────────
//
// Result text shapes:
//   "Focused stream opened on <id>."
//   "No sub-agents to focus on."
//   "agent_id \"<id>\" not found. ..."

export function EnsembleFocusRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const agentId = (toolInput.agent_id as string) || ''
  const text = toolResult || ''
  const opened = /^Focused stream opened on/.test(text)
  const none = /^No sub-agents/.test(text)

  return (
    <Shell
      icon="🔎"
      title="Focus sub-agent"
      subtitle={agentId || (opened ? '(most recent)' : undefined)}
      badge={
        isError ? <Badge tone="danger">✗ Failed</Badge>
        : opened ? <Badge tone="info">opened</Badge>
        : none ? <Badge tone="muted">none</Badge>
        : <Badge tone="warn">⚠</Badge>
      }
      isError={isError}
    >
      {isError && <ErrorBody text={toolResult} />}
      {!isError && (
        <div className="text-[12px] text-text/80">
          {text || '(no output)'}
        </div>
      )}
    </Shell>
  )
}
