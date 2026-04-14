import { useState, useEffect, useCallback, useRef } from 'react'

interface Entry { name: string; path: string; isDir: boolean }

interface Props {
  onFileOpen: (path: string) => void
  onClose: () => void
  startPath?: string
}

export default function FileBrowser({ onFileOpen, onClose, startPath }: Props) {
  const [cwd, setCwd] = useState('')
  const [parent, setParent] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [subEntries, setSubEntries] = useState<Map<string, Entry[]>>(new Map())
  const filterRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (path?: string, hidden?: boolean) => {
    setLoading(true)
    setFilter('')
    try {
      const h = hidden ?? showHidden
      const url = '/api/browse?files=true&hidden=' + h + (path ? '&path=' + encodeURIComponent(path) : '')
      const d = await fetch(url).then(r => r.json())
      setCwd(d.path)
      setParent(d.parent)
      setEntries(d.entries || [])
      setExpanded(new Set())
      setSubEntries(new Map())
    } catch {}
    setLoading(false)
  }, [showHidden])

  useEffect(() => { load(startPath) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { filterRef.current?.focus() }, [])

  const toggleDir = useCallback(async (dirPath: string) => {
    if (expanded.has(dirPath)) {
      setExpanded(prev => { const n = new Set(prev); n.delete(dirPath); return n })
      return
    }
    try {
      const url = '/api/browse?files=true&hidden=' + showHidden + '&path=' + encodeURIComponent(dirPath)
      const d = await fetch(url).then(r => r.json())
      setSubEntries(prev => new Map(prev).set(dirPath, d.entries || []))
      setExpanded(prev => new Set(prev).add(dirPath))
    } catch {}
  }, [expanded, showHidden])

  const toggleHidden = useCallback(() => {
    const next = !showHidden
    setShowHidden(next)
    load(cwd, next)
  }, [showHidden, cwd, load])

  const filtered = filter
    ? entries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase()))
    : entries

  const shortCwd = cwd.replace(/^\/local\/home\/[^/]+/, '~')

  const renderEntry = (e: Entry, depth: number) => {
    const indent = depth * 16
    const isExpanded = expanded.has(e.path)
    const children = subEntries.get(e.path) || []
    return (
      <div key={e.path}>
        <div
          className="flex items-center gap-1.5 py-[3px] pr-2 text-[13px] font-mono cursor-pointer hover:bg-bg-hover transition-colors group"
          style={{ paddingLeft: 8 + indent }}
          onClick={() => e.isDir ? toggleDir(e.path) : (onFileOpen(e.path))}
        >
          {e.isDir ? (
            <span className="text-[10px] text-muted w-3 text-center shrink-0">{isExpanded ? '▼' : '▶'}</span>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className={`truncate ${e.isDir ? 'text-accent' : 'text-text'} ${e.name.startsWith('.') ? 'opacity-60' : ''}`}>{e.name}</span>
        </div>
        {e.isDir && isExpanded && children.map(c => renderEntry(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border text-[12px] font-mono text-muted shrink-0">
        <button type="button" className="hover:text-accent transition-colors shrink-0 bg-transparent border-none cursor-pointer text-muted p-0 text-[14px]" onClick={() => load(parent)} disabled={cwd === parent} title="Go up">⬆</button>
        <span className="truncate flex-1" title={cwd}>{shortCwd}</span>
        <button type="button" className={`text-[11px] px-1 rounded transition-colors bg-transparent border-none cursor-pointer ${showHidden ? 'text-accent' : 'text-muted hover:text-text'}`} onClick={toggleHidden} title="Toggle hidden files">.*</button>
        <button type="button" className="text-muted hover:text-text shrink-0 bg-transparent border-none cursor-pointer p-0" onClick={onClose}>✕</button>
      </div>

      {/* Filter */}
      <div className="px-2 py-1 border-b border-border shrink-0">
        <input
          ref={filterRef}
          type="text"
          className="w-full bg-bg border border-border rounded px-2 py-1 text-[12px] font-mono text-text outline-none focus:border-accent"
          placeholder="Filter..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {loading ? (
          <div className="px-3 py-2 text-[12px] text-muted">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-muted italic">No files</div>
        ) : filtered.map(e => renderEntry(e, 0))}
      </div>
    </div>
  )
}
