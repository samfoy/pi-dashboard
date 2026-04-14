import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AimBadge } from './ui'

interface Agent { name: string; source?: string }

interface Props {
  agents: Agent[]
  value: string          // '' means 'pi'
  onChange: (name: string) => void
  /** Exclude these agent names from the list */
  exclude?: string[]
}

/** Reusable agent selector dropdown with portal positioning. */
export default function AgentSelector({ agents, value, onChange, exclude = [] }: Props) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const t = setTimeout(() => document.addEventListener('click', close), 0)
    return () => { clearTimeout(t); document.removeEventListener('click', close) }
  }, [open])

  const items = [
    { name: 'pi', source: 'pi' },
    ...agents.filter(a => a.name !== 'pi' && !exclude.includes(a.name)),
  ]
  const active = value || 'pi'

  return (
    <div className="relative">
      <button
        ref={btnRef}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-mono font-medium border border-border bg-bg-elevated text-text hover:border-border-strong transition-all cursor-pointer"
        onClick={() => setOpen(!open)}
        aria-label="Switch agent"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="text-accent">⚡</span> {active}
        <span className="text-muted text-[11px] ml-1">▾</span>
      </button>
      {open && btnRef.current && createPortal(
        <div
          role="listbox"
          aria-label="Agent list"
          className="fixed z-[9999] bg-card border border-border rounded-lg shadow-lg min-w-[240px] max-w-[340px] max-h-[280px] overflow-y-auto animate-slide-up"
          style={(() => {
            const r = btnRef.current!.getBoundingClientRect()
            const dropH = 280
            const top = r.bottom + 4 + dropH > window.innerHeight ? r.top - dropH - 4 : r.bottom + 4
            const right = window.innerWidth - r.right
            return { top, right }
          })()}
        >
          {items.map(a => {
            const isCurrent = active === a.name
            return (
              <button
                key={a.name}
                role="option"
                aria-selected={isCurrent}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 min-w-0 border-b border-border last:border-0 cursor-pointer transition-all ${isCurrent ? 'bg-accent-subtle' : 'hover:bg-bg-hover'}`}
                onClick={() => { onChange(a.name === 'pi' ? '' : a.name); setOpen(false) }}
              >
                <span className={`text-[13px] font-mono font-semibold truncate ${isCurrent ? 'text-accent' : 'text-text'}`}>{a.name}</span>
                <AimBadge source={a.source || 'built-in'} />
                {isCurrent && <span className="text-accent text-[11px] ml-auto">✓</span>}
              </button>
            )
          })}
          {items.length === 0 && <div className="px-3 py-2 text-[13px] text-muted italic">No agents found</div>}
        </div>,
        document.body
      )}
    </div>
  )
}
