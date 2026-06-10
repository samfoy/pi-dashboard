import { useEffect, useMemo, useState } from 'react'

interface SystemPromptPreview {
  memory?: string
  memoryStats?: { semantic: number; lessons: number }
}

interface MemoryFlashProps {
  slotKey: string | null
}

function extractMemoryItems(memory: string): string[] {
  return memory
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('<') && !line.startsWith('</'))
    .filter(line => !/^#+\s/.test(line))
    .slice(0, 8)
}

export default function MemoryFlash({ slotKey }: MemoryFlashProps) {
  const [preview, setPreview] = useState<SystemPromptPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!slotKey || dismissed.has(slotKey)) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/chat/slots/${encodeURIComponent(slotKey)}/system-prompt`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled) setPreview(data) })
      .catch(() => { if (!cancelled) setPreview(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [slotKey, dismissed])

  const items = useMemo(() => extractMemoryItems(preview?.memory || ''), [preview?.memory])
  if (!slotKey || dismissed.has(slotKey)) return null
  if (loading && !preview) return null
  if (!preview?.memory || items.length === 0) return null

  const stats = preview.memoryStats
  const visibleItems = expanded ? items : items.slice(0, 3)

  return (
    <div className="mx-3 md:mx-6 mb-3 rounded-xl border border-accent/25 bg-accent-subtle/35 shadow-[0_8px_32px_rgba(0,0,0,.12)] animate-scale-in overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-accent/15">
        <span className="text-[15px]">🧠</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-text-strong">Memory Flash</div>
          <div className="text-[11px] text-muted">
            Relevant context loaded for this session{stats ? ` · ${stats.semantic} facts · ${stats.lessons} lessons` : ''}
          </div>
        </div>
        <button
          className="text-[12px] text-muted hover:text-text bg-transparent border-none cursor-pointer px-2 py-1"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? 'Less' : `Show ${items.length}`}
        </button>
        <button
          className="text-[13px] text-muted hover:text-danger bg-transparent border-none cursor-pointer px-1"
          title="Dismiss for this session"
          onClick={() => setDismissed(prev => new Set(prev).add(slotKey))}
        >
          ✕
        </button>
      </div>
      <div className="p-2.5 space-y-1.5">
        {visibleItems.map((item, idx) => (
          <div key={idx} className="rounded-lg bg-bg/60 border border-border/70 px-2.5 py-1.5 text-[12px] text-text leading-relaxed whitespace-pre-wrap">
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}
