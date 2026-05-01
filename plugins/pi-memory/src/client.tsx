// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Memory plugin — rich rendering for memory tool results.
 */
import { useState } from 'react'

interface ToolProps {
  toolName: string
  toolInput: Record<string, unknown>
  toolResult?: string
  isError?: boolean
  sessionId: string
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function Truncated({ text, limit = 100, className = '' }: { text: string; limit?: number; className?: string }) {
  const [show, setShow] = useState(false)
  if (text.length <= limit) return <span className={className}>{text}</span>
  return (
    <span className={className}>
      {show ? text : text.slice(0, limit) + '\u2026'}
      <button onClick={() => setShow(!show)} className="text-accent text-[11px] ml-1 bg-transparent border-none cursor-pointer hover:underline">
        {show ? 'less' : 'more'}
      </button>
    </span>
  )
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${ok ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'}`}>
      {ok ? '✓' : '✗'} {label}
    </span>
  )
}

function CardShell({ icon, title, children, isError }: { icon: string; title: string; children: React.ReactNode; isError?: boolean }) {
  return (
    <div className={`bg-card border rounded-lg overflow-hidden animate-scale-in ${isError ? 'border-danger/30' : 'border-border'}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-hover/50">
        <span className="text-[14px]">{icon}</span>
        <span className="text-[13px] font-semibold text-text">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function confidenceColor(c: string | undefined): string {
  const n = parseFloat(c || '0')
  if (n >= 0.9) return 'text-ok'
  if (n >= 0.7) return 'text-warn'
  return 'text-muted'
}

// ── memory_search ────────────────────────────────────────────────────────────

function parseMemoryResults(text: string): { key: string; value: string; confidence?: string; source?: string }[] {
  if (!text || text.includes('No matching')) return []
  return text.split('\n').filter(l => l.trim()).map(line => {
    const match = line.match(/^(.+?):\s+(.+?)(?:\s+\(confidence:\s*([^,]+),\s*source:\s*([^)]+)\))?$/)
    if (!match) return { key: '', value: line }
    return { key: match[1].trim(), value: match[2].trim(), confidence: match[3]?.trim(), source: match[4]?.trim() }
  }).filter(r => r.key || r.value)
}

export function MemorySearchRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const query = toolInput.query as string || ''
  const results = parseMemoryResults(toolResult || '')
  const empty = results.length === 0

  return (
    <CardShell icon="🧠" title={`Memory Search: "${query}"`} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && empty && <p className="text-muted text-[13px] italic">No matching memories found.</p>}
      {!isError && !empty && (
        <div className="space-y-1.5">
          <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer">
            {expanded ? '▼' : '▶'} {results.length} result{results.length !== 1 ? 's' : ''}
          </button>
          {expanded && results.map((r, i) => (
            <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded bg-bg-hover/50 text-[13px]">
              <span className="font-mono text-accent font-medium shrink-0">{r.key}</span>
              <Truncated text={r.value} limit={120} className="text-text flex-1" />
              {r.confidence && <span className={`text-[11px] shrink-0 font-mono ${confidenceColor(r.confidence)}`}>{r.confidence}</span>}
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

// ── memory_remember ──────────────────────────────────────────────────────────

export function MemoryRememberRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const type = toolInput.type as string || 'fact'
  const key = toolInput.key as string
  const value = toolInput.value as string
  const rule = toolInput.rule as string
  const negative = toolInput.negative as boolean

  return (
    <CardShell icon={type === 'lesson' ? '📝' : '💾'} title={`Remember ${type}`} isError={isError}>
      {isError ? (
        <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>
      ) : (
        <div className="space-y-2">
          <StatusBadge ok={!isError} label="Saved" />
          {type === 'fact' && key && (
            <div className="flex items-start gap-2 px-2 py-1.5 rounded bg-bg-hover/50 text-[13px]">
              <span className="font-mono text-accent font-medium">{key}</span>
              <Truncated text={value || ''} limit={120} className="text-text" />
            </div>
          )}
          {type === 'lesson' && rule && (
            <div className={`px-2 py-1.5 rounded text-[13px] ${negative ? 'bg-danger/10 border border-danger/20' : 'bg-ok/10 border border-ok/20'}`}>
              {negative && <span className="text-danger font-medium mr-1">DON'T:</span>}
              <Truncated text={rule} limit={120} className="text-text" />
            </div>
          )}
        </div>
      )}
    </CardShell>
  )
}

// ── memory_forget ────────────────────────────────────────────────────────────

export function MemoryForgetRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const type = toolInput.type as string || ''
  const key = toolInput.key as string || toolInput.id as string || ''

  return (
    <CardShell icon="🗑️" title={`Forget ${type}`} isError={isError}>
      {isError ? (
        <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>
      ) : (
        <div className="flex items-center gap-2">
          <StatusBadge ok={!isError} label="Removed" />
          <span className="text-[13px] font-mono text-muted">{key}</span>
        </div>
      )}
    </CardShell>
  )
}

// ── memory_lessons ───────────────────────────────────────────────────────────

function parseLessons(text: string): { category: string; rule: string; negative: boolean }[] {
  if (!text || text.includes('No lessons')) return []
  return text.split('\n').filter(l => l.trim()).map(line => {
    const negative = /\bDON'T\b|DON'T|AVOID/i.test(line)
    const catMatch = line.match(/^\d+\.\s*\[([^\]]+)\]\s*(.+)$/)
    if (catMatch) return { category: catMatch[1], rule: catMatch[2], negative }
    return { category: 'general', rule: line.replace(/^\d+\.\s*/, ''), negative }
  }).filter(l => l.rule)
}

export function MemoryLessonsRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const lessons = parseLessons(toolResult || '')
  const category = toolInput.category as string

  return (
    <CardShell icon="📚" title={category ? `Lessons: ${category}` : 'Lessons'} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && lessons.length === 0 && <p className="text-muted text-[13px] italic">No lessons learned yet.</p>}
      {!isError && lessons.length > 0 && (
        <div className="space-y-1.5">
          <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer">
            {expanded ? '▼' : '▶'} {lessons.length} lesson{lessons.length !== 1 ? 's' : ''}
          </button>
          {expanded && lessons.map((l, i) => (
            <div key={i} className={`px-2 py-1.5 rounded text-[13px] ${l.negative ? 'bg-danger/10 border border-danger/20' : 'bg-bg-hover/50'}`}>
              <span className="text-muted text-[11px] font-medium mr-1.5">[{l.category}]</span>
              {l.negative && <span className="text-danger font-medium mr-1">DON'T:</span>}
              <Truncated text={l.rule} limit={120} className="text-text" />
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

// ── memory_stats ─────────────────────────────────────────────────────────────

function parseStats(text: string): { semantic: string; lessons: string; events: string; db?: string } | null {
  const match = text?.match(/(\d+)\s+semantic.*?(\d+)\s+active.*?(\d+)\s+events/)
  if (!match) return null
  const dbMatch = text.match(/DB:\s*(.+)/)
  return { semantic: match[1], lessons: match[2], events: match[3], db: dbMatch?.[1] }
}

export function MemoryStatsRenderer({ toolResult, isError }: ToolProps) {
  const stats = parseStats(toolResult || '')

  return (
    <CardShell icon="📊" title="Memory Stats" isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && !stats && <pre className="text-muted text-[13px] font-mono">{toolResult}</pre>}
      {!isError && stats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Facts', value: stats.semantic, icon: '💾' },
            { label: 'Lessons', value: stats.lessons, icon: '📝' },
            { label: 'Events', value: stats.events, icon: '📅' },
          ].map(s => (
            <div key={s.label} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-bg-hover/50">
              <span className="text-[18px]">{s.icon}</span>
              <span className="text-[20px] font-bold text-text">{s.value}</span>
              <span className="text-[11px] text-muted font-medium">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}
