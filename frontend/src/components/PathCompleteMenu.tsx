import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'

interface Entry { name: string; path: string; isDir: boolean }

interface Props {
  input: string
  cursorPos: number
  anchorRef: React.RefObject<HTMLElement | null>
  onComplete: (before: string, completed: string, after: string) => void
  onClose: () => void
}

/** Extract the path token around the cursor position. */
function getPathToken(input: string, cursor: number): { token: string; start: number; end: number } | null {
  // Walk left from cursor to find token start (stop at whitespace or start)
  let start = cursor
  while (start > 0 && !/\s/.test(input[start - 1])) start--
  // Walk right from cursor to find token end
  let end = cursor
  while (end < input.length && !/\s/.test(input[end])) end++
  const token = input.slice(start, end)
  // Must look like a path: starts with / or ~ or ./ or ../
  if (/^[~./]/.test(token) && token.length >= 2) return { token, start, end }
  return null
}

export default function PathCompleteMenu({ input, cursorPos, anchorRef, onComplete, onClose }: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [selected, setSelected] = useState(0)
  const [visible, setVisible] = useState(false)
  const [tokenInfo, setTokenInfo] = useState<{ token: string; start: number; end: number } | null>(null)
  const fetchRef = useRef(0)

  // Fetch completions when token changes
  useEffect(() => {
    const info = getPathToken(input, cursorPos)
    setTokenInfo(info)
    if (!info) { setVisible(false); setEntries([]); return }

    const id = ++fetchRef.current
    api.pathComplete(info.token).then(data => {
      if (id !== fetchRef.current) return
      if (data.entries.length > 0) {
        setEntries(data.entries)
        setSelected(0)
        setVisible(true)
      } else {
        setVisible(false)
        setEntries([])
      }
    }).catch(() => { setVisible(false) })
  }, [input, cursorPos])

  const applyCompletion = useCallback((entry: Entry) => {
    if (!tokenInfo) return
    const completed = entry.path + (entry.isDir ? '/' : ' ')
    onComplete(
      input.slice(0, tokenInfo.start),
      completed,
      input.slice(tokenInfo.end),
    )
    if (entry.isDir) {
      // Keep menu open for further drilling
    } else {
      setVisible(false)
    }
  }, [tokenInfo, input, onComplete])

  const onKey = useCallback((e: KeyboardEvent) => {
    if (!visible || entries.length === 0) return
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      applyCompletion(entries[selected])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setSelected(i => (i + 1) % entries.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setSelected(i => (i - 1 + entries.length) % entries.length)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setVisible(false)
      onClose()
    }
  }, [visible, entries, selected, applyCompletion, onClose])

  useEffect(() => {
    if (!visible) return
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [visible, onKey])

  if (!visible || entries.length === 0 || !anchorRef.current) return null

  const rect = anchorRef.current.getBoundingClientRect()
  const menuH = Math.min(entries.length * 32 + 8, 320)
  const above = rect.top - menuH - 4
  const top = above > 0 ? above : rect.bottom + 4

  return createPortal(
    <div
      className="fixed z-[9999] bg-card border border-border rounded-lg shadow-lg overflow-y-auto py-1 animate-slide-up"
      style={{ top, left: rect.left, width: Math.min(rect.width, 480), maxHeight: 320 }}
    >
      {entries.map((entry, i) => (
        <button
          key={entry.path}
          className={`w-full text-left px-3 py-1.5 flex items-center gap-2 cursor-pointer transition-colors text-[13px] font-mono ${i === selected ? 'bg-accent-subtle text-text' : 'text-muted hover:bg-bg-hover hover:text-text'}`}
          onMouseEnter={() => setSelected(i)}
          onMouseDown={e => { e.preventDefault(); applyCompletion(entry) }}
        >
          <span className="shrink-0 w-4 text-center">{entry.isDir ? '📁' : '📄'}</span>
          <span className="truncate flex-1">{entry.name}{entry.isDir ? '/' : ''}</span>
          <span className="text-[11px] text-muted/50 shrink-0 ml-auto">{entry.isDir ? 'dir' : 'file'}</span>
        </button>
      ))}
      <div className="px-3 py-1 border-t border-border text-[11px] text-muted/40 flex gap-3">
        <span>⇥ Tab complete</span>
        <span>↑↓ navigate</span>
        <span>Esc dismiss</span>
      </div>
    </div>,
    document.body,
  )
}
