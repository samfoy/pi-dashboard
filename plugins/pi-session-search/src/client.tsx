// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Session Search plugin — rich rendering for session search/list/read tool results.
 */
import { useState } from 'react'
import MarkdownRenderer from '../../../frontend/src/components/MarkdownRenderer'

interface ToolProps {
  toolName: string
  toolInput: Record<string, unknown>
  toolResult?: string
  isError?: boolean
  sessionId: string
}

const mdStyles = '[&_p]:my-1 [&_code]:text-accent [&_code]:text-[11px] [&_pre]:bg-bg-hover [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-[11px] [&_h1]:text-[13px] [&_h2]:text-[12px] [&_h3]:text-[12px] [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:my-0.5 [&_a]:text-accent [&_a]:underline'

function CardShell({ icon, title, subtitle, children, isError }: { icon: string; title: string; subtitle?: string; children: React.ReactNode; isError?: boolean }) {
  return (
    <div className={`bg-card border rounded-lg overflow-hidden animate-scale-in ${isError ? 'border-danger/30' : 'border-border'}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-hover/50">
        <span className="text-[14px]">{icon}</span>
        <span className="text-[13px] font-semibold text-text">{title}</span>
        {subtitle && <span className="text-[11px] text-muted ml-auto">{subtitle}</span>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

// ── session_search ───────────────────────────────────────────────────────────

interface SessionResult {
  title: string
  score: string
  file: string
  id?: string
  date?: string
  cwd?: string
  summary: string
}

function parseSessionSearchResults(text: string): { results: SessionResult[]; header: string } {
  if (!text) return { results: [], header: '' }
  const lines = text.split('\n')
  const header = lines[0] || ''
  const results: SessionResult[] = []
  let current: Partial<SessionResult> | null = null

  for (const line of lines.slice(1)) {
    const titleMatch = line.match(/^###\s+\d+\.\s+(.+?)\s+\((\d+\.?\d*%?)\s*match\)/)
    if (titleMatch) {
      if (current?.title) results.push(current as SessionResult)
      current = { title: titleMatch[1], score: titleMatch[2], summary: '' }
      continue
    }
    if (!current) continue
    const fileMatch = line.match(/^File:\s*(.+)/)
    const idMatch = line.match(/^ID:\s*(.+)/)
    const dateMatch = line.match(/^Date:\s*(.+?)(?:\s*\|\s*CWD:\s*(.+))?$/)
    if (fileMatch) { current.file = fileMatch[1].trim(); continue }
    if (idMatch) { current.id = idMatch[1].trim(); continue }
    if (dateMatch) { current.date = dateMatch[1].trim(); current.cwd = dateMatch[2]?.trim(); continue }
    if (line.trim() === '---') { if (current?.title) results.push(current as SessionResult); current = null; continue }
    if (line.trim()) current.summary = ((current.summary || '') + ' ' + line.trim()).trim()
  }
  if (current?.title) results.push(current as SessionResult)
  return { results, header }
}

export function SessionSearchRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const query = toolInput.query as string || ''
  const { results, header } = parseSessionSearchResults(toolResult || '')

  return (
    <CardShell icon="🔍" title={`Session Search: "${query}"`} subtitle={results.length ? `${results.length} results` : undefined} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && results.length === 0 && <p className="text-muted text-[13px] italic">{toolResult || 'No sessions found.'}</p>}
      {!isError && results.length > 0 && (
        <div className="space-y-1">
          {results.map((r, i) => (
            <div key={i} className="rounded border border-border overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left bg-transparent border-none cursor-pointer hover:bg-bg-hover/50 transition-colors"
                onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
              >
                <span className={`text-[10px] transition-transform ${expandedIdx === i ? 'rotate-90' : ''}`}>▶</span>
                <span className="text-[13px] text-text font-medium flex-1 truncate">{r.title}</span>
                <span className="text-[11px] text-accent font-mono shrink-0">{r.score.includes('%') ? r.score : r.score + '%'}</span>
              </button>
              {expandedIdx === i && (
                <div className="px-3 pb-2.5 space-y-1 border-t border-border/50 bg-bg-hover/30">
                  {r.date && <div className="text-[11px] text-muted">📅 {r.date}</div>}
                  {r.cwd && <div className="text-[11px] text-muted font-mono">📁 {r.cwd}</div>}
                  {r.file && <div className="text-[11px] text-muted font-mono">📄 {r.file}</div>}
                  {r.summary && <div className={`text-[12px] text-text/80 mt-1 ${mdStyles}`}><MarkdownRenderer content={r.summary} /></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

// ── session_list ─────────────────────────────────────────────────────────────

interface SessionListItem {
  title: string
  date: string
  cwd?: string
  msgs?: string
  tools?: string
  file?: string
}

function parseSessionList(text: string): SessionListItem[] {
  if (!text) return []
  const items: SessionListItem[] = []
  let current: Partial<SessionListItem> | null = null

  for (const line of text.split('\n')) {
    // "1. **Title** — 2026-04-30"
    const titleMatch = line.match(/^\d+\.\s+\*\*(.+?)\*\*\s*—\s*(.+)/)
    if (titleMatch) {
      if (current?.title) items.push(current as SessionListItem)
      current = { title: titleMatch[1], date: titleMatch[2].trim() }
      continue
    }
    if (!current) continue
    // "   CWD: /path | 5 msgs | Tools: bash, read"
    const metaMatch = line.match(/CWD:\s*([^|]+)(?:\|\s*(\d+)\s*msgs?)?(?:\|\s*Tools:\s*(.+))?/)
    if (metaMatch) { current.cwd = metaMatch[1].trim(); current.msgs = metaMatch[2]?.trim(); current.tools = metaMatch[3]?.trim(); continue }
    const fileMatch = line.match(/File:\s*(.+)/)
    if (fileMatch) { current.file = fileMatch[1].trim() }
  }
  if (current?.title) items.push(current as SessionListItem)
  return items
}

export function SessionListRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const items = parseSessionList(toolResult || '')
  const project = toolInput.project as string

  return (
    <CardShell icon="📋" title={project ? `Sessions: ${project}` : 'Sessions'} subtitle={items.length ? `${items.length} sessions` : undefined} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && items.length === 0 && <p className="text-muted text-[13px] italic">{toolResult || 'No sessions found.'}</p>}
      {!isError && items.length > 0 && (
        <div className="space-y-1">
          {items.map((s, i) => (
            <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded bg-bg-hover/50 text-[13px]">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text truncate">{s.title}</div>
                <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                  <span>📅 {s.date}</span>
                  {s.msgs && <span>💬 {s.msgs}</span>}
                </div>
                {s.cwd && <div className="text-[11px] text-muted font-mono truncate mt-0.5">📁 {s.cwd}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

// ── session_read ─────────────────────────────────────────────────────────────

export function SessionReadRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(false)
  const session = toolInput.session as string || ''
  const shortName = session.split('/').pop() || session
  const lineCount = (toolResult || '').split('\n').length

  return (
    <CardShell icon="📖" title={`Session: ${shortName}`} subtitle={`${lineCount} lines`} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer mb-2"
          >
            {expanded ? '▼ Collapse' : '▶ Show conversation'} ({lineCount} lines)
          </button>
          {expanded && (
            <div className={`text-[12px] text-text/80 leading-relaxed max-h-[400px] overflow-y-auto ${mdStyles}`}>
              <MarkdownRenderer content={toolResult || ''} />
            </div>
          )}
        </>
      )}
    </CardShell>
  )
}
