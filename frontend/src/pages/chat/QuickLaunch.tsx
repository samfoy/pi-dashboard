import { useState, useRef, useEffect, memo, useCallback } from 'react'
import { api } from '../../api/client'
import { getFrequentDirs, removeDirFreq } from '../../store/dirFrequency'

interface Entry { name: string; path: string; isDir: boolean }

interface QuickLaunchProps {
  onNewSession: (cwd: string) => void
}

function dirName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path
}


const QuickLaunch = memo(function QuickLaunch({ onNewSession }: QuickLaunchProps) {
  const [adding, setAdding] = useState(false)
  const [input, setInput] = useState('')
  const [completions, setCompletions] = useState<Entry[]>([])
  const [selected, setSelected] = useState(0)
  const [freqDirs, setFreqDirs] = useState(getFrequentDirs)
  const inputRef = useRef<HTMLInputElement>(null)
  const fetchId = useRef(0)

  // Refresh freq dirs when opening
  useEffect(() => {
    if (adding) setFreqDirs(getFrequentDirs())
  }, [adding])

  const fetchCompletions = useCallback(async (val: string) => {
    if (!val || val.length < 2) { setCompletions([]); return }
    const id = ++fetchId.current
    try {
      const data = await api.pathComplete(val)
      if (id !== fetchId.current) return
      const dirs = data.entries.filter((e: Entry) => e.isDir)
      setCompletions(dirs)
      setSelected(0)
    } catch {
      setCompletions([])
    }
  }, [])

  const handleInputChange = (val: string) => {
    setInput(val)
    fetchCompletions(val)
  }

  const selectDir = (path: string) => {
    onNewSession(path)
    setAdding(false)
    setInput('')
    setCompletions([])
    // Freq will be recorded by the session creation flow
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (completions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected(i => (i + 1) % completions.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected(i => (i - 1 + completions.length) % completions.length)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        const entry = completions[selected]
        if (entry) {
          setInput(entry.path + '/')
          fetchCompletions(entry.path + '/')
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (completions[selected]) {
          selectDir(completions[selected].path)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setAdding(false)
        setInput('')
        setCompletions([])
      }
    } else {
      if (e.key === 'Enter' && input.trim()) {
        e.preventDefault()
        selectDir(input.trim())
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setAdding(false)
        setInput('')
      }
    }
  }

  const removeFreq = (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeDirFreq(path)
    setFreqDirs(getFrequentDirs())
  }

  return (
    <div>
      <div className="flex justify-between items-center px-3 pt-2.5 pb-1.5 border-t border-border bg-bg-accent">
        <span className="text-[13px] font-semibold text-text-strong flex items-center gap-1.5 select-none">
          🚀 Quick Launch
        </span>
        <button
          className="w-[22px] h-[22px] rounded-sm border border-border bg-transparent text-muted text-[14px] cursor-pointer flex items-center justify-center hover:text-accent hover:border-accent transition-all shrink-0"
          onClick={() => { setAdding(!adding); setInput(''); setCompletions([]) }}
          title="Open directory"
        >{adding ? '✕' : '+'}</button>
      </div>

      {adding && (
        <div className="px-2 pb-1.5 relative">
          <input
            ref={inputRef}
            className="w-full bg-bg-elevated border border-border rounded-md px-2 py-1.5 text-[12px] text-text font-mono outline-none focus-ring placeholder:text-muted"
            placeholder="~/path/to/project"
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          {completions.length > 0 && (
            <div className="absolute left-2 right-2 bg-card border border-border rounded-md shadow-lg overflow-y-auto max-h-[200px] z-50 mt-0.5">
              {completions.map((entry, i) => (
                <div
                  key={entry.path}
                  className={`flex items-center gap-2 px-2.5 py-1 text-[12px] font-mono cursor-pointer transition-colors ${i === selected ? 'bg-accent-subtle text-text' : 'text-muted hover:bg-bg-hover hover:text-text'}`}
                  onMouseEnter={() => setSelected(i)}
                  onMouseDown={e => { e.preventDefault(); selectDir(entry.path) }}
                >
                  <span className="text-[10px]">📁</span>
                  <span className="truncate flex-1">{entry.name}</span>
                  <span className="text-[10px] text-muted/40 shrink-0">Tab↹</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="px-2 pb-1">
        {freqDirs.length === 0 && !adding && (
          <div className="text-[12px] text-muted px-2 py-1.5 italic">Start sessions to see frequent dirs</div>
        )}
        {freqDirs.slice(0, 8).map(d => (
          <div
            key={d.path}
            className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer text-[13px] text-muted hover:text-text hover:bg-bg-hover transition-all mb-0.5"
            role="button"
            tabIndex={0}
            onClick={() => onNewSession(d.path)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNewSession(d.path) } }}
            title={`New session in ${d.path} (${d.count}×)`}
          >
            <span className="text-[12px]">📂</span>
            <span className="font-mono truncate flex-1">{dirName(d.path)}</span>
            <span className="text-[10px] text-muted/40 font-mono shrink-0 tabular-nums">{d.count}×</span>
            <span className="text-accent text-[11px] opacity-0 group-hover:opacity-60 hover:!opacity-100 shrink-0 transition-opacity">▶</span>
            <span
              className="text-[11px] text-muted opacity-0 group-hover:opacity-40 hover:!opacity-100 hover:text-danger shrink-0 cursor-pointer transition-opacity px-0.5"
              onClick={e => removeFreq(d.path, e)}
              title="Remove"
            >✕</span>
          </div>
        ))}
      </div>
    </div>
  )
})

export default QuickLaunch
