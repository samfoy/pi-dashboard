import { useState, memo } from 'react'

const LS_KEY = 'mc-pinned-dirs'

export function loadPinnedDirs(): string[] {
  try {
    const saved = localStorage.getItem(LS_KEY)
    return saved ? JSON.parse(saved) : []
  } catch { return [] }
}

export function savePinnedDirs(dirs: string[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(dirs))
}

function dirName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path
}

interface PinnedDirsProps {
  onNewSession: (cwd: string) => void
}

const PinnedDirs = memo(function PinnedDirs({ onNewSession }: PinnedDirsProps) {
  const [dirs, setDirs] = useState(loadPinnedDirs)
  const [adding, setAdding] = useState(false)
  const [newDir, setNewDir] = useState('')

  const addDir = () => {
    const trimmed = newDir.trim()
    if (!trimmed || dirs.includes(trimmed)) { setAdding(false); setNewDir(''); return }
    const updated = [...dirs, trimmed]
    setDirs(updated)
    savePinnedDirs(updated)
    setAdding(false)
    setNewDir('')
  }

  const removeDir = (dir: string) => {
    const updated = dirs.filter(d => d !== dir)
    setDirs(updated)
    savePinnedDirs(updated)
  }

  return (
    <div>
      <div className="flex justify-between items-center px-3 pt-2.5 pb-1.5 border-t border-border bg-bg-accent">
        <span className="text-[13px] font-semibold text-text-strong flex items-center gap-1.5 select-none">
          📌 Pinned
        </span>
        <button
          className="w-[22px] h-[22px] rounded-sm border border-border bg-transparent text-muted text-[14px] cursor-pointer flex items-center justify-center hover:text-accent hover:border-accent transition-all shrink-0"
          onClick={() => setAdding(true)}
          title="Pin a directory"
        >+</button>
      </div>
      {adding && (
        <div className="px-2 pb-1.5 flex gap-1">
          <input
            className="flex-1 bg-bg-elevated border border-border rounded-md px-2 py-1 text-[12px] text-text font-mono outline-none focus-ring min-w-0 placeholder:text-muted"
            placeholder="~/Projects/my-app"
            value={newDir}
            onChange={e => setNewDir(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addDir(); if (e.key === 'Escape') { setAdding(false); setNewDir('') } }}
            autoFocus
          />
          <button className="px-2 py-1 rounded-md border border-accent bg-accent text-white text-[11px] font-medium cursor-pointer hover:bg-accent-hover transition-all shrink-0" onClick={addDir}>Pin</button>
        </div>
      )}
      <div className="px-2 pb-1">
        {dirs.length === 0 && !adding && (
          <div className="text-[12px] text-muted px-2 py-1.5 italic">No pinned directories</div>
        )}
        {dirs.map(dir => (
          <div
            key={dir}
            className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer text-[13px] text-muted hover:text-text hover:bg-bg-hover transition-all mb-0.5"
            role="button"
            tabIndex={0}
            onClick={() => onNewSession(dir)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNewSession(dir) } }}
            title={`New session in ${dir}`}
          >
            <span className="text-[12px]">📂</span>
            <span className="font-mono truncate flex-1">{dirName(dir)}</span>
            <span className="text-accent text-[11px] opacity-0 group-hover:opacity-60 hover:!opacity-100 shrink-0 transition-opacity">▶ new</span>
            <span
              className="text-[11px] text-muted opacity-0 group-hover:opacity-40 hover:!opacity-100 hover:text-danger shrink-0 cursor-pointer transition-opacity px-0.5"
              onClick={e => { e.stopPropagation(); removeDir(dir) }}
              title="Unpin"
            >✕</span>
          </div>
        ))}
      </div>
    </div>
  )
})

export default PinnedDirs
