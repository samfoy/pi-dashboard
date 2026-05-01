// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Knowledge Search plugin — rich rendering for knowledge_search tool results.
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

interface KnowledgeResult {
  path: string
  heading?: string
  score: string
  excerpt: string
  isKB?: boolean
}

function parseKnowledgeResults(text: string): { results: KnowledgeResult[]; header: string } {
  if (!text) return { results: [], header: '' }
  const lines = text.split('\n')
  const header = lines[0] || ''
  const results: KnowledgeResult[] = []
  let current: Partial<KnowledgeResult> | null = null

  for (const line of lines.slice(1)) {
    const titleMatch = line.match(/^###\s+\d+\.\s+(.+?)\s+\((\d+\.?\d*%?)\s*match\)/)
    if (titleMatch) {
      if (current?.path) results.push(current as KnowledgeResult)
      const raw = titleMatch[1].trim()
      const headingMatch = raw.match(/^(.+?)\s+>\s+(.+)$/)
      const kbMatch = raw.match(/\[([^\]]+)\]/)
      current = {
        path: headingMatch ? headingMatch[1] : raw.replace(/\s*\[[^\]]+\]/, ''),
        heading: headingMatch ? headingMatch[2] : undefined,
        score: titleMatch[2],
        excerpt: '',
        isKB: !!kbMatch || raw.startsWith('s3://') || raw.includes('[KB'),
      }
      continue
    }
    if (!current) continue
    if (line.trim() === '---') { if (current?.path) results.push(current as KnowledgeResult); current = null; continue }
    if (line.trim()) current.excerpt = ((current.excerpt || '') + '\n' + line).trim()
  }
  if (current?.path) results.push(current as KnowledgeResult)
  return { results, header }
}

function shortenPath(p: string): string {
  const parts = p.replace(/^~\//, '').split('/')
  if (parts.length <= 3) return p
  return '…/' + parts.slice(-3).join('/')
}

function scoreColor(score: string): string {
  const n = parseFloat(score)
  if (n >= 80) return 'text-ok'
  if (n >= 60) return 'text-warn'
  return 'text-muted'
}

const mdStyles = '[&_p]:my-1 [&_code]:text-accent [&_code]:text-[11px] [&_pre]:bg-bg-hover [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-[11px] [&_h1]:text-[13px] [&_h2]:text-[12px] [&_h3]:text-[12px] [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:my-0.5 [&_a]:text-accent [&_a]:underline'

export function KnowledgeSearchRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0)
  const query = toolInput.query as string || ''
  const { results } = parseKnowledgeResults(toolResult || '')

  return (
    <div className={`bg-card border rounded-lg overflow-hidden animate-scale-in ${isError ? 'border-danger/30' : 'border-border'}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-hover/50">
        <span className="text-[14px]">📚</span>
        <span className="text-[13px] font-semibold text-text">Knowledge: "{query}"</span>
        {results.length > 0 && <span className="text-[11px] text-muted ml-auto">{results.length} results</span>}
      </div>
      <div className="p-3">
        {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
        {!isError && results.length === 0 && <p className="text-muted text-[13px] italic">{toolResult || 'No results found.'}</p>}
        {!isError && results.length > 0 && (
          <div className="space-y-1">
            {results.map((r, i) => (
              <div key={i} className="rounded border border-border overflow-hidden">
                <button
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-left bg-transparent border-none cursor-pointer hover:bg-bg-hover/50 transition-colors"
                  onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                >
                  <span className={`text-[10px] transition-transform ${expandedIdx === i ? 'rotate-90' : ''}`}>▶</span>
                  <span className="text-[12px]">{r.isKB ? '☁️' : '📄'}</span>
                  <span className="text-[13px] text-text font-medium flex-1 min-w-0 truncate">
                    {r.heading || shortenPath(r.path)}
                  </span>
                  <span className={`text-[11px] font-mono shrink-0 ${scoreColor(r.score)}`}>
                    {r.score.includes('%') ? r.score : r.score + '%'}
                  </span>
                </button>
                {expandedIdx === i && (
                  <div className="px-3 pb-2.5 space-y-1.5 border-t border-border/50 bg-bg-hover/30">
                    <div className="text-[11px] text-muted font-mono truncate">{r.path}</div>
                    {r.heading && <div className="text-[11px] text-accent font-medium">§ {r.heading}</div>}
                    <div className={`text-[12px] text-text/80 leading-relaxed ${mdStyles}`}>
                      <MarkdownRenderer content={r.excerpt} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
