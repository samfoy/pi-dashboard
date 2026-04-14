import { useState, useMemo, memo } from 'react'
import MarkdownRenderer from '../../components/MarkdownRenderer'

const OPTIONS_RE = /\[OPTIONS:\s*(.+?)\]\s*$/s

function parseOptions(content: string): { text: string; options: string[] } {
  const m = content.match(OPTIONS_RE)
  if (!m) return { text: content, options: [] }
  const sep = m[1].includes('|') ? '|' : ','
  return { text: content.slice(0, m.index).trimEnd(), options: m[1].split(sep).map(o => o.trim()).filter(Boolean) }
}

const AssistantMessage = memo(function AssistantMessage({ content, isStreaming, onOption, onFileOpen, planTaskId, onApplyPlan }: { content: string; isStreaming: boolean; slotRunning: boolean; onOption: (text: string) => void; onFileOpen?: (path: string) => void; planTaskId?: string; onApplyPlan?: (steps: any[]) => void }) {
  const { text, options } = parseOptions(content)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [applied, setApplied] = useState(false)

  const planSteps = useMemo(() => {
    if (isStreaming || !planTaskId || !content) return null
    const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/)
    if (!jsonMatch) return null
    try {
      const parsed = JSON.parse(jsonMatch[1])
      if (!Array.isArray(parsed) || !parsed.length) return null
      const valid = parsed.every((s: any) =>
        typeof s?.title === 'string' && s.title.trim() &&
        (!s.depends_on || (Array.isArray(s.depends_on) && s.depends_on.every((d: any) => typeof d === 'number')))
      )
      return valid ? parsed : null
    } catch { /* ignore parse errors */ }
    return null
  }, [content, isStreaming, planTaskId])

  return <>
    <div className={`msg-content px-3.5 py-2.5 text-sm leading-relaxed rounded-lg bg-card border border-border text-text rounded-bl-[4px] shadow-[inset_0_1px_0_var(--card-hl)] select-text ${isStreaming ? 'streaming-cursor' : ''}`}>
      <MarkdownRenderer content={text} streaming={isStreaming} onFileOpen={onFileOpen} />
    </div>
    {planSteps && onApplyPlan && !applied && (
      <button className="mt-1 px-3 py-1.5 rounded-md text-[13px] font-medium border border-accent text-accent bg-transparent cursor-pointer hover:bg-accent hover:text-white transition-all" onClick={() => { setApplied(true); onApplyPlan(planSteps) }}>
        📋 Use as Plan ({planSteps.length} steps)
      </button>
    )}
    {applied && <div className="mt-1 text-[13px] text-ok">✅ Applied to Tasks</div>}
    {options.length > 0 && !isStreaming && <div className="flex gap-1.5 flex-wrap mt-1 items-center">
      {options.map(o => <button key={o} disabled={submitted} onClick={() => { if (submitted) return; setPicked(prev => { const next = new Set(prev); if (next.has(o)) next.delete(o); else next.add(o); return next }) }} className={`px-3 py-1.5 rounded-md text-[13px] font-medium border cursor-pointer transition-all ${picked.has(o) ? 'bg-accent text-white border-accent' : submitted ? 'opacity-30 border-border text-muted cursor-default' : 'border-accent text-accent bg-transparent hover:bg-accent hover:text-white'}`}>{o}</button>)}
      {picked.size > 0 && !submitted && <button onClick={() => { setSubmitted(true); onOption(Array.from(picked).join(', ')) }} className="px-3 py-1.5 rounded-md text-[13px] font-medium bg-accent text-white border border-accent cursor-pointer hover:brightness-110 transition-all">Send{picked.size > 1 ? ` (${picked.size})` : ''} →</button>}
    </div>}
  </>
})

export default AssistantMessage
