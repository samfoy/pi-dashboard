import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

interface Entry { name: string; path: string; isDir: boolean }

interface DirTreeProps {
  value: string
  onChange: (path: string) => void
  workspaces: { name: string; path: string }[]
}

export default function DirTree({ value, onChange, workspaces }: DirTreeProps) {
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [parent, setParent] = useState('')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const load = useCallback(async (path?: string) => {
    setLoading(true)
    try {
      const d = await api.browse(path)
      setCwd(d.path)
      setParent(d.parent)
      setEntries(d.entries || [])
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { if (open && !cwd) load(value || undefined) }, [open, cwd, value, load])

  const select = (path: string) => {
    onChange(path)
    setOpen(false)
  }

  const displayPath = value || '~ (default)'

  if (!open) {
    return (
      <button
        type="button"
        className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text font-mono cursor-pointer focus-ring text-left truncate hover:border-accent transition-colors flex items-center gap-2"
        onClick={() => setOpen(true)}
      >
        <span className="text-muted">📂</span>
        <span className="truncate">{value ? value.replace(/^\/local\/home\/[^/]+/, '~') : displayPath}</span>
      </button>
    )
  }

  return (
    <div className="bg-bg-elevated border border-accent rounded-lg overflow-hidden shadow-lg">
      {/* Bookmarks row */}
      <div className="flex gap-1 px-2 py-1.5 border-b border-border bg-bg-accent overflow-x-auto">
        {workspaces.map(w => (
          <button key={w.path} type="button"
            className="px-2 py-0.5 rounded text-[11px] font-mono bg-bg-hover border border-border text-muted hover:text-accent hover:border-accent transition-colors whitespace-nowrap shrink-0"
            onClick={() => select(w.path)}
          >{w.name}</button>
        ))}
      </div>

      {/* Current path + nav */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border text-[12px] font-mono text-muted">
        <button type="button" className="hover:text-accent transition-colors shrink-0" onClick={() => load(parent)} disabled={cwd === parent}>⬆</button>
        <span className="truncate flex-1" title={cwd}>{cwd}</span>
        <button type="button" className="text-accent font-semibold hover:underline shrink-0" onClick={() => select(cwd)}>Use this</button>
        <button type="button" className="text-muted hover:text-text shrink-0 ml-1" onClick={() => setOpen(false)}>✕</button>
      </div>

      {/* Directory listing */}
      <div className="max-h-[200px] overflow-y-auto">
        {loading ? (
          <div className="px-3 py-2 text-[12px] text-muted">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-muted italic">Empty directory</div>
        ) : entries.map(e => (
          <div key={e.path}
            className="flex items-center gap-2 px-3 py-1 text-[13px] font-mono cursor-pointer hover:bg-bg-hover transition-colors group"
          >
            <span className="text-[11px]">📁</span>
            <span className="flex-1 truncate text-text" onClick={() => load(e.path)}>{e.name}</span>
            <button type="button"
              className="text-[11px] text-accent opacity-0 group-hover:opacity-100 transition-opacity font-semibold"
              onClick={() => select(e.path)}
            >Use</button>
          </div>
        ))}
      </div>
    </div>
  )
}
