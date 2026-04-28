import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppSelector } from '../../store'

interface SubagentStatus {
  id: string
  task: string
  startTime: number
  lastToolCall?: string
  turns: number
}

function ElapsedTimer({ startTime }: { startTime: number }) {
  const [s, setS] = useState(Math.floor((Date.now() - startTime) / 1000))
  useEffect(() => {
    const t = setInterval(() => setS(Math.floor((Date.now() - startTime) / 1000)), 1000)
    return () => clearInterval(t)
  }, [startTime])
  return <span>{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`}</span>
}

function AgentLog({ id }: { id: string }) {
  const [log, setLog] = useState('')
  const scrollRef = useRef<HTMLPreElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`/api/subagents/${id}/log`)
        setLog(await r.text())
      } catch {}
    }
    poll()
    const t = setInterval(poll, 1000)
    return () => clearInterval(t)
  }, [id])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [log, autoScroll])

  return (
    <pre
      ref={scrollRef}
      onScroll={e => {
        const el = e.currentTarget
        setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
      }}
      className="flex-1 min-h-0 bg-bg px-3 py-2 text-[12px] font-mono text-text/80 whitespace-pre-wrap break-all overflow-y-auto"
    >
      {log || '(waiting for output…)'}
    </pre>
  )
}

const MIN_W = 320, MIN_H = 200, DEFAULT_W = 480, DEFAULT_H = 400

export default function SubagentDock() {
  const activeSlot = useAppSelector(s => s.chat.activeSlot)
  const [agents, setAgents] = useState<SubagentStatus[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(false)
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H })
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activeSlot) return
    const poll = async () => {
      try {
        const r = await fetch(`/api/subagents/status?slot=${encodeURIComponent(activeSlot)}`)
        const data = await r.json()
        setAgents(data)
        if (data.length > 0 && !selected) setSelected(data[0].id)
      } catch {}
    }
    poll()
    const t = setInterval(poll, 1000)
    return () => clearInterval(t)
  }, [activeSlot, selected])

  // Drag header to move
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const rect = panelRef.current!.getBoundingClientRect()
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top }
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current!
      setPos({ x: d.origX + e.clientX - d.startX, y: d.origY + e.clientY - d.startY })
    }
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Resize from bottom-right corner
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.w, origH: size.h }
    const onMove = (e: MouseEvent) => {
      const d = resizeRef.current!
      setSize({ w: Math.max(MIN_W, d.origW + e.clientX - d.startX), h: Math.max(MIN_H, d.origH + e.clientY - d.startY) })
    }
    const onUp = () => { resizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [size])

  if (agents.length === 0) return null

  const style = pos
    ? { left: pos.x, top: pos.y, bottom: 'auto', right: 'auto', width: size.w, height: minimized ? 'auto' : size.h }
    : { bottom: 80, right: 16, width: size.w, height: minimized ? 'auto' : size.h }

  const selectedAgent = agents.find(a => a.id === selected) ?? agents[0]

  return (
    <div ref={panelRef} className="fixed z-40 pointer-events-auto flex flex-col bg-card border border-border rounded-lg shadow-2xl overflow-hidden" style={style}>
      {/* Header — drag handle */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-hover cursor-move shrink-0 select-none"
        onMouseDown={onDragStart}
      >
        <span className="inline-block w-2.5 h-2.5 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0" />
        <span className="text-[12px] font-semibold text-accent flex-1">
          {agents.length} subagent{agents.length > 1 ? 's' : ''} running
        </span>
        <button className="text-muted hover:text-text text-[11px] bg-transparent border-none cursor-pointer px-1" onMouseDown={e => e.stopPropagation()} onClick={() => setMinimized(m => !m)}>
          {minimized ? '▲' : '▼'}
        </button>
      </div>

      {!minimized && (
        <>
          {/* Agent tabs */}
          {agents.length > 1 && (
            <div className="flex border-b border-border shrink-0 overflow-x-auto">
              {agents.map(a => (
                <button
                  key={a.id}
                  className={`px-3 py-1.5 text-[12px] font-mono whitespace-nowrap border-none cursor-pointer transition-colors ${selected === a.id ? 'bg-bg text-accent border-b-2 border-accent' : 'bg-transparent text-muted hover:text-text'}`}
                  onClick={() => setSelected(a.id)}
                >
                  {a.id}
                </button>
              ))}
            </div>
          )}

          {/* Selected agent info */}
          {selectedAgent && (
            <div className="px-3 py-1.5 border-b border-border shrink-0 flex items-center gap-3">
              <span className="text-[11px] text-muted truncate flex-1">{selectedAgent.task}</span>
              <span className="text-[11px] text-muted/60 shrink-0"><ElapsedTimer startTime={selectedAgent.startTime} /></span>
              {selectedAgent.lastToolCall && <span className="text-[11px] text-muted/50 shrink-0 truncate max-w-[120px]">→ {selectedAgent.lastToolCall}</span>}
            </div>
          )}

          {/* Log output */}
          {selectedAgent && <AgentLog id={selectedAgent.id} />}

          {/* Resize handle */}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
            onMouseDown={onResizeStart}
            style={{ background: 'linear-gradient(135deg, transparent 50%, var(--color-border) 50%)' }}
          />
        </>
      )}
    </div>
  )
}
