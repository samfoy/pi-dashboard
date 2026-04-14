import { memo, useMemo, useRef, useState, useCallback } from 'react'
import { diffLines, diffWords } from 'diff'

interface DiffViewProps {
  oldContent: string
  newContent: string
  oldLabel: string
  newLabel: string
  onClose: () => void
}

interface DiffLineData {
  type: 'add' | 'del' | 'context'
  content: string
  oldContent?: string // for word-level diff: the paired removed line
  newContent?: string // for word-level diff: the paired added line
}

function computeLines(oldContent: string, newContent: string): DiffLineData[] {
  const changes = diffLines(oldContent, newContent)
  const result: DiffLineData[] = []

  // Collect raw lines with types
  const raw: { type: 'add' | 'del' | 'context'; text: string }[] = []
  for (const change of changes) {
    const lines = change.value.replace(/\n$/, '').split('\n')
    const type = change.added ? 'add' : change.removed ? 'del' : 'context'
    for (const line of lines) {
      raw.push({ type, text: line })
    }
  }

  // Pair consecutive del/add runs for word-level diff
  let i = 0
  while (i < raw.length) {
    if (raw[i].type === 'del') {
      const dels: string[] = []
      while (i < raw.length && raw[i].type === 'del') { dels.push(raw[i].text); i++ }
      const adds: string[] = []
      while (i < raw.length && raw[i].type === 'add') { adds.push(raw[i].text); i++ }
      const max = Math.max(dels.length, adds.length)
      for (let j = 0; j < max; j++) {
        if (j < dels.length && j < adds.length) {
          // Paired — enable word-level diff
          result.push({ type: 'del', content: dels[j], oldContent: dels[j], newContent: adds[j] })
          result.push({ type: 'add', content: adds[j], oldContent: dels[j], newContent: adds[j] })
        } else if (j < dels.length) {
          result.push({ type: 'del', content: dels[j] })
        } else {
          result.push({ type: 'add', content: adds[j] })
        }
      }
    } else if (raw[i].type === 'add') {
      result.push({ type: 'add', content: raw[i].text })
      i++
    } else {
      result.push({ type: 'context', content: raw[i].text })
      i++
    }
  }

  return result
}

function WordDiffSpans({ oldText, newText, type }: { oldText: string; newText: string; type: 'add' | 'del' }) {
  const parts = useMemo(() => diffWords(oldText, newText), [oldText, newText])
  return (
    <>
      {parts.map((part, i) => {
        const isRelevant = type === 'add' ? part.added : part.removed
        const isOther = type === 'add' ? part.removed : part.added
        if (isOther) return null
        return (
          <span
            key={i}
            data-diff-word={isRelevant ? 'true' : undefined}
            className={isRelevant ? (type === 'add' ? 'bg-green-500/30 rounded-sm' : 'bg-red-500/30 rounded-sm') : ''}
          >
            {part.value}
          </span>
        )
      })}
    </>
  )
}

const BG = { add: 'bg-diff-add', del: 'bg-diff-del', context: '' }
const FG = { add: 'text-diff-add-text', del: 'text-diff-del-text', context: 'text-text' }

export default memo(function DiffView({ oldContent, newContent, oldLabel, newLabel, onClose }: DiffViewProps) {
  const lines = useMemo(() => computeLines(oldContent, newContent), [oldContent, newContent])
  const addCount = useMemo(() => lines.filter(l => l.type === 'add').length, [lines])
  const delCount = useMemo(() => lines.filter(l => l.type === 'del').length, [lines])
  const isIdentical = addCount === 0 && delCount === 0

  // Hunk tracking: a hunk starts at a non-context line after context (or at start)
  const hunkIndices = useMemo(() => {
    const indices: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].type !== 'context') {
        if (i === 0 || lines[i - 1].type === 'context') indices.push(i)
      }
    }
    return indices
  }, [lines])

  const hunkRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const [currentHunk, setCurrentHunk] = useState(0)

  const scrollToHunk = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, hunkIndices.length - 1))
    setCurrentHunk(clamped)
    const el = hunkRefs.current.get(hunkIndices[clamped])
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [hunkIndices])

  const navNext = useCallback(() => scrollToHunk(currentHunk + 1), [currentHunk, scrollToHunk])
  const navPrev = useCallback(() => scrollToHunk(currentHunk - 1), [currentHunk, scrollToHunk])

  if (isIdentical) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-chrome">
          <div className="flex items-center gap-3 text-[12px] text-muted">
            <span>{oldLabel}</span>
            <span>→</span>
            <span>{newLabel}</span>
          </div>
          <button className="px-2 py-1 rounded-md text-[12px] text-muted border border-border hover:text-danger hover:border-danger transition-all cursor-pointer" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div data-diff-empty className="flex-1 flex items-center justify-center text-muted text-sm">No changes</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-chrome">
        <div className="flex items-center gap-3 text-[12px]">
          <span className="text-muted">{oldLabel}</span>
          <span className="text-muted">→</span>
          <span className="text-muted">{newLabel}</span>
          <span data-diff-stats className="font-mono">
            <span className="text-diff-add-text">+{addCount}</span>
            {' '}
            <span className="text-diff-del-text">-{delCount}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {hunkIndices.length > 0 && (
            <>
              <span className="text-[11px] text-muted">{currentHunk + 1}/{hunkIndices.length}</span>
              <button data-diff-nav-prev className="px-1.5 py-0.5 rounded text-[12px] text-muted border border-border hover:text-text cursor-pointer" onClick={navPrev} aria-label="Previous hunk">↑</button>
              <button data-diff-nav-next className="px-1.5 py-0.5 rounded text-[12px] text-muted border border-border hover:text-text cursor-pointer" onClick={navNext} aria-label="Next hunk">↓</button>
            </>
          )}
          <button className="px-2 py-1 rounded-md text-[12px] text-muted border border-border hover:text-danger hover:border-danger transition-all cursor-pointer" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>
      {/* Diff lines */}
      <div className="flex-1 overflow-auto font-mono text-[13px] leading-relaxed">
        {lines.map((line, i) => {
          const isHunkStart = hunkIndices.includes(i)
          return (
            <div
              key={i}
              data-diff-line
              data-diff-hunk={isHunkStart ? 'true' : undefined}
              ref={isHunkStart ? (el: HTMLDivElement | null) => { if (el) hunkRefs.current.set(i, el); else hunkRefs.current.delete(i) } : undefined}
              className={`flex min-w-fit ${BG[line.type]}`}
            >
              <span className={`select-none w-[2ch] text-center shrink-0 ${FG[line.type]}`}>
                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
              </span>
              <span className={`px-2 flex-1 whitespace-pre-wrap ${FG[line.type]}`}>
                {(line.type === 'add' || line.type === 'del') && line.oldContent != null && line.newContent != null ? (
                  <WordDiffSpans oldText={line.oldContent} newText={line.newContent} type={line.type} />
                ) : (
                  line.content || ' '
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
})
