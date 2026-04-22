import { useState } from 'react'

/** Expandable thinking block */
export default function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!content || content.trim() === '') {
    return <div className="msg-content bg-card border border-border rounded-md px-3 py-2 text-[13px] text-muted font-mono animate-scale-in italic flex items-center gap-2"><span className="inline-block w-3.5 h-3.5 border-2 border-muted/30 border-t-accent rounded-full animate-spin" />Preheating the oven…</div>
  }
  return (
    <div className="msg-content bg-card border border-border border-l-[3px] border-l-[#a78bfa] rounded-md animate-scale-in">
      <button className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-muted font-mono cursor-pointer bg-transparent border-none text-left hover:text-text transition-colors" onClick={() => setExpanded(!expanded)}>
        <span className={`text-[11px] transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <span>🧁 Chef's notes</span>
        <span className="text-[12px] text-muted/60 ml-auto">{content.length.toLocaleString()} chars</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border">
          <pre className="text-[13px] text-muted leading-relaxed whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto mt-2 font-body">{content}</pre>
        </div>
      )}
    </div>
  )
}
