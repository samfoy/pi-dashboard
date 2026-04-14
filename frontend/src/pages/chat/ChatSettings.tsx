import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api/client'

export interface ChatConfig {
  historyExpanded: boolean
  notifLimit: number
  showTimestamps: boolean
  sendOnEnter: boolean
}

const LS_KEY = 'mc-chat-config'
const DEFAULTS: ChatConfig = { historyExpanded: true, notifLimit: 50, showTimestamps: true, sendOnEnter: true }

export function loadChatConfig(): ChatConfig {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') } }
  catch { return { ...DEFAULTS } }
}

export function saveChatConfig(cfg: ChatConfig) {
  localStorage.setItem(LS_KEY, JSON.stringify(cfg))
}

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high']

interface Props {
  config: ChatConfig
  onChange: (c: ChatConfig) => void
  activeSlot?: string | null
  currentModel?: string | null
  models?: { id: string; name: string; provider: string }[]
}

export default function ChatSettings({ config, onChange, activeSlot, currentModel, models }: Props) {
  const [open, setOpen] = useState(false)
  const [thinkingLevel, setThinkingLevel] = useState('medium')
  const btnRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return
      if (popoverRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const t = setTimeout(() => document.addEventListener('click', close), 0)
    return () => { clearTimeout(t); document.removeEventListener('click', close) }
  }, [open])

  const set = <K extends keyof ChatConfig>(k: K, v: ChatConfig[K]) => {
    const next = { ...config, [k]: v }
    saveChatConfig(next)
    onChange(next)
  }

  const handleModelChange = (fullId: string) => {
    if (!activeSlot || !fullId) return
    const idx = fullId.indexOf('/')
    if (idx === -1) return
    api.setSlotModel(activeSlot, fullId.slice(0, idx), fullId.slice(idx + 1))
  }

  const handleThinkingChange = (level: string) => {
    setThinkingLevel(level)
    if (activeSlot) api.setSlotThinking(activeSlot, level)
  }

  return (
    <>
      <button ref={btnRef} className="w-7 h-7 rounded-md border border-border bg-transparent text-muted flex items-center justify-center cursor-pointer hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all" onClick={() => setOpen(!open)} title="Chat settings" aria-label="Chat settings">⚙</button>
      {open && btnRef.current && createPortal(
        <div ref={popoverRef} className="fixed z-[9999] bg-card border border-border rounded-lg shadow-lg w-[320px] p-3 flex flex-col gap-3 animate-slide-up" style={(() => { const r = btnRef.current!.getBoundingClientRect(); const top = r.bottom + 6; const left = Math.max(8, Math.min(r.left, window.innerWidth - 328)); return { top, left } })()}>
          <div className="text-[13px] font-semibold text-text-strong border-b border-border pb-2">Chat Settings</div>

          {activeSlot && models && models.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Model</span>
              <select className="bg-bg-elevated border border-border rounded-md px-2 py-1.5 text-[13px] text-text outline-none cursor-pointer font-mono" value={currentModel || ''} onChange={e => handleModelChange(e.target.value)}>
                {!currentModel && <option value="">—</option>}
                {models.map(m => <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.name || m.id}</option>)}
              </select>
            </div>
          )}

          {activeSlot && (
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Thinking level</span>
              <div className="flex gap-1">
                {THINKING_LEVELS.map(l => (
                  <button key={l} className={`flex-1 px-1 py-1 rounded text-[11px] font-medium border cursor-pointer transition-all ${thinkingLevel === l ? 'bg-accent text-white border-accent' : 'bg-bg-elevated text-muted border-border hover:border-border-strong hover:text-text'}`} onClick={() => handleThinkingChange(l)}>{l}</button>
                ))}
              </div>
            </div>
          )}

          <Toggle label="History expanded by default" checked={config.historyExpanded} onChange={v => set('historyExpanded', v)} />
          <Toggle label="Show message timestamps" checked={config.showTimestamps} onChange={v => set('showTimestamps', v)} />
          <Toggle label="Send on Enter" hint={config.sendOnEnter ? "Shift+Enter for newline" : "Click Send to submit"} checked={config.sendOnEnter} onChange={v => set('sendOnEnter', v)} />
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted">Notification limit</span>
            <select className="bg-bg-elevated border border-border rounded-md px-2 py-1 text-[13px] text-text outline-none cursor-pointer" value={config.notifLimit} onChange={e => set('notifLimit', Number(e.target.value))}>
              {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <div>
        <span className="text-[13px] text-muted group-hover:text-text transition-colors">{label}</span>
        {hint && <div className="text-[11px] text-muted/60">{hint}</div>}
      </div>
      <div className={`w-9 h-5 rounded-full relative transition-colors ${checked ? 'bg-accent' : 'bg-border'}`} onClick={() => onChange(!checked)}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
    </label>
  )
}
