// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Web plugin — rich rendering for web search and internal page reader tools.
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

const mdStyles = '[&_p]:my-1 [&_code]:text-accent [&_code]:text-[11px] [&_pre]:bg-bg-hover [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-[11px] [&_h1]:text-[13px] [&_h2]:text-[12px] [&_h3]:text-[12px] [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:my-0.5 [&_a]:text-accent [&_a]:underline'

// ── kiro_search ──────────────────────────────────────────────────────────────

interface SearchResult {
  title: string
  url: string
  snippet: string
}

function parseSearchResults(text: string): SearchResult[] {
  if (!text) return []
  const results: SearchResult[] = []

  // Try JSON first
  try {
    const data = JSON.parse(text)
    const items = data?.results || data?.items || data?.organic || (Array.isArray(data) ? data : [])
    for (const item of items) {
      results.push({
        title: item.title || item.name || '(untitled)',
        url: item.url || item.link || item.href || '',
        snippet: item.snippet || item.description || item.content || '',
      })
    }
    if (results.length > 0) return results
  } catch { /* not JSON, parse as text */ }

  // Parse numbered text results: "1. Title\n   URL\n   Snippet"
  const lines = text.split('\n')
  let current: Partial<SearchResult> | null = null
  for (const line of lines) {
    const numMatch = line.match(/^\d+\.\s+(.+)/)
    if (numMatch) {
      if (current?.title) results.push(current as SearchResult)
      current = { title: numMatch[1], url: '', snippet: '' }
      continue
    }
    if (!current) continue
    const trimmed = line.trim()
    if (trimmed.startsWith('http') && !current.url) { current.url = trimmed; continue }
    if (trimmed && !current.snippet) { current.snippet = trimmed }
  }
  if (current?.title) results.push(current as SearchResult)
  return results
}

export function KiroSearchRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0)
  const query = toolInput.query as string || toolInput.q as string || ''
  const results = parseSearchResults(toolResult || '')

  return (
    <CardShell icon="🌐" title={`Search: "${query}"`} badge={
      results.length > 0 ? <span className="text-[11px] text-muted">{results.length} results</span> : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && results.length === 0 && (
        <pre className="text-muted text-[12px] font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto">{toolResult}</pre>
      )}
      {!isError && results.length > 0 && (
        <div className="space-y-1">
          {results.slice(0, 10).map((r, i) => (
            <div key={i} className="rounded border border-border overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left bg-transparent border-none cursor-pointer hover:bg-bg-hover/50 transition-colors"
                onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
              >
                <span className={`text-[10px] transition-transform ${expandedIdx === i ? 'rotate-90' : ''}`}>▶</span>
                <span className="text-[13px] text-text font-medium flex-1 truncate">{r.title}</span>
              </button>
              {expandedIdx === i && (
                <div className="px-3 pb-2.5 space-y-1 border-t border-border/50 bg-bg-hover/30">
                  {r.url && <div className="text-[11px] text-accent font-mono truncate">{r.url}</div>}
                  {r.snippet && <p className="text-[12px] text-text/70">{r.snippet}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

// ── ReadInternalWebsites (CR reader, wiki, quip, etc.) ───────────────────────

export function ReadInternalRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const inputs = toolInput.inputs as string[] || []
  const url = inputs[0] || ''

  // Detect content type from URL
  const isCR = url.includes('code.amazon.com/reviews')
  const isWiki = url.includes('w.amazon.com')
  const isQuip = url.includes('quip-amazon.com')
  const icon = isCR ? '📝' : isWiki ? '📖' : isQuip ? '📄' : '🌐'
  const title = isCR ? 'Code Review' : isWiki ? 'Wiki Page' : isQuip ? 'Quip Doc' : 'Internal Page'

  // Extract CR number if present
  const crMatch = url.match(/CR-(\d+)/)
  const subtitle = crMatch ? `CR-${crMatch[1]}` : url.replace(/^https?:\/\//, '').split('/').slice(0, 2).join('/')

  return (
    <CardShell icon={icon} title={title} subtitle={subtitle} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && (
        <>
          <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer mb-2">
            {expanded ? '▼ Collapse' : '▶ Expand'}
          </button>
          {expanded && (
            <div className={`text-[12px] text-text/80 leading-relaxed max-h-[500px] overflow-y-auto ${mdStyles}`}>
              <MarkdownRenderer content={toolResult || ''} />
            </div>
          )}
        </>
      )}
    </CardShell>
  )
}
