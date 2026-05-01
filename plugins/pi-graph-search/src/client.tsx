// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Graph Search plugin — rich rendering for knowledge graph tools.
 *
 * - graph_query: entity cards with relationships
 * - graph_path: connection chain visualization
 * - graph_ingest: ingest status
 * - graph_visualize: inline graph image
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
        {subtitle && <span className="text-[11px] text-muted font-mono truncate">{subtitle}</span>}
        {badge && <span className="ml-auto shrink-0">{badge}</span>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

const typeIcons: Record<string, string> = {
  person: '👤', package: '📦', cr: '📝', ticket: '🎫', task: '✅',
  meeting: '📅', project: '🏗️', service: '⚙️', decision: '⚖️',
  pattern: '🔄', error: '🐛', team: '👥', document: '📄',
}

// ── graph_query ──────────────────────────────────────────────────────────────

interface EntityResult {
  name: string
  type: string
  confidence?: string
  firstSeen?: string
  lastSeen?: string
  properties: string
  relationships: { direction: '←' | '→'; type: string; targets: string }[]
  neighbors: { depth: number; name: string; type: string }[]
}

function parseQueryResults(text: string): EntityResult[] {
  if (!text || text.includes('No entities found')) return []
  const entities: EntityResult[] = []
  let current: Partial<EntityResult> | null = null

  for (const line of text.split('\n')) {
    // "### EntityName (type)"
    const headerMatch = line.match(/^###\s+(.+?)\s+\((\w+)\)/)
    if (headerMatch) {
      if (current?.name) entities.push(current as EntityResult)
      current = { name: headerMatch[1], type: headerMatch[2], relationships: [], neighbors: [], properties: '' }
      continue
    }
    if (!current) continue

    if (line.startsWith('Confidence:')) {
      const parts = line.match(/Confidence:\s*(\S+).*?First seen:\s*(\S+).*?Last seen:\s*(\S+)/)
      if (parts) { current.confidence = parts[1]; current.firstSeen = parts[2]; current.lastSeen = parts[3] }
      continue
    }
    if (line.startsWith('Properties:')) { current.properties = line.replace('Properties: ', ''); continue }

    // "  ← type: name1, name2" or "  → type: name1, name2"
    const relMatch = line.match(/^\s+(←|→)\s+(\w+):\s+(.+)/)
    if (relMatch) {
      current.relationships!.push({ direction: relMatch[1] as '←' | '→', type: relMatch[2], targets: relMatch[3] })
      continue
    }

    // "  [depth N] Name (type)"
    const neighborMatch = line.match(/^\s+\[depth (\d+)\]\s+(.+?)\s+\((\w+)\)/)
    if (neighborMatch) {
      current.neighbors!.push({ depth: parseInt(neighborMatch[1]), name: neighborMatch[2], type: neighborMatch[3] })
    }
  }
  if (current?.name) entities.push(current as EntityResult)
  return entities
}

export function GraphQueryRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0)
  const query = toolInput.query as string || ''
  const type = toolInput.type as string
  const entities = parseQueryResults(toolResult || '')

  return (
    <CardShell icon="🔮" title={`Graph: "${query}"`} subtitle={type} badge={
      entities.length > 0 ? <span className="text-[11px] text-muted">{entities.length} entities</span> : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && entities.length === 0 && <p className="text-muted text-[13px] italic">{toolResult || 'No entities found.'}</p>}
      {!isError && entities.length > 0 && (
        <div className="space-y-1">
          {entities.map((e, i) => (
            <div key={i} className="rounded border border-border overflow-hidden">
              <button
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left bg-transparent border-none cursor-pointer hover:bg-bg-hover/50 transition-colors"
                onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
              >
                <span className={`text-[10px] transition-transform ${expandedIdx === i ? 'rotate-90' : ''}`}>▶</span>
                <span className="text-[13px]">{typeIcons[e.type] || '•'}</span>
                <span className="text-[13px] text-text font-medium flex-1 truncate">{e.name}</span>
                <span className="text-[11px] text-muted shrink-0">{e.type}</span>
              </button>
              {expandedIdx === i && (
                <div className="px-3 pb-2.5 space-y-1.5 border-t border-border/50 bg-bg-hover/30">
                  {e.confidence && (
                    <div className="flex gap-3 text-[11px] text-muted">
                      <span>Confidence: {e.confidence}</span>
                      {e.firstSeen && <span>Since: {e.firstSeen}</span>}
                      {e.lastSeen && <span>Last: {e.lastSeen}</span>}
                    </div>
                  )}
                  {e.properties && <div className="text-[11px] text-muted font-mono truncate">{e.properties}</div>}
                  {e.relationships.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted uppercase tracking-wider">Relationships</div>
                      {e.relationships.map((r, j) => (
                        <div key={j} className="flex items-center gap-1.5 text-[12px] pl-2">
                          <span className="text-accent shrink-0">{r.direction}</span>
                          <span className="text-muted font-mono">{r.type}</span>
                          <span className="text-text/80 truncate">{r.targets}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {e.neighbors.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted uppercase tracking-wider">Neighbors</div>
                      {e.neighbors.slice(0, 8).map((n, j) => (
                        <div key={j} className="flex items-center gap-1.5 text-[12px] pl-2">
                          <span className="text-muted/50 text-[10px]">d{n.depth}</span>
                          <span className="text-[11px]">{typeIcons[n.type] || '•'}</span>
                          <span className="text-text/80">{n.name}</span>
                          <span className="text-muted text-[10px]">{n.type}</span>
                        </div>
                      ))}
                      {e.neighbors.length > 8 && <span className="text-muted text-[11px] pl-2">+{e.neighbors.length - 8} more</span>}
                    </div>
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

// ── graph_path ───────────────────────────────────────────────────────────────

export function GraphPathRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const from = toolInput.from as string || ''
  const to = toolInput.to as string || ''

  return (
    <CardShell icon="🔗" title="Graph Path" subtitle={`${from} → ${to}`} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && (
        <pre className="bg-bg-hover rounded-md px-3 py-2 text-[12px] font-mono overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto text-text/80">
          {toolResult || 'No path found.'}
        </pre>
      )}
    </CardShell>
  )
}

// ── graph_ingest ─────────────────────────────────────────────────────────────

export function GraphIngestRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const path = toolInput.path as string
  const source = toolInput.source as string
  const full = toolInput.full as boolean

  const label = path ? path.split('/').pop() : source ? `source: ${source}` : full ? 'full sync' : 'ingest'
  const ok = !isError && toolResult && !toolResult.startsWith('❌')

  return (
    <CardShell icon="📥" title="Graph Ingest" subtitle={label} badge={
      ok ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-ok/15 text-ok">✓ Done</span>
         : isError ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-danger/15 text-danger">✗ Failed</span>
         : null
    } isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && <p className="text-[13px] text-text/80">{toolResult}</p>}
    </CardShell>
  )
}

// ── graph_visualize ──────────────────────────────────────────────────────────

export function GraphVisualizeRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const query = toolInput.query as string || toolInput.entity as string || ''
  const mode = toolInput.mode as string || 'neighborhood'

  // The result may contain an image path or markdown image
  const imgMatch = toolResult?.match(/!\[.*?\]\(([^)]+)\)/)
  const pathMatch = toolResult?.match(/(?:saved to|wrote|generated).*?(\S+\.png)/i)
  const imgSrc = imgMatch ? imgMatch[1] : pathMatch ? `/api/local-file?path=${encodeURIComponent(pathMatch[1])}` : null

  return (
    <CardShell icon="🕸️" title="Graph Visualize" subtitle={`${mode}: ${query}`} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && imgSrc && (
        <img src={imgSrc} alt={`Graph: ${query}`} className="max-w-full rounded-md border border-border" />
      )}
      {!isError && !imgSrc && (
        <pre className="bg-bg-hover rounded-md px-3 py-2 text-[12px] font-mono overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto text-text/80">
          {toolResult || 'No visualization generated.'}
        </pre>
      )}
    </CardShell>
  )
}
