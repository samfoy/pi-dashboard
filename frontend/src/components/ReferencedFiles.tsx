import { memo, useState, useMemo } from 'react'
import type { ReferencedFile } from '../hooks/useReferencedFiles'

const TOOL_ICONS: Record<string, string> = {
  read: '📖',
  edit: '✏️',
  write: '📝',
  lsp_diagnostics: '🔍',
  lsp_hover: '💡',
  lsp_definition: '🎯',
  lsp_references: '🔗',
  lsp_symbols: '📐',
  lsp_rename: '✨',
  lsp_completions: '💬',
  code_search: '🔎',
  code_rewrite: '🔄',
  code_overview: '🗂️',
}

const SOURCE_ICONS: Record<string, string> = {
  tool: '🔧',
  assistant: '🤖',
  user: '👤',
}

function fileName(path: string): string {
  return path.split('/').pop() || path
}

function dirName(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 1) return ''
  parts.pop()
  // Shorten home paths
  const dir = parts.join('/')
  return dir.replace(/^\/local\/home\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')
}

/** Get file extension for grouping. */
function extGroup(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const groups: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
    py: 'Python', rs: 'Rust', java: 'Java', json: 'Config', yaml: 'Config',
    yml: 'Config', toml: 'Config', css: 'Style', scss: 'Style', html: 'Markup',
    xml: 'Markup', md: 'Docs', txt: 'Docs', sh: 'Script', bash: 'Script',
  }
  return groups[ext] || ext.toUpperCase() || 'Other'
}

interface Props {
  files: ReferencedFile[]
  onFileOpen: (path: string) => void
  onClose: () => void
}

function ReferencedFiles({ files, onFileOpen, onClose }: Props) {
  const [filter, setFilter] = useState('')
  const [groupByType, setGroupByType] = useState(false)

  const filtered = useMemo(() => {
    if (!filter) return files
    const q = filter.toLowerCase()
    return files.filter(f => f.path.toLowerCase().includes(q))
  }, [files, filter])

  const grouped = useMemo(() => {
    if (!groupByType) return null
    const groups = new Map<string, ReferencedFile[]>()
    for (const f of filtered) {
      const g = extGroup(f.path)
      const arr = groups.get(g)
      if (arr) arr.push(f)
      else groups.set(g, [f])
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered, groupByType])

  const renderFile = (f: ReferencedFile) => {
    const icon = f.toolName ? (TOOL_ICONS[f.toolName] || '🔧') : SOURCE_ICONS[f.source] || '📄'
    const name = fileName(f.path)
    const dir = dirName(f.path)
    return (
      <div
        key={f.path}
        className="flex items-center gap-1.5 py-[5px] px-2 text-[13px] font-mono cursor-pointer hover:bg-bg-hover rounded-md transition-colors group/file"
        onClick={() => onFileOpen(f.path)}
        title={f.path}
      >
        <span className="text-[12px] shrink-0">{icon}</span>
        <span className="text-text truncate font-medium">{name}</span>
        {dir && <span className="text-muted text-[11px] truncate flex-1 min-w-0">{dir}</span>}
        <span className="opacity-0 group-hover/file:opacity-100 text-muted text-[11px] shrink-0 transition-opacity">Open</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border text-[12px] font-mono text-muted shrink-0">
        <span className="text-[14px]">📎</span>
        <span className="flex-1 font-semibold text-text-strong">Referenced Files</span>
        <span className="text-[11px] text-muted">{files.length}</span>
        <button
          type="button"
          className={`text-[11px] px-1 rounded transition-colors bg-transparent border-none cursor-pointer ${groupByType ? 'text-accent' : 'text-muted hover:text-text'}`}
          onClick={() => setGroupByType(!groupByType)}
          title="Group by type"
        >≡</button>
        <button type="button" className="text-muted hover:text-text shrink-0 bg-transparent border-none cursor-pointer p-0" onClick={onClose}>✕</button>
      </div>

      {/* Filter */}
      {files.length > 5 && (
        <div className="px-2 py-1 border-b border-border shrink-0">
          <input
            type="text"
            className="w-full bg-bg border border-border rounded px-2 py-1 text-[12px] font-mono text-text outline-none focus:border-accent"
            placeholder="Filter files..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-1">
        {files.length === 0 ? (
          <div className="px-3 py-4 text-[12px] text-muted italic text-center">
            No files referenced yet.<br />
            <span className="text-[11px]">Files mentioned in chat or used by tools will appear here.</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-muted italic">No matches</div>
        ) : grouped ? (
          grouped.map(([group, items]) => (
            <div key={group}>
              <div className="text-[11px] text-muted font-semibold uppercase tracking-wider px-2 pt-2 pb-1">{group}</div>
              {items.map(renderFile)}
            </div>
          ))
        ) : (
          filtered.map(renderFile)
        )}
      </div>
    </div>
  )
}

export default memo(ReferencedFiles)
