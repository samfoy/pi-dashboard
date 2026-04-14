import { useState, useEffect, useRef } from 'react'
import { api } from '../../api/client'

export default function McpInfoButton({ agent }: { agent?: string }) {
  const [open, setOpen] = useState(false)
  const [servers, setServers] = useState<{ name: string; enabled?: boolean }[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) api.mcpActive(agent || undefined).then(setServers).catch(() => {})
  }, [open, agent])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="w-5 h-5 rounded-full border border-border text-muted text-[12px] hover:text-text hover:bg-bg-hover transition-all leading-none" title="Session MCP servers">ℹ</button>
      {open && (
        <div className="absolute top-7 left-0 z-50 bg-card border border-border rounded-lg shadow-lg p-3 min-w-[240px] max-h-[320px] overflow-y-auto">
          <div className="text-[12px] uppercase tracking-wider text-muted font-semibold mb-2">MCP Servers ({servers.filter(s => s.enabled !== false).length}/{servers.length})</div>
          {servers.length === 0 ? <div className="text-muted text-[13px] italic">None loaded</div> : servers.map(s => (
            <div key={s.name} className={`flex items-center gap-2 py-1 text-[13px] ${s.enabled === false ? 'opacity-40' : ''}`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.enabled === false ? 'bg-muted' : 'bg-ok'}`} />
              <code className="text-text">{s.name}</code>
              {s.enabled === false && <span className="text-[11px] text-muted">disabled</span>}
            </div>
          ))}
          <div className="mt-2 pt-2 border-t border-border text-[11px] text-muted leading-snug">
            {agent && agent !== 'pi'
              ? `Agent "${agent}" loads only its own MCP servers.`
              : 'pi loads all configured MCP servers — manage from Overview → MCP tab.'}
          </div>
        </div>
      )}
    </div>
  )
}
