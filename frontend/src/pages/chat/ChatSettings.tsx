import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api/client'
import { THINKING_LEVELS, modelFullId, modelPatternMatches, preferredThinkingLevel, supportedThinkingLevels, type ModelLike } from '../../utils/modelUtils'

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
  // Broadcast so open chat views can pick up changes made on the Settings page.
  window.dispatchEvent(new CustomEvent('mc-chat-config'))
}

interface Props {
  activeSlot?: string | null
  currentModel?: string | null
  currentThinking?: string | null
  models?: ModelLike[]
}

/**
 * Per-session quick switcher for the active slot's model + thinking level.
 * Global chat preferences (timestamps, send-on-enter, notif limit, etc.) live
 * on the Settings page → Chat tab — this popover stays focused on the two
 * things you change mid-conversation.
 */
export default function ChatSettings({ activeSlot, currentModel, currentThinking, models }: Props) {
  const [open, setOpen] = useState(false)
  const [showAllModels, setShowAllModels] = useState(false)
  const [enabledModels, setEnabledModels] = useState<string[]>([])
  const currentModelInfo = useMemo(() => models?.find(m => modelFullId(m) === currentModel) || null, [models, currentModel])
  const availableThinkingLevels = useMemo(() => supportedThinkingLevels(currentModelInfo), [currentModelInfo])
  const thinkingLevel = currentThinking || preferredThinkingLevel(currentModelInfo, enabledModels, 'medium')
  const btnRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Fetch enabledModels from pi settings
  useEffect(() => {
    fetch('/api/pi/settings').then(r => r.json()).then(s => {
      if (s?.enabledModels) setEnabledModels(s.enabledModels)
    }).catch(() => {})
  }, [])

  const { pinnedModels, otherModels } = useMemo<{ pinnedModels: ModelLike[]; otherModels: ModelLike[] }>(() => {
    if (!models) return { pinnedModels: [], otherModels: [] }
    if (enabledModels.length === 0) return { pinnedModels: models, otherModels: [] }
    const pinned: ModelLike[] = []
    const other: ModelLike[] = []
    for (const m of models) {
      if (enabledModels.some(e => modelPatternMatches(e, m))) {
        pinned.push(m)
      } else {
        other.push(m)
      }
    }
    // /api/models is already the dashboard's hard-filtered selector list.
    // Keep enabledModels as an ordering hint only; don't hide returned models
    // behind "Show all" when the backend selected them dynamically.
    return { pinnedModels: [...pinned, ...other], otherModels: [] }
  }, [models, enabledModels])

  // Auto-adjust thinking level when model changes (only if pi hasn't told us
  // a value yet — honour whatever the running pi process actually has).
  useEffect(() => {
    if (currentThinking) return
    if (!activeSlot || !currentModelInfo) return
    const newDefault = preferredThinkingLevel(currentModelInfo, enabledModels, 'medium')
    api.setSlotThinking(activeSlot, newDefault)
  }, [activeSlot, currentThinking, currentModelInfo, enabledModels])

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

  const handleModelChange = (fullId: string) => {
    if (!activeSlot || !fullId) return
    const idx = fullId.indexOf('/')
    if (idx === -1) return
    api.setSlotModel(activeSlot, fullId.slice(0, idx), fullId.slice(idx + 1))
  }

  const handleThinkingChange = (level: string) => {
    if (activeSlot) api.setSlotThinking(activeSlot, level)
  }

  return (
    <>
      <button ref={btnRef} className="rounded-md border border-border bg-transparent text-muted px-3 py-[5px] text-[13px] font-medium flex items-center justify-center cursor-pointer hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all font-body" onClick={() => setOpen(!open)} title="Model & thinking" aria-label="Model & thinking">🧠</button>
      {open && btnRef.current && createPortal(
        <div ref={popoverRef} className="fixed z-[9999] bg-card border border-border rounded-lg shadow-lg w-[320px] p-3 flex flex-col gap-3 animate-slide-up" style={(() => { const r = btnRef.current!.getBoundingClientRect(); const top = r.bottom + 6; const left = Math.max(8, Math.min(r.left, window.innerWidth - 328)); return { top, left } })()}>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-[13px] font-semibold text-text-strong">Model &amp; Thinking</span>
            <span className="text-[11px] text-muted">this session</span>
          </div>

          {activeSlot && models && models.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Model</span>
              <select className="bg-bg-elevated border border-border rounded-md px-2 py-1.5 text-[13px] text-text outline-none cursor-pointer font-mono" value={currentModel || ''} onChange={e => handleModelChange(e.target.value)}>
                {!currentModel && <option value="">—</option>}
                {pinnedModels.map(m => <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{`${m.provider} → ${m.name || m.id}`}</option>)}
                {showAllModels && otherModels.length > 0 && (
                  <optgroup label="All Models">
                    {otherModels.map(m => <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{`${m.provider} → ${m.name || m.id}`}</option>)}
                  </optgroup>
                )}
              </select>
              {otherModels.length > 0 && (
                <button className="text-[11px] text-muted hover:text-accent cursor-pointer text-left" onClick={() => setShowAllModels(!showAllModels)}>
                  {showAllModels ? '▾ Hide other models' : `▸ Show all models (${otherModels.length} more)`}
                </button>
              )}
            </div>
          )}

          {activeSlot && (
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">Thinking level</span>
              <div className="flex gap-1">
                {THINKING_LEVELS.map(l => {
                  const disabled = !availableThinkingLevels.includes(l)
                  return <button key={l} disabled={disabled} className={`flex-1 px-1 py-1 rounded text-[11px] font-medium border transition-all ${thinkingLevel === l ? 'bg-accent text-white border-accent' : 'bg-bg-elevated text-muted border-border hover:border-border-strong hover:text-text'} ${disabled ? 'opacity-35 cursor-not-allowed hover:text-muted hover:border-border' : 'cursor-pointer'}`} onClick={() => handleThinkingChange(l)}>{l}</button>
                })}
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
