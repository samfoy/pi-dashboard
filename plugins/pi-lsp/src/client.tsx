// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi LSP plugin — rich rendering for LSP tool results.
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

function FileLocation({ loc }: { loc: string }) {
  // "src/foo.ts:12:5" → highlight file vs line
  const match = loc.match(/^(.+?):(\d+):?(\d+)?$/)
  if (!match) return <span className="font-mono text-[12px] text-text">{loc}</span>
  return (
    <span className="font-mono text-[12px]">
      <span className="text-accent">{match[1]}</span>
      <span className="text-muted">:{match[2]}</span>
      {match[3] && <span className="text-muted/60">:{match[3]}</span>}
    </span>
  )
}

// ── lsp_diagnostics ──────────────────────────────────────────────────────────

interface Diagnostic {
  file: string
  line: string
  col: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  code?: string
  source?: string
}

function parseDiagnostics(text: string): { diagnostics: Diagnostic[]; summary: string } {
  if (!text) return { diagnostics: [], summary: '' }
  const lines = text.split('\n')
  const summary = lines[0] || ''
  const diagnostics: Diagnostic[] = []

  for (const line of lines.slice(1)) {
    // "src/foo.ts:12:5 error: Type 'string' is not assignable (2322) [typescript]"
    const match = line.match(/^(.+?):(\d+):(\d+)\s+(error|warning|info|hint):\s+(.+?)(?:\s+\((\d+)\))?(?:\s+\[([^\]]+)\])?$/)
    if (match) {
      diagnostics.push({
        file: match[1], line: match[2], col: match[3],
        severity: match[4] as Diagnostic['severity'],
        message: match[5], code: match[6], source: match[7],
      })
    }
  }
  return { diagnostics, summary }
}

const severityConfig = {
  error: { icon: '✗', color: 'text-danger', bg: 'bg-danger/10 border-danger/20' },
  warning: { icon: '⚠', color: 'text-warn', bg: 'bg-warn/10 border-warn/20' },
  info: { icon: 'ℹ', color: 'text-accent', bg: 'bg-accent/10 border-accent/20' },
  hint: { icon: '💡', color: 'text-muted', bg: 'bg-bg-hover border-border' },
}

