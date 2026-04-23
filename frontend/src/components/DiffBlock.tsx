import { memo, useState, useMemo } from 'react'
import { diffWords } from 'diff'

interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'meta'
  content: string
  oldNum?: number
  newNum?: number
  oldContent?: string
  newContent?: string
}

function parseDiffLines(code: string): DiffLine[] {
  const raw = code.split('\n')
  const result: DiffLine[] = []
  let oldN = 0, newN = 0
  let seenHunk = false

  for (const line of raw) {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line)
      if (m) { oldN = parseInt(m[1]); newN = parseInt(m[2]) }
      seenHunk = true
      result.push({ type: 'hunk', content: line })
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      result.push({ type: 'meta', content: line })
    } else if (!seenHunk && (line.startsWith('diff ') || line.startsWith('index '))) {
      // File header lines before first hunk — treat as meta
      result.push({ type: 'meta', content: line })
    } else if (line.startsWith('+')) {
      const kiroAdd = /^\+(\d+):(.*)/.exec(line)
      if (kiroAdd) {
        result.push({ type: 'add', content: kiroAdd[2], newNum: parseInt(kiroAdd[1]) })
      } else {
        result.push({ type: 'add', content: line.slice(1), newNum: newN })
        newN++
      }
    } else if (line.startsWith('-')) {
      const kiroDel = /^-(\d+):(.*)/.exec(line)
      if (kiroDel) {
        result.push({ type: 'del', content: kiroDel[2], oldNum: parseInt(kiroDel[1]) })
      } else {
        result.push({ type: 'del', content: line.slice(1), oldNum: oldN })
        oldN++
      }
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line
      result.push({ type: 'context', content: text, oldNum: oldN, newNum: newN })
      oldN++; newN++
    }
  }
  return result
}

const BG: Record<DiffLine['type'], string> = { add: 'bg-diff-add', del: 'bg-diff-del', hunk: 'bg-diff-hunk', meta: '', context: '' }
const FG: Record<DiffLine['type'], string> = { add: 'text-diff-add-text', del: 'text-diff-del-text', hunk: 'text-diff-hunk-text', meta: 'text-diff-meta-text font-semibold', context: 'text-muted' }
const SIGN: Record<string, string> = { add: '+', del: '-', hunk: '', meta: '', context: ' ' }

/** Group consecutive context lines for collapsing. Returns segments: either a context group or individual change lines. */
function groupContextRuns(lines: DiffLine[]): { kind: 'context'; lines: DiffLine[] }[] | { kind: 'line'; line: DiffLine }[] {
  const segments: ({ kind: 'context'; lines: DiffLine[] } | { kind: 'line'; line: DiffLine })[] = []
  let ctxBuf: DiffLine[] = []
  const flushCtx = () => {
    if (ctxBuf.length > 0) { segments.push({ kind: 'context', lines: [...ctxBuf] }); ctxBuf = [] }
  }
  for (const l of lines) {
    if (l.type === 'context') { ctxBuf.push(l) }
    else { flushCtx(); segments.push({ kind: 'line', line: l }) }
  }
  flushCtx()
  return segments as any
}

/** Build side-by-side pairs from parsed diff lines. */
function buildSideBySide(lines: DiffLine[]): { left: DiffLine | null; right: DiffLine | null }[] {
  const pairs: { left: DiffLine | null; right: DiffLine | null }[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (l.type === 'meta' || l.type === 'hunk') {
      pairs.push({ left: l, right: l })
      i++
    } else if (l.type === 'context') {
      pairs.push({ left: l, right: l })
      i++
    } else if (l.type === 'del') {
      // Collect consecutive del, then consecutive add, pair them
      const dels: DiffLine[] = []
      while (i < lines.length && lines[i].type === 'del') { dels.push(lines[i]); i++ }
      const adds: DiffLine[] = []
      while (i < lines.length && lines[i].type === 'add') { adds.push(lines[i]); i++ }
      const max = Math.max(dels.length, adds.length)
      for (let j = 0; j < max; j++) {
        const d = dels[j] || null
        const a = adds[j] || null
        if (d && a) {
          d.oldContent = d.content
          d.newContent = a.content
          a.oldContent = d.content
          a.newContent = a.content
        }
        pairs.push({ left: d, right: a })
      }
    } else if (l.type === 'add') {
      pairs.push({ left: null, right: l })
      i++
    } else { i++ }
  }
  return pairs
}

function WordDiffSpans({ oldText, newText, type }: { oldText: string; newText: string; type: 'add' | 'del' }) {
  const parts = useMemo(() => diffWords(oldText, newText), [oldText, newText])
  return (
    <>
      {parts.map((part, i) => {
        if (type === 'add' ? part.removed : part.added) return null
        const highlight = type === 'add' ? part.added : part.removed
        return (
          <span key={i} className={highlight ? (type === 'add' ? 'bg-green-500/30 rounded-sm' : 'bg-red-500/30 rounded-sm') : ''}>
            {part.value}
          </span>
        )
      })}
    </>
  )
}

const CTX_COLLAPSE_THRESHOLD = 20

