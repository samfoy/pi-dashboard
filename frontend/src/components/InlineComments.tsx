import { memo, useState, useCallback, useRef } from 'react'
import type { Comment } from '../hooks/usePanelState'

interface Props {
  comments: Comment[]
  onAdd: (startLine: number, endLine: number, content: string) => void
  onEdit: (id: string, content: string) => void
  onDelete: (id: string) => void
  currentVersion: number
  activeInputRange: { start: number; end: number } | null
  onCancelInput: () => void
  onReviewComments?: () => void
}

export default memo(function InlineComments({ comments, onAdd, onEdit, onDelete, currentVersion, activeInputRange, onCancelInput, onReviewComments }: Props) {
  const [inputValue, setInputValue] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [navIndex, setNavIndex] = useState(0)
  const commentRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const filtered = comments.filter(c => c.version === currentVersion)

  const handleSaveNew = useCallback(() => {
    if (!inputValue.trim() || activeInputRange == null) return
    onAdd(activeInputRange.start, activeInputRange.end, inputValue.trim())
    setInputValue('')
    onCancelInput()
  }, [inputValue, activeInputRange, onAdd, onCancelInput])

  const handleStartEdit = useCallback((c: Comment) => {
    setEditingId(c.id)
    setEditValue(c.content)
  }, [])

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !editValue.trim()) return
    onEdit(editingId, editValue.trim())
    setEditingId(null)
    setEditValue('')
  }, [editingId, editValue, onEdit])

  const scrollTo = useCallback((idx: number) => {
    const c = filtered[idx]
    if (!c) return
    const el = commentRefs.current.get(c.id)
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }, [filtered])

  const navPrev = useCallback(() => {
    const next = Math.max(0, navIndex - 1)
    setNavIndex(next)
    scrollTo(next)
  }, [navIndex, scrollTo])

  const navNext = useCallback(() => {
    const next = Math.min(filtered.length - 1, navIndex + 1)
    setNavIndex(next)
    scrollTo(next)
  }, [navIndex, filtered.length, scrollTo])

  if (filtered.length === 0 && activeInputRange == null) return null

  return (
    <div className="flex flex-col gap-1">
      {/* Navigation bar */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 px-2 py-1 bg-chrome border-b border-border text-[11px] text-muted">
          <span>{filtered.length} comment{filtered.length !== 1 ? 's' : ''}</span>
          <div className="flex gap-1 ml-auto">
            <button aria-label="previous comment" className="px-1 rounded hover:bg-bg-elevated cursor-pointer" onClick={navPrev}>↑</button>
            <button aria-label="next comment" className="px-1 rounded hover:bg-bg-elevated cursor-pointer" onClick={navNext}>↓</button>
            {onReviewComments && <button aria-label="Review Comments" className="px-2 py-0.5 rounded border border-accent text-accent text-[11px] cursor-pointer hover:bg-accent-subtle ml-1" onClick={onReviewComments}>Review Comments</button>}
          </div>
        </div>
      )}

      {/* Comment list */}
      {filtered.map(c => (
        <div
          key={c.id}
          data-comment-id={c.id}
          ref={el => { if (el) commentRefs.current.set(c.id, el); else commentRefs.current.delete(c.id) }}
          className="ml-4 pl-2 py-1 border-l-2 border-cyan-500 text-[12px] text-text bg-cyan-500/5"
        >
          {editingId === c.id ? (
            <div className="flex flex-col gap-1">
              <input
                className="bg-bg border border-border rounded px-2 py-1 text-[12px] text-text outline-none"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                autoFocus
              />
              <div className="flex gap-1">
                <button className="px-2 py-0.5 rounded border border-accent text-accent text-[11px] cursor-pointer" onClick={handleSaveEdit}>Save</button>
                <button className="px-2 py-0.5 rounded border border-border text-muted text-[11px] cursor-pointer" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div>
                <span>{c.content}</span>
                <span className="ml-2 text-[10px] text-muted">v{c.version}</span>
              </div>
              <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 hover:opacity-100" style={{ opacity: 1 }}>
                <button data-action={`edit-${c.id}`} className="text-[10px] text-muted hover:text-accent cursor-pointer" onClick={() => handleStartEdit(c)}>✎</button>
                <button data-action={`delete-${c.id}`} className="text-[10px] text-muted hover:text-danger cursor-pointer" onClick={() => onDelete(c.id)}>✕</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* New comment input */}
      {activeInputRange != null && (
        <div className="ml-4 pl-2 py-1 border-l-2 border-cyan-400">
          <input
            className="w-full bg-bg border border-border rounded px-2 py-1 text-[12px] text-text outline-none"
            placeholder="Add a comment..."
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            autoFocus
          />
          <div className="flex gap-1 mt-1">
            <button className="px-2 py-0.5 rounded border border-accent text-accent text-[11px] cursor-pointer" onClick={handleSaveNew}>Save</button>
            <button className="px-2 py-0.5 rounded border border-border text-muted text-[11px] cursor-pointer" onClick={onCancelInput}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
})
