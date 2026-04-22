import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import type { ChatMessage } from '../../types'

interface MessageSearchProps {
  messages: ChatMessage[]
  onJumpToIndex: (index: number) => void
  onClose: () => void
}

/** Search bar for finding messages within a chat session. */
export default function MessageSearch({ messages, onJumpToIndex, onClose }: MessageSearchProps) {
  const [query, setQuery] = useState('')
  const [currentMatch, setCurrentMatch] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const matches = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    const results: number[] = []
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]
      if (m.content?.toLowerCase().includes(q)) {
        results.push(i)
      }
      // Also search tool args and results
      if (m.meta?.args && String(m.meta.args).toLowerCase().includes(q)) {
        if (!results.includes(i)) results.push(i)
      }
      if (m.meta?.result && String(m.meta.result).toLowerCase().includes(q)) {
        if (!results.includes(i)) results.push(i)
      }
    }
    return results
  }, [messages, query])

  useEffect(() => {
    if (matches.length > 0 && currentMatch < matches.length) {
      onJumpToIndex(matches[currentMatch])
    }
  }, [matches, currentMatch, onJumpToIndex])

  const goNext = useCallback(() => {
    if (matches.length === 0) return
    setCurrentMatch(c => (c + 1) % matches.length)
  }, [matches.length])

  const goPrev = useCallback(() => {
    if (matches.length === 0) return
    setCurrentMatch(c => (c - 1 + matches.length) % matches.length)
  }, [matches.length])

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-chrome shrink-0 animate-slide-up">
      <input
        ref={inputRef}
        className="flex-1 bg-bg-elevated border border-border rounded-md px-3 py-1.5 text-sm text-text outline-none focus-ring font-body placeholder:text-muted min-w-0"
        placeholder="Search messages…"
        value={query}
        onChange={e => { setQuery(e.target.value); setCurrentMatch(0) }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) goPrev()
            else goNext()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className="text-[12px] text-muted font-mono shrink-0 min-w-[60px] text-center">
        {query.trim() ? `${matches.length > 0 ? currentMatch + 1 : 0}/${matches.length}` : ''}
      </span>
      <button
        className="w-7 h-7 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer hover:text-text hover:border-border-strong transition-all flex items-center justify-center disabled:opacity-30"
        onClick={goPrev}
        disabled={matches.length === 0}
        aria-label="Previous match"
      >↑</button>
      <button
        className="w-7 h-7 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer hover:text-text hover:border-border-strong transition-all flex items-center justify-center disabled:opacity-30"
        onClick={goNext}
        disabled={matches.length === 0}
        aria-label="Next match"
      >↓</button>
      <button
        className="w-7 h-7 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer hover:text-text hover:border-border-strong transition-all flex items-center justify-center"
        onClick={onClose}
        aria-label="Close search"
      >✕</button>
    </div>
  )
}