export default memo(function DiffBlock({ code, complete }: { code: string; complete: boolean }) {
  const [copied, setCopied] = useState(false)
  const [sideBySide, setSideBySide] = useState(false)
  const [expandedCtx, setExpandedCtx] = useState<Set<number>>(new Set())
  const lines = useMemo(() => parseDiffLines(code), [code])
  const hasLineNums = lines.some(l => l.oldNum !== undefined || l.newNum !== undefined)
  const segments = useMemo(() => groupContextRuns(lines), [lines])
  const sbsPairs = useMemo(() => sideBySide ? buildSideBySide(lines) : [], [lines, sideBySide])

  const copy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  const toggleCtx = (idx: number) => setExpandedCtx(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n })

  const renderUnifiedLine = (line: DiffLine, key: number) => (
    <div key={key} className={`flex text-[13px] font-mono leading-relaxed min-w-fit ${BG[line.type]}`}>
      {hasLineNums && <span className="select-none text-muted/50 text-right w-[3.5ch] shrink-0 pr-1 border-r border-border/30">{line.type === 'add' ? '' : (line.oldNum ?? '')}</span>}
      {hasLineNums && <span className="select-none text-muted/50 text-right w-[3.5ch] shrink-0 pr-1 border-r border-border/30">{line.type === 'del' ? '' : (line.newNum ?? '')}</span>}
      <span className={`select-none w-[2ch] text-center shrink-0 ${FG[line.type]}`}>{SIGN[line.type]}</span>
      <span className={`px-2 flex-1 ${FG[line.type]}`}>{line.type === 'hunk' || line.type === 'meta' ? line.content : (line.content || ' ')}</span>
    </div>
  )

  return (
    <div className="relative group my-2">
      <div className="flex items-center justify-between bg-bg-elevated border border-border rounded-t-md px-3 py-1.5">
        <span className="text-muted text-[12px] font-mono uppercase">diff</span>
        <div className="flex items-center gap-2">
          <button className="text-muted text-[12px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-text" onClick={() => setSideBySide(!sideBySide)}>{sideBySide ? 'unified' : 'split'}</button>
          <button className="text-muted text-[12px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-text" onClick={copy}>{copied ? 'Copied!' : 'Copy patch'}</button>
        </div>
      </div>
      <pre className="bg-bg-elevated border border-t-0 border-border rounded-b-md p-0 overflow-x-auto">
        {sideBySide ? (
          /* Side-by-side view */
          sbsPairs.map((pair, i) => {
            const left = pair.left
            const right = pair.right
            const lType = left?.type || 'context'
            const rType = right?.type || 'context'
            // Meta and hunk lines span full width
            if (lType === 'meta' || lType === 'hunk') {
              return (
                <div key={i} className={`text-[13px] font-mono leading-relaxed px-3 ${BG[lType]} ${FG[lType]}`}>{left?.content}</div>
              )
            }
            return (
              <div key={i} className="flex text-[13px] font-mono leading-relaxed">
                <div className={`w-1/2 flex overflow-hidden border-r border-border/30 ${left ? BG[lType] : ''}`}>
                  {hasLineNums && <span className="select-none text-muted/50 text-right w-[3.5ch] shrink-0 pr-1 border-r border-border/30">{left?.oldNum ?? ''}</span>}
                  <span className={`select-none w-[2ch] text-center shrink-0 ${left ? FG[lType] : 'text-muted'}`}>{left ? (SIGN[lType] || ' ') : ' '}</span>
                  <span className={`px-2 flex-1 whitespace-pre ${left ? FG[lType] : 'text-muted'}`}>
                    {left && left.oldContent != null && left.newContent != null
                      ? <WordDiffSpans oldText={left.oldContent} newText={left.newContent} type="del" />
                      : (left?.content || ' ')}
                  </span>
                </div>
                <div className={`w-1/2 flex overflow-hidden ${right ? BG[rType] : ''}`}>
                  {hasLineNums && <span className="select-none text-muted/50 text-right w-[3.5ch] shrink-0 pr-1 border-r border-border/30">{right?.newNum ?? ''}</span>}
                  <span className={`select-none w-[2ch] text-center shrink-0 ${right ? FG[rType] : 'text-muted'}`}>{right ? (SIGN[rType] || ' ') : ' '}</span>
                  <span className={`px-2 flex-1 whitespace-pre ${right ? FG[rType] : 'text-muted'}`}>
                    {right && right.oldContent != null && right.newContent != null
                      ? <WordDiffSpans oldText={right.oldContent} newText={right.newContent} type="add" />
                      : (right?.content || ' ')}
                  </span>
                </div>
              </div>
            )
          })
        ) : (
          /* Unified view with collapsible context */
          segments.map((seg, si) => {
            if (seg.kind === 'line') return renderUnifiedLine(seg.line, si)
            // Context group — collapse if large
            const ctxLines = seg.lines
            if (ctxLines.length <= CTX_COLLAPSE_THRESHOLD) return ctxLines.map((l, li) => renderUnifiedLine(l, si * 10000 + li))
            if (expandedCtx.has(si)) {
              return <div key={si}>
                {ctxLines.map((l, li) => renderUnifiedLine(l, si * 10000 + li))}
                <div className="px-3 py-0.5 text-[12px] text-muted cursor-pointer hover:text-text bg-bg-hover/50" onClick={() => toggleCtx(si)}>▲ collapse {ctxLines.length} context lines</div>
              </div>
            }
            // Show first 2 + last 2, collapse middle
            const hidden = ctxLines.length - 4
            return <div key={si}>
              {ctxLines.slice(0, 2).map((l, li) => renderUnifiedLine(l, si * 10000 + li))}
              <div className="px-3 py-0.5 text-[12px] text-muted cursor-pointer hover:text-text bg-bg-hover/50 select-none" onClick={() => toggleCtx(si)}>▼ {hidden} lines hidden</div>
              {ctxLines.slice(-2).map((l, li) => renderUnifiedLine(l, si * 10000 + 9000 + li))}
            </div>
          })
        )}
        {!complete && <div className="px-3 py-1 text-muted text-[12px] italic animate-pulse">generating diff…</div>}
      </pre>
    </div>
  )
})