export function DiagnosticsRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const path = toolInput.path as string || ''
  const { diagnostics, summary } = parseDiagnostics(toolResult || '')
  const clean = !isError && diagnostics.length === 0 && toolResult?.includes('clean')
  const errors = diagnostics.filter(d => d.severity === 'error').length
  const warnings = diagnostics.filter(d => d.severity === 'warning').length

  const badge = clean
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-ok/15 text-ok">✓ Clean</span>
    : errors > 0
      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-danger/15 text-danger">{errors} error{errors !== 1 ? 's' : ''}{warnings > 0 ? `, ${warnings} warn` : ''}</span>
      : warnings > 0
        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-warn/15 text-warn">{warnings} warning{warnings !== 1 ? 's' : ''}</span>
        : null

  return (
    <CardShell icon="🔬" title="Diagnostics" subtitle={path === '*' ? 'workspace' : path} badge={badge} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {clean && <p className="text-ok text-[13px] font-medium">No diagnostics — all clean! ✨</p>}
      {!isError && !clean && diagnostics.length === 0 && <pre className="text-muted text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && diagnostics.length > 0 && (
        <div className="space-y-1">
          {diagnostics.map((d, i) => {
            const cfg = severityConfig[d.severity]
            return (
              <div key={i} className={`flex items-start gap-2 px-2 py-1.5 rounded border text-[12px] ${cfg.bg}`}>
                <span className={`${cfg.color} shrink-0 font-bold`}>{cfg.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <FileLocation loc={`${d.file}:${d.line}:${d.col}`} />
                    {d.code && <span className="text-muted/60 text-[10px]">({d.code})</span>}
                  </div>
                  <div className="text-text/80 mt-0.5">{d.message}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </CardShell>
  )
}

// ── lsp_hover ────────────────────────────────────────────────────────────────

export function HoverRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const path = toolInput.path as string || ''
  const line = toolInput.line as number
  const char = toolInput.character as number
  const shortPath = path.split('/').pop() || path

  return (
    <CardShell icon="💬" title="Hover" subtitle={`${shortPath}:${line}:${char}`} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && (
        <pre className="bg-bg-hover rounded-md px-3 py-2 text-[12px] font-mono overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto text-text">
          {toolResult}
        </pre>
      )}
    </CardShell>
  )
}

// ── lsp_definition ───────────────────────────────────────────────────────────

export function DefinitionRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const path = toolInput.path as string || ''
  const line = toolInput.line as number
  const char = toolInput.character as number
  const shortPath = path.split('/').pop() || path

  // Parse "Definition: file:line:col" or "Definitions:\n  file:line\n  file:line"
  const locations = (toolResult || '').split('\n')
    .map(l => l.replace(/^Definitions?:\s*/, '').trim())
    .filter(l => l && l.includes(':') && !l.startsWith('No '))

  return (
    <CardShell icon="🎯" title="Definition" subtitle={`${shortPath}:${line}:${char}`} isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && locations.length === 0 && <p className="text-muted text-[13px] italic">{toolResult}</p>}
      {!isError && locations.length > 0 && (
        <div className="space-y-1">
          {locations.map((loc, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded bg-bg-hover/50">
              <span className="text-[12px]">📍</span>
              <FileLocation loc={loc} />
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

// ── lsp_references ───────────────────────────────────────────────────────────

export function ReferencesRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const path = toolInput.path as string || ''
  const line = toolInput.line as number
  const char = toolInput.character as number
  const shortPath = path.split('/').pop() || path

  const lines = (toolResult || '').split('\n').filter(l => l.trim())
  const countMatch = lines[0]?.match(/(\d+)\s+reference/)
  const count = countMatch ? parseInt(countMatch[1]) : 0
  const locations = lines.filter(l => l.includes(':') && !l.includes('reference(s)'))

  // Group by file
  const byFile = new Map<string, string[]>()
  for (const loc of locations) {
    const fileMatch = loc.trim().match(/^(.+?):(\d+.*)$/)
    if (fileMatch) {
      const file = fileMatch[1]
      const rest = fileMatch[2]
      if (!byFile.has(file)) byFile.set(file, [])
      byFile.get(file)!.push(rest)
    }
  }

  return (
    <CardShell icon="🔗" title="References" subtitle={`${shortPath}:${line}:${char}`}
      badge={count > 0 ? <span className="text-[11px] text-accent font-mono">{count} refs</span> : undefined}
      isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && count === 0 && <p className="text-muted text-[13px] italic">{toolResult}</p>}
      {!isError && byFile.size > 0 && (
        <div className="space-y-1.5">
          <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer">
            {expanded ? '▼' : '▶'} {byFile.size} file{byFile.size !== 1 ? 's' : ''}
          </button>
          {expanded && Array.from(byFile.entries()).map(([file, locs]) => (
            <div key={file} className="rounded bg-bg-hover/50 px-2 py-1.5">
              <div className="text-[12px] font-mono text-accent font-medium">{file}</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {locs.map((loc, i) => (
                  <span key={i} className="text-[11px] font-mono text-muted bg-bg-hover rounded px-1.5 py-0.5">:{loc}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

// ── lsp_symbols ──────────────────────────────────────────────────────────────

interface SymbolEntry {
  kind: string
  name: string
  line?: string
  children?: SymbolEntry[]
  indent: number
}

function parseSymbols(text: string): SymbolEntry[] {
  if (!text) return []
  const lines = text.split('\n').filter(l => l.trim() && !l.match(/^\d+\s+symbol/))
  return lines.map(line => {
    const indent = line.search(/\S/)
    const match = line.trim().match(/^(\w+)\s+(.+?)(?:\s+\(line\s+(\d+)\))?$/)
    if (!match) return { kind: '', name: line.trim(), indent }
    return { kind: match[1], name: match[2], line: match[3], indent }
  }).filter(s => s.name)
}

const symbolIcons: Record<string, string> = {
  class: '🔷', interface: '🔶', function: 'ƒ', method: '🔹',
  property: '◆', variable: '𝑥', constant: '🔒', enum: '📋',
  type: '🏷️', module: '📦', namespace: '📁', constructor: '🔨',
}

export function SymbolsRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const path = toolInput.path as string
  const query = toolInput.query as string
  const symbols = parseSymbols(toolResult || '')
  const shortPath = path?.split('/').pop()

  return (
    <CardShell icon="🏗️" title={query ? `Symbols: "${query}"` : 'Symbols'} subtitle={shortPath}
      badge={symbols.length > 0 ? <span className="text-[11px] text-muted">{symbols.length}</span> : undefined}
      isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && symbols.length === 0 && <p className="text-muted text-[13px] italic">{toolResult}</p>}
      {!isError && symbols.length > 0 && (
        <div className="space-y-0.5">
          <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer">
            {expanded ? '▼' : '▶'} {symbols.length} symbols
          </button>
          {expanded && symbols.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[12px] font-mono" style={{ paddingLeft: `${s.indent * 8 + 8}px` }}>
              <span className="text-[11px] w-4 text-center shrink-0">{symbolIcons[s.kind.toLowerCase()] || '•'}</span>
              <span className="text-muted/60 text-[10px] w-16 shrink-0">{s.kind}</span>
              <span className="text-text font-medium">{s.name}</span>
              {s.line && <span className="text-muted/50 ml-auto">:{s.line}</span>}
            </div>
          ))}
        </div>
      )}
    </CardShell>
  )
}

// ── lsp_completions ──────────────────────────────────────────────────────────

export function CompletionsRenderer({ toolInput, toolResult, isError }: ToolProps) {
  const [expanded, setExpanded] = useState(true)
  const path = toolInput.path as string || ''
  const line = toolInput.line as number
  const char = toolInput.character as number
  const shortPath = path.split('/').pop() || path

  const lines = (toolResult || '').split('\n').filter(l => l.trim())
  const header = lines[0] || ''
  const completions = lines.slice(1)

  return (
    <CardShell icon="💡" title="Completions" subtitle={`${shortPath}:${line}:${char}`}
      badge={completions.length > 0 ? <span className="text-[11px] text-muted">{completions.length}</span> : undefined}
      isError={isError}>
      {isError && <pre className="text-danger text-[12px] font-mono whitespace-pre-wrap">{toolResult}</pre>}
      {!isError && completions.length === 0 && <p className="text-muted text-[13px] italic">{toolResult}</p>}
      {!isError && completions.length > 0 && (
        <div className="space-y-0.5">
          <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer">
            {expanded ? '▼' : '▶'} {header}
          </button>
          {expanded && (
            <pre className="bg-bg-hover rounded-md px-3 py-2 text-[12px] font-mono overflow-x-auto whitespace-pre max-h-[300px] overflow-y-auto text-text/80">
              {completions.join('\n')}
            </pre>
          )}
        </div>
      )}
    </CardShell>
  )
}
