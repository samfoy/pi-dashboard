import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'

interface SlashCommand {
  name: string
  description: string
  source?: string
}

interface Props {
  input: string
  anchorRef: React.RefObject<HTMLElement | null>
  onSelect: (command: string) => void
  onClose: () => void
  open?: boolean
}

// Fallback commands if API is unavailable
const FALLBACK: SlashCommand[] = [
  { name: '/clear', description: 'Clear conversation history', source: 'builtin' },
  { name: '/compact', description: 'Compact conversation to free context', source: 'builtin' },
  { name: '/model', description: 'Select model', source: 'builtin' },
  { name: '/tools', description: 'Show available tools', source: 'builtin' },
  { name: '/mcp', description: 'Show configured MCP servers', source: 'builtin' },
  { name: '/usage', description: 'Show billing and usage information', source: 'builtin' },
]

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  builtin: { label: 'pi', cls: 'bg-accent-subtle text-accent' },
  extension: { label: 'ext', cls: 'bg-aim-subtle text-aim' },
  skill: { label: 'skill', cls: 'bg-ok-subtle text-ok' },
}

export default function SlashCommandMenu({ input, anchorRef, onSelect, onClose, open = true }: Props) {
  const [selected, setSelected] = useState(0)
  const [commands, setCommands] = useState<SlashCommand[]>(FALLBACK)

  // Fetch commands once on mount
  useEffect(() => {
    fetch('/api/slash-commands')
      .then(r => r.ok ? r.json() : FALLBACK)
      .then(cmds => { if (Array.isArray(cmds) && cmds.length > 0) setCommands(cmds) })
      .catch(() => {})
  }, [])

  const match = input.match(/^\/([a-z-]*)$/)
  const visible = open && !!match
  const filter = match?.[1] ?? ''
  const filtered = useMemo(
    () => (visible ? commands.filter(c => c.name.slice(1).startsWith(filter)) : []),
    [visible, filter, commands]
  )

  useEffect(() => { setSelected(0) }, [filter, visible])

  const onKey = useCallback((e: KeyboardEvent) => {
    if (!visible || filtered.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => (i + 1) % filtered.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => (i - 1 + filtered.length) % filtered.length) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); onSelect(filtered[selected >= filtered.length ? 0 : selected].name + ' ') }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }, [visible, filtered, selected, onSelect, onClose])

  useEffect(() => {
    if (!visible) return
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [visible, onKey])

  if (!visible || filtered.length === 0 || !anchorRef.current) return null

  const rect = anchorRef.current.getBoundingClientRect()
  const menuH = Math.min(filtered.length * 40 + 8, 400)
  const above = rect.top - menuH - 4
  const top = above > 0 ? above : rect.bottom + 4

  return createPortal(
    <div
      className="fixed z-[9999] bg-card border border-border rounded-lg shadow-lg overflow-y-auto py-1 animate-slide-up"
      style={{ top, left: rect.left, width: Math.min(rect.width, 420), maxHeight: 400 }}
    >
      {filtered.map((cmd, i) => {
        const badge = SOURCE_BADGE[cmd.source || 'builtin']
        return (
          <button
            key={cmd.name}
            className={`w-full text-left px-3 py-2 flex items-center gap-3 cursor-pointer transition-colors ${i === selected ? 'bg-accent-subtle text-text' : 'text-muted hover:bg-bg-hover hover:text-text'}`}
            onMouseEnter={() => setSelected(i)}
            onMouseDown={e => { e.preventDefault(); onSelect(cmd.name + ' ') }}
          >
            <span className="text-[13px] font-mono font-semibold text-accent shrink-0">{cmd.name}</span>
            <span className="text-[12px] truncate flex-1">{cmd.description}</span>
            {badge && <span className={`px-1.5 py-[1px] rounded-full text-[10px] font-semibold shrink-0 ${badge.cls}`}>{badge.label}</span>}
          </button>
        )
      })}
    </div>,
    document.body
  )
}
