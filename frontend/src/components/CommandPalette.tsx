import { useEffect, useCallback, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { useNavigate } from 'react-router-dom'
import { useAppSelector, useAppDispatch } from '../store'
import { switchSlot, resumeFromHistory } from '../store/chatSlice'
import { fetchSlots } from '../store/dashboardSlice'
import { useTheme } from '../hooks/useTheme'
import { api } from '../api/client'

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high']

type Mode = 'root' | 'model' | 'thinking' | 'rename' | 'tag' | 'session-search' | 'system-prompt'

interface SessionResult {
  id: string
  name: string
  file: string
  cwd: string
  startedAt: string
  projectSlug: string
  summary: string
  userMessageCount: number
  assistantMessageCount: number
  models: string[]
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggleSidebar: () => void
}

export default function CommandPalette({ open, onOpenChange, onToggleSidebar }: CommandPaletteProps) {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { cycle: cycleTheme } = useTheme()
  const inputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<Mode>('root')
  const [models, setModels] = useState<{ id: string; name: string; provider: string }[]>([])
  const [renameValue, setRenameValue] = useState('')
  const [tagValue, setTagValue] = useState('')
  const [sessionQuery, setSessionQuery] = useState('')
  const [sessionResults, setSessionResults] = useState<SessionResult[]>([])
  const [sessionSearching, setSessionSearching] = useState(false)
  const [sessionSelected, setSessionSelected] = useState(0)
  const sessionListRef = useRef<HTMLDivElement>(null)
  const sessionDebounce = useRef<ReturnType<typeof setTimeout>>()
  const [systemPrompt, setSystemPrompt] = useState<{ static: string; runtime: string; memory: string; memoryStats: { semantic: number; lessons: number } } | null>(null)
  const [systemPromptLoading, setSystemPromptLoading] = useState(false)
  const [systemPromptTab, setSystemPromptTab] = useState<'runtime' | 'static' | 'memory'>('runtime')

  const activeSlot = useAppSelector(s => s.chat.activeSlot)
  const slots = useAppSelector(s => s.dashboard.slots)
  const currentSlot = slots.find(s => s.key === activeSlot)

  // Fetch models when opening model picker
  useEffect(() => {
    if (open && mode === 'model') {
      api.models().then((d: { models?: { id: string; name: string; provider: string }[] }) => setModels(d.models || [])).catch(() => {})
    }
  }, [open, mode])

  // Reset mode when opening/closing
  useEffect(() => {
    if (open) {
      setMode('root')
      setSessionQuery('')
      setSessionResults([])
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Debounced session search
  useEffect(() => {
    if (mode !== 'session-search') return
    if (sessionDebounce.current) clearTimeout(sessionDebounce.current)
    setSessionSearching(true)
    sessionDebounce.current = setTimeout(() => {
      api.searchSessions(sessionQuery.trim(), 20)
        .then((d: { results?: SessionResult[] }) => { setSessionResults(d.results || []); setSessionSelected(0) })
        .catch(() => setSessionResults([]))
        .finally(() => setSessionSearching(false))
    }, sessionQuery.trim() ? 200 : 0)
    return () => { if (sessionDebounce.current) clearTimeout(sessionDebounce.current) }
  }, [sessionQuery, mode])

  const close = useCallback(() => { setMode('root'); onOpenChange(false) }, [onOpenChange])

  const run = useCallback((fn: () => void) => {
    close()
    fn()
  }, [close])

  const enterMode = useCallback((m: Mode) => {
    setMode(m)
    if (m === 'rename') setRenameValue(currentSlot?.title || '')
    if (m === 'tag') setTagValue('')
    if (m === 'session-search') { setSessionQuery(''); setSessionResults([]); setSessionSelected(0) }
    if (m === 'system-prompt') {
      setSystemPrompt(null)
      setSystemPromptLoading(true)
      setSystemPromptTab('runtime')
      const slot = activeSlot
      if (!slot) {
        // No active slot — build prompt for default CWD
        fetch('/api/chat/system-prompt').then(r => r.ok ? r.json() : Promise.reject(r))
          .then(d => setSystemPrompt(d))
          .catch(() => setSystemPrompt({ static: 'No active session. Select a chat slot first.', runtime: 'No active session. Select a chat slot first.', memory: '', memoryStats: { semantic: 0, lessons: 0 } }))
          .finally(() => setSystemPromptLoading(false))
      } else {
        api.slotSystemPrompt(slot)
          .then(d => setSystemPrompt(d))
          .catch(() => setSystemPrompt({ static: 'Failed to load system prompt.', runtime: 'Failed to load system prompt.', memory: '', memoryStats: { semantic: 0, lessons: 0 } }))
          .finally(() => setSystemPromptLoading(false))
      }
    }
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [currentSlot, activeSlot])

  const goBack = useCallback(() => {
    setMode('root')
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const handleModelSelect = useCallback((provider: string, modelId: string) => {
    if (!activeSlot) return
    run(() => api.setSlotModel(activeSlot, provider, modelId))
  }, [activeSlot, run])

  const handleThinkingSelect = useCallback((level: string) => {
    if (!activeSlot) return
    run(() => api.setSlotThinking(activeSlot, level))
  }, [activeSlot, run])

  const handleRename = useCallback(() => {
    if (!activeSlot || !renameValue.trim()) return
    run(() => { api.renameSlot(activeSlot, renameValue.trim()); dispatch(fetchSlots()) })
  }, [activeSlot, renameValue, run, dispatch])

  const handleTag = useCallback(() => {
    if (!activeSlot || !tagValue.trim()) return
    const newTag = tagValue.trim().toLowerCase()
    const current = currentSlot?.tags || []
    if (!current.includes(newTag)) {
      run(() => { api.tagSlot(activeSlot, [...current, newTag]); dispatch(fetchSlots()) })
    } else {
      close()
    }
  }, [activeSlot, tagValue, currentSlot, run, close, dispatch])

  const handleSessionResume = useCallback((result: SessionResult) => {
    run(() => {
      dispatch(resumeFromHistory({ key: result.id, title: result.name, file: result.file }))
      navigate('/chat')
    })
  }, [run, dispatch, navigate])

  // Sub-mode: System prompt viewer
  if (mode === 'system-prompt') {
    const handleSysPromptKey = (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
    }
    const tabs = [
      { id: 'runtime' as const, label: 'Runtime', badge: systemPrompt?.memoryStats ? `${systemPrompt.memoryStats.semantic}f ${systemPrompt.memoryStats.lessons}l` : '' },
      { id: 'static' as const, label: 'Static' },
      { id: 'memory' as const, label: 'Memory', badge: systemPrompt?.memoryStats ? `${systemPrompt.memoryStats.semantic + systemPrompt.memoryStats.lessons}` : '' },
    ]
    const content = systemPrompt
      ? systemPromptTab === 'runtime' ? systemPrompt.runtime
        : systemPromptTab === 'static' ? systemPrompt.static
        : systemPrompt.memory || '(no memory injected)'
      : ''
    const charCount = content.length
    return (
      <>
        {open && <div className="cmdk-overlay" onClick={close} />}
        <div className="cmdk-dialog cmdk-dialog--fullview" tabIndex={-1} ref={el => el?.focus()} onKeyDown={handleSysPromptKey} style={{ outline: 'none' }}>
          <div className="cmdk-input-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0, padding: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 0' }}>
              <span className="cmdk-search-icon cursor-pointer text-[14px] hover:text-accent" onClick={goBack} title="Back">←</span>
              <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>System Prompt</span>
              <span className="text-[11px] text-muted font-mono">{charCount.toLocaleString()} chars</span>
              <kbd className="cmdk-badge" style={{ cursor: 'pointer' }} onClick={close}>ESC</kbd>
            </div>
            <div style={{ display: 'flex', gap: 2, padding: '8px 16px 0', borderBottom: '1px solid var(--border)' }}>
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSystemPromptTab(t.id)}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    fontWeight: systemPromptTab === t.id ? 600 : 400,
                    color: systemPromptTab === t.id ? 'var(--accent)' : 'var(--muted)',
                    background: 'none',
                    border: 'none',
                    borderBottom: systemPromptTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: -1,
                  }}
                >
                  {t.label}
                  {t.badge && <span style={{ fontSize: 10, opacity: 0.6, fontFamily: 'var(--font-mono, monospace)' }}>{t.badge}</span>}
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: '1 1 0', overflowY: 'auto', padding: '16px', minHeight: 0, maxHeight: '100%' }}>
            {systemPromptLoading ? (
              <div className="text-muted animate-pulse" style={{ padding: '24px 0', textAlign: 'center' }}>Loading system prompt…</div>
            ) : (
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                fontSize: '12px',
                lineHeight: '1.6',
                color: 'var(--fg)',
                margin: 0,
              }}>{content}</pre>
            )}
          </div>
        </div>
      </>
    )
  }

  // Sub-mode: Session search
  if (mode === 'session-search') {
    const handleSessionKey = (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
      else if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
        e.preventDefault(); setSessionSelected(i => Math.min(i + 1, sessionResults.length - 1))
      } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
        e.preventDefault(); setSessionSelected(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && sessionResults.length > 0) {
        e.preventDefault(); handleSessionResume(sessionResults[sessionSelected])
      }
    }
    return (
      <>
        {open && <div className="cmdk-overlay" onClick={close} />}
        <div className="cmdk-dialog" style={{ position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)', zIndex: 99999 }}>
          <div className="cmdk-input-wrapper">
            <span className="cmdk-search-icon cursor-pointer text-[14px] hover:text-accent" onClick={goBack} title="Back">←</span>
            <input
              ref={inputRef}
              className="cmdk-input"
              placeholder="Search past sessions…"
              value={sessionQuery}
              onChange={e => setSessionQuery(e.target.value)}
              onKeyDown={handleSessionKey}
            />
            {sessionSearching && <span className="text-[12px] text-muted animate-pulse">…</span>}
            <kbd className="cmdk-badge">ESC</kbd>
          </div>
          <div ref={sessionListRef} className="cmdk-list" style={{ maxHeight: 400, overflowY: 'auto' }}>
            {!sessionSearching && sessionResults.length === 0 && (
              <div className="cmdk-empty">{sessionQuery.trim() ? 'No sessions found.' : 'Loading…'}</div>
            )}
            {sessionResults.map((r, i) => {
              const date = r.startedAt ? new Date(r.startedAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : ''
              const project = r.projectSlug?.replace(/^--/, '').replace(/--$/, '').replace(/--/g, '/') || ''
              const model = r.models?.[0]?.split('/').pop() || ''
              return (
                <div
                  key={r.id}
                  className={`cmdk-item ${i === sessionSelected ? 'cmdk-item-active' : ''}`}
                  role="button"
                  tabIndex={-1}
                  onClick={() => handleSessionResume(r)}
                  onMouseEnter={() => setSessionSelected(i)}
                  ref={el => { if (i === sessionSelected && el) el.scrollIntoView({ block: 'nearest' }) }}
                >
                  <span className="cmdk-item-icon">📜</span>
                  <div className="flex-1 min-w-0">
                    <div className="cmdk-item-label truncate">{r.name}</div>
                    <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                      {date && <span>{date}</span>}
                      {project && <span className="font-mono truncate max-w-[150px]">{project}</span>}
                      {model && <span>🧠 {model}</span>}
                      <span>{r.userMessageCount} msgs</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </>
    )
  }

  // Sub-mode: Model picker
  if (mode === 'model') {
    return (
      <>
        {open && <div className="cmdk-overlay" onClick={close} />}
        <Command.Dialog open={open} onOpenChange={onOpenChange} label="Pick model" className="cmdk-dialog" shouldFilter={true}>
          <div className="cmdk-input-wrapper">
            <span className="cmdk-search-icon cursor-pointer text-[14px] hover:text-accent" onClick={goBack} title="Back">←</span>
            <Command.Input ref={inputRef} placeholder="Switch model…" className="cmdk-input" />
            <kbd className="cmdk-badge">ESC</kbd>
          </div>
          <Command.List className="cmdk-list">
            <Command.Empty className="cmdk-empty">No models found.</Command.Empty>
            <Command.Group heading="Models" className="cmdk-group">
              {models.map(m => {
                const fullId = `${m.provider}/${m.id}`
                const isCurrent = currentSlot?.model === fullId
                return (
                  <Command.Item key={fullId} value={`${m.name || m.id} ${m.provider}`} onSelect={() => handleModelSelect(m.provider, m.id)} className="cmdk-item">
                    <span className="cmdk-item-icon">{isCurrent ? '●' : '○'}</span>
                    <span className="cmdk-item-label font-mono">{m.name || m.id}</span>
                    <span className="text-[11px] text-muted ml-auto">{m.provider}</span>
                  </Command.Item>
                )
              })}
            </Command.Group>
          </Command.List>
        </Command.Dialog>
      </>
    )
  }

  // Sub-mode: Thinking level
  if (mode === 'thinking') {
    return (
      <>
        {open && <div className="cmdk-overlay" onClick={close} />}
        <Command.Dialog open={open} onOpenChange={onOpenChange} label="Thinking level" className="cmdk-dialog" shouldFilter={true}>
          <div className="cmdk-input-wrapper">
            <span className="cmdk-search-icon cursor-pointer text-[14px] hover:text-accent" onClick={goBack} title="Back">←</span>
            <Command.Input ref={inputRef} placeholder="Set thinking level…" className="cmdk-input" />
            <kbd className="cmdk-badge">ESC</kbd>
          </div>
          <Command.List className="cmdk-list">
            <Command.Empty className="cmdk-empty">No match.</Command.Empty>
            <Command.Group heading="Thinking Level" className="cmdk-group">
              {THINKING_LEVELS.map(l => (
                <Command.Item key={l} value={l} onSelect={() => handleThinkingSelect(l)} className="cmdk-item">
                  <span className="cmdk-item-icon">{l === 'off' ? '💤' : l === 'minimal' ? '💭' : l === 'low' ? '🧠' : l === 'medium' ? '🤔' : '🔥'}</span>
                  <span className="cmdk-item-label capitalize">{l}</span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command.Dialog>
      </>
    )
  }

  // Sub-mode: Rename
  if (mode === 'rename') {
    return (
      <>
        {open && <div className="cmdk-overlay" onClick={close} />}
        <div className="cmdk-dialog" style={{ position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)', zIndex: 99999 }}>
          <div className="cmdk-input-wrapper">
            <span className="cmdk-search-icon cursor-pointer text-[14px] hover:text-accent" onClick={goBack} title="Back">←</span>
            <input
              ref={inputRef}
              className="cmdk-input"
              placeholder="New session name…"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') close()
              }}
            />
            <kbd className="cmdk-badge" style={{ cursor: 'pointer' }} onClick={handleRename}>⏎</kbd>
          </div>
        </div>
      </>
    )
  }

  // Sub-mode: Tag
  if (mode === 'tag') {
    return (
      <>
        {open && <div className="cmdk-overlay" onClick={close} />}
        <div className="cmdk-dialog" style={{ position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)', zIndex: 99999 }}>
          <div className="cmdk-input-wrapper">
            <span className="cmdk-search-icon cursor-pointer text-[14px] hover:text-accent" onClick={goBack} title="Back">←</span>
            <div className="flex items-center gap-1 flex-1 min-w-0">
              {(currentSlot?.tags || []).map(t => (
                <span key={t} className="px-1.5 py-[1px] rounded-full text-[10px] font-semibold bg-accent/15 text-accent border border-accent/25 whitespace-nowrap shrink-0">{t}</span>
              ))}
              <input
                ref={inputRef}
                className="cmdk-input"
                style={{ minWidth: 0 }}
                placeholder="Add tag…"
                value={tagValue}
                onChange={e => setTagValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleTag()
                  if (e.key === 'Escape') close()
                }}
              />
            </div>
            <kbd className="cmdk-badge" style={{ cursor: 'pointer' }} onClick={handleTag}>⏎</kbd>
          </div>
        </div>
      </>
    )
  }

  // Root mode
  return (
    <>
      {open && <div className="cmdk-overlay" onClick={close} />}
      <Command.Dialog open={open} onOpenChange={onOpenChange} label="Command palette" className="pidash-cmd-palette cmdk-dialog" shouldFilter={true}>
        <div className="cmdk-input-wrapper">
          <svg className="cmdk-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <Command.Input ref={inputRef} placeholder="Type a command…" className="cmdk-input" />
          <kbd className="cmdk-badge">ESC</kbd>
        </div>

        <Command.List className="cmdk-list">
          <Command.Empty className="cmdk-empty">No results found.</Command.Empty>

          {/* Navigate */}
          <Command.Group heading="Navigate" className="cmdk-group">
            <Command.Item value="Go to Chat" onSelect={() => run(() => navigate('/chat'))} className="cmdk-item">
              <span className="cmdk-item-icon">💬</span>
              <span className="cmdk-item-label">Go to Chat</span>
              <kbd className="cmdk-kbd">Ctrl+1</kbd>
            </Command.Item>
            <Command.Item value="Go to System" onSelect={() => run(() => navigate('/system'))} className="cmdk-item">
              <span className="cmdk-item-icon">🖥</span>
              <span className="cmdk-item-label">Go to System</span>
              <kbd className="cmdk-kbd">Ctrl+2</kbd>
            </Command.Item>
            <Command.Item value="Go to Logs" onSelect={() => run(() => navigate('/logs'))} className="cmdk-item">
              <span className="cmdk-item-icon">📄</span>
              <span className="cmdk-item-label">Go to Logs</span>
              <kbd className="cmdk-kbd">Ctrl+3</kbd>
            </Command.Item>
            <Command.Item value="Go to Settings" onSelect={() => run(() => navigate('/settings'))} className="cmdk-item">
              <span className="cmdk-item-icon">⚙</span>
              <span className="cmdk-item-label">Go to Settings</span>
              <kbd className="cmdk-kbd">Ctrl+4</kbd>
            </Command.Item>
          </Command.Group>

          {/* Session Actions — only when there's an active slot */}
          {activeSlot && (
            <Command.Group heading="Session" className="cmdk-group">
              <Command.Item value="Rename session title" onSelect={() => enterMode('rename')} className="cmdk-item">
                <span className="cmdk-item-icon">✏️</span>
                <span className="cmdk-item-label">Rename Session</span>
              </Command.Item>
              <Command.Item value="Tag session label" onSelect={() => enterMode('tag')} className="cmdk-item">
                <span className="cmdk-item-icon">🏷</span>
                <span className="cmdk-item-label">Tag Session</span>
              </Command.Item>
              <Command.Item value="Switch model provider" onSelect={() => enterMode('model')} className="cmdk-item">
                <span className="cmdk-item-icon">🤖</span>
                <span className="cmdk-item-label">Switch Model</span>
                {currentSlot?.model && <span className="text-[11px] text-muted ml-auto font-mono">{currentSlot.model.split('/').pop()}</span>}
              </Command.Item>
              <Command.Item value="Thinking level reasoning budget" onSelect={() => enterMode('thinking')} className="cmdk-item">
                <span className="cmdk-item-icon">🧠</span>
                <span className="cmdk-item-label">Thinking Level</span>
              </Command.Item>
            </Command.Group>
          )}

          {/* Actions */}
          <Command.Group heading="Actions" className="cmdk-group">
            <Command.Item value="Show system prompt instructions context" onSelect={() => enterMode('system-prompt')} className="cmdk-item">
              <span className="cmdk-item-icon">🥧</span>
              <span className="cmdk-item-label">Show System Prompt</span>
            </Command.Item>
            <Command.Item value="Resume session search history" onSelect={() => enterMode('session-search')} className="cmdk-item">
              <span className="cmdk-item-icon">📜</span>
              <span className="cmdk-item-label">Resume Session…</span>
            </Command.Item>
            <Command.Item value="New session /new" onSelect={() => run(() => { dispatch(switchSlot(null)); navigate('/chat') })} className="cmdk-item">
              <span className="cmdk-item-icon">✨</span>
              <span className="cmdk-item-label">New Session</span>
              <kbd className="cmdk-kbd">Ctrl+N</kbd>
            </Command.Item>
            <Command.Item value="Toggle theme dark light" onSelect={() => run(cycleTheme)} className="cmdk-item">
              <span className="cmdk-item-icon">🎨</span>
              <span className="cmdk-item-label">Toggle Theme</span>
            </Command.Item>
            <Command.Item value="Toggle sidebar" onSelect={() => run(onToggleSidebar)} className="cmdk-item">
              <span className="cmdk-item-icon">📐</span>
              <span className="cmdk-item-label">Toggle Sidebar</span>
              <kbd className="cmdk-kbd">Ctrl+\</kbd>
            </Command.Item>
            <Command.Item value="Refresh reload" onSelect={() => run(() => { dispatch(fetchSlots()) })} className="cmdk-item">
              <span className="cmdk-item-icon">🔄</span>
              <span className="cmdk-item-label">Refresh</span>
            </Command.Item>
          </Command.Group>

          {/* Slash Commands */}
          <Command.Group heading="Slash Commands" className="cmdk-group">
            <Command.Item value="/new create session" onSelect={() => run(() => { dispatch(switchSlot(null)); navigate('/chat') })} className="cmdk-item">
              <span className="cmdk-item-icon cmdk-slash">/new</span>
              <span className="cmdk-item-label">Create new session</span>
            </Command.Item>
            <Command.Item value="/clear reset session" onSelect={() => run(() => { dispatch(switchSlot(null)); navigate('/chat') })} className="cmdk-item">
              <span className="cmdk-item-icon cmdk-slash">/clear</span>
              <span className="cmdk-item-label">Clear current session</span>
            </Command.Item>
            <Command.Item value="/compact compress context" onSelect={() => run(() => navigate('/chat'))} className="cmdk-item">
              <span className="cmdk-item-icon cmdk-slash">/compact</span>
              <span className="cmdk-item-label">Compact current context</span>
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command.Dialog>
    </>
  )
}
