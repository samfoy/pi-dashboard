import { useEffect, useState, useCallback, useRef, useMemo, createContext } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAppSelector, useAppDispatch } from './store'
import { fetchSlots, sseStatus } from './store/dashboardSlice'
import { fetchNotifications } from './store/notificationsSlice'
import { useWebSocket } from './hooks/useWebSocket'
import { useTheme } from './hooks/useTheme'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { api } from './api/client'
import ChatPage from './pages/ChatPage'
import MarkdownRenderer from './components/MarkdownRenderer'
import ErrorBoundary from './components/ErrorBoundary'
import ConnectionOverlay from './components/ConnectionOverlay'
import SystemPage from './pages/SystemPage'
import LogsPage from './pages/LogsPage'
import SettingsPage from './pages/SettingsPage'

import type { FileChangeCallback } from './hooks/useWebSocket'
type LogSubscribeFn = (cb: ((data: { level: string; msg: string }) => void) | null) => void
type FileChangeSubscribeFn = (cb: FileChangeCallback) => void
export const WsContext = createContext<{
  subscribeLogs: LogSubscribeFn
  subscribeFileChange: FileChangeSubscribeFn
  wsRef: React.RefObject<WebSocket | null>
}>({ subscribeLogs: () => {}, subscribeFileChange: () => {}, wsRef: { current: null } })

const NAV_ITEMS = [
  { path: '/chat', id: 'chat', label: 'Chat', group: 'Main', icon: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /> },
  { path: '/system', id: 'system', label: 'System', group: 'Main', icon: <><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></> },
  { path: '/logs', id: 'logs', label: 'Logs', group: 'Tools', icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></> },

  { path: '/settings', id: 'settings', label: 'Settings', group: 'Tools', icon: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></> },
] as const

export default function App() {
  const dispatch = useAppDispatch()
  const { connected } = useAppSelector(s => s.dashboard)
  const updateAvailable = useAppSelector(s => s.dashboard.status?.update_available)
  const version = useAppSelector(s => s.dashboard.status?.version) || '—'
  const notifCount = useAppSelector(s => s.notifications.items.filter(n => !n.acked).length)
  const location = useLocation()
  const navigate = useNavigate()
  const { preference, cycle: cycleTheme } = useTheme()
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('mc-nav') === '1')
  const [updating, setUpdating] = useState(false)
  const [changes, setChanges] = useState('')
  const [showChangelog, setShowChangelog] = useState(false)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [fullChangelog, setFullChangelog] = useState('')
  const [showFull, setShowFull] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  useEffect(() => {
    dispatch(fetchSlots()); dispatch(fetchNotifications())
    // Fetch status immediately to sync YOLO state (WS status push is periodic)
    api.status().then(s => dispatch(sseStatus(s))).catch(() => {})
  }, [dispatch])
  const { subscribeLogs, subscribeFileChange, wsRef } = useWebSocket()

  // Show changelog on first load after version change (auto-update)
  useEffect(() => {
    if (!version || version === '—') return
    const lastSeen = localStorage.getItem('mc-last-version')
    if (lastSeen === version) return
    // First visit — no baseline to diff, just record current version
    if (!lastSeen) { localStorage.setItem('mc-last-version', version); return }
    // Version changed — show only new entries since lastSeen
    api.changelog().then(d => {
      if (!d.content) return
      const lines = d.content.split('\n')
      const filtered: string[] = []
      let include = false
      for (const line of lines) {
        if (line.startsWith('## [')) {
          const v = line.match(/## \[([^\]]+)\]/)?.[1]
          if (v && lastSeen && v === lastSeen) break
          include = true
        }
        if (include) filtered.push(line)
      }
      const text = filtered.join('\n').trim()
      if (text) { setChanges(text); setShowChangelog(true) }
    }).catch(() => {}).finally(() => localStorage.setItem('mc-last-version', version))
  }, [version])

  // Browser tab title badge
  useEffect(() => {
    document.title = notifCount > 0 ? `(${notifCount}) Pi Dashboard` : `Pi Dashboard`
  }, [notifCount])

  // Browser push notification on new notification
  const prevNotifCount = useRef(0)
  useEffect(() => {
    if (notifCount > prevNotifCount.current && prevNotifCount.current >= 0) {
      if (typeof Notification !== 'undefined') {
        if (Notification.permission === 'granted') {
          new Notification(`Pi Dashboard`, { body: `${notifCount} new notification${notifCount > 1 ? 's' : ''}`, icon: '/logo.png' })
        } else if (Notification.permission === 'default') {
          Notification.requestPermission()
        }
      }
    }
    prevNotifCount.current = notifCount
  }, [notifCount])


  const handleUpdate = useCallback(async () => {
    setShowChangelog(false)
    setUpdating(true)
    try { await api.applyUpdate() } catch { setUpdating(false) }
  }, [])


  const toggleNav = () => setNavCollapsed(prev => { const next = !prev; localStorage.setItem('mc-nav', next ? '1' : '0'); return next })

  // Global keyboard shortcuts
  const shortcuts = useMemo(() => [
    { key: '1', ctrl: true, label: 'Go to Chat', action: () => navigate('/chat') },
    { key: '2', ctrl: true, label: 'Go to System', action: () => navigate('/system') },
    { key: '3', ctrl: true, label: 'Go to Logs', action: () => navigate('/logs') },
    { key: '4', ctrl: true, label: 'Go to Settings', action: () => navigate('/settings') },
    { key: '\\', ctrl: true, label: 'Toggle sidebar', action: () => toggleNav() },
    { key: '/', ctrl: false, label: 'Show shortcuts', action: () => setShowShortcuts(s => !s) },
    { key: 'Escape', label: 'Close dialog', action: () => { setShowShortcuts(false); setShowChangelog(false) } },
  ], [navigate])
  useKeyboardShortcuts(shortcuts)

  const activePath = location.pathname
  const isChat = activePath === '/chat' || activePath === '/'
  const groups = [...new Set(NAV_ITEMS.map(n => n.group))]

  return (
    <WsContext.Provider value={{ subscribeLogs, subscribeFileChange, wsRef }}>
    <ConnectionOverlay />
    <div className={`relative z-[1] h-[100dvh] grid grid-rows-[52px_1fr_auto] md:grid-rows-[52px_1fr] grid-cols-[1fr] animate-rise overflow-hidden transition-[grid-template-columns] duration-[350ms] ease-in-out ${navCollapsed ? 'md:grid-cols-[56px_minmax(0,1fr)]' : 'md:grid-cols-[220px_minmax(0,1fr)]'}`}>

      {/* Topbar */}
      <header className="topbar-glass flex justify-between items-center px-3 md:px-5 pl-[max(0.75rem,env(safe-area-inset-left,0.75rem))] md:pl-[max(1.25rem,env(safe-area-inset-left,1.25rem))] z-40 standalone-pad md:col-span-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 opacity-100 w-40 transition-all duration-300 ease-in-out">
            <span className="text-xl">🥧</span>
            <span className="text-sm font-bold tracking-[.08em] text-text-strong whitespace-nowrap">PI DASH</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-full text-[13px] font-medium bg-card border border-border hover:border-border-strong transition-colors">
            <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${connected ? 'bg-ok shadow-[0_0_8px_rgba(34,197,94,.4)] animate-dot-breathe' : 'bg-danger'}`} />
            <span>Health</span>
            <span className="font-mono text-[13px]">{connected ? 'OK' : 'Offline'}</span>
          </div>
          <div className="hidden md:inline-flex bg-card border border-border rounded-full px-2.5 py-[5px] text-[13px] text-muted font-body font-mono">
            v{version}
          </div>
          <button className="hidden md:inline-flex bg-card border border-border rounded-full px-2.5 py-1 text-[13px] cursor-pointer text-muted font-body hover:border-border-strong hover:text-text hover:scale-105 active:scale-95 transition-all" onClick={cycleTheme}>
            {preference === 'system' ? '🖥 Auto' : preference === 'light' ? '☀ Light' : '🌙 Dark'}
          </button>
          <button className="hidden md:inline-flex bg-card border border-border rounded-full w-7 h-7 text-[13px] cursor-pointer text-muted font-body hover:border-border-strong hover:text-text hover:scale-105 active:scale-95 transition-all items-center justify-center" onClick={() => { dispatch(fetchSlots()); dispatch(fetchNotifications()); api.status().then(s => dispatch(sseStatus(s))).catch(() => {}) }} title="Refresh">
            🔄
          </button>
          <button className="hidden md:inline-flex bg-card border border-border rounded-full w-7 h-7 text-[13px] cursor-pointer text-muted font-body hover:border-danger hover:text-danger hover:scale-105 active:scale-95 transition-all items-center justify-center" onClick={() => { if (confirm('Restart the server? Sessions will be preserved.')) api.restartSessions().catch(() => {}) }} title="Restart server">
            ⏻
          </button>
          <button className="hidden md:inline-flex bg-card border border-border rounded-full w-7 h-7 text-[13px] cursor-pointer text-muted font-body hover:border-border-strong hover:text-text hover:scale-105 active:scale-95 transition-all items-center justify-center" onClick={() => setShowShortcuts(s => !s)} title="Keyboard shortcuts (/)">
            ?
          </button>
        </div>
      </header>

      {/* Keyboard shortcuts modal */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 backdrop-blur-sm animate-rise" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => setShowShortcuts(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <div className="text-sm font-bold text-text-strong">⌨ Keyboard Shortcuts</div>
              <button className="text-muted text-[13px] cursor-pointer hover:text-text bg-transparent border-none font-body" onClick={() => setShowShortcuts(false)}>✕</button>
            </div>
            <div className="space-y-1">
              {[
                { keys: ['Ctrl', '1'], label: 'Go to Chat' },
                { keys: ['Ctrl', '2'], label: 'Go to System' },
                { keys: ['Ctrl', '3'], label: 'Go to Logs' },
                { keys: ['Ctrl', '4'], label: 'Go to Settings' },
                { keys: ['Ctrl', '\\'], label: 'Toggle sidebar' },
                { keys: ['/'], label: 'Show shortcuts' },
                { keys: ['Esc'], label: 'Close dialog / Stop generation' },
                { keys: ['Ctrl', 'N'], label: 'New session', section: 'Chat' },
                { keys: ['Ctrl', 'L'], label: 'Focus input' },
                { keys: ['Enter'], label: 'Send message' },
                { keys: ['Shift', 'Enter'], label: 'New line' },
                { keys: ['/'], label: 'Slash commands (in input)' },
              ].map((s, i) => (
                <div key={i}>
                  {s.section && <div className="text-[11px] text-muted font-medium uppercase tracking-wider mt-3 mb-1">{s.section}</div>}
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-[13px] text-text">{s.label}</span>
                    <div className="flex gap-1">
                      {s.keys.map(k => (
                        <kbd key={k} className="px-1.5 py-0.5 rounded text-[12px] font-mono bg-bg-elevated border border-border text-muted min-w-[24px] text-center">{k}</kbd>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-border text-[12px] text-muted text-center">
              Ctrl = ⌘ on Mac
            </div>
          </div>
        </div>
      )}

      {/* Changelog modal */}
      {showChangelog && !updating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 backdrop-blur-sm animate-rise" role="dialog" aria-modal="true" aria-label="Changelog" onClick={() => { setShowChangelog(false); setShowFull(false) }}>
          <div className={`bg-card border border-border rounded-xl p-6 w-full mx-4 shadow-xl transition-all duration-300 ${showFull ? 'max-w-2xl' : 'max-w-md'}`} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <div className="text-sm font-bold text-text-strong">📦 v{version}</div>
              <button className="text-muted text-[13px] cursor-pointer hover:text-text" onClick={() => { setShowChangelog(false); setShowFull(false) }}>✕</button>
            </div>
            {changes ? (
              <>
                <div className="text-[13px] font-medium text-muted uppercase tracking-wider mb-2">What's new</div>
                <div className="p-3 bg-bg rounded-lg border border-border max-h-56 overflow-y-auto mb-4">
                  <div className="text-[13px] text-text leading-relaxed"><MarkdownRenderer content={changes} /></div>
                </div>
                {updateAvailable && (
                  <button className="w-full py-2 rounded-lg text-[13px] font-medium cursor-pointer bg-accent text-white border-none hover:opacity-90 transition-opacity" onClick={handleUpdate}>
                    Update Now
                  </button>
                )}
              </>
            ) : (
              <div className="text-sm text-muted py-4 text-center">✅ You're on the latest version</div>
            )}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <span className="text-[13px] text-muted">Auto-update on restart</span>
              <button className={`w-9 h-5 rounded-full transition-colors cursor-pointer border-none ${autoUpdate ? 'bg-accent' : 'bg-border'}`}
                onClick={async () => { const next = !autoUpdate; setAutoUpdate(next); await api.setAutoUpdate(next) }}>
                <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${autoUpdate ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <div className="mt-3 pt-3 border-t border-border">
              <button className="text-[13px] text-muted cursor-pointer hover:text-text transition-colors bg-transparent border-none p-0 font-body" onClick={async () => {
                if (!showFull) { if (!fullChangelog) { const d = await api.changelog(); setFullChangelog(d.content || '') }; setShowFull(true) } else { setShowFull(false) }
              }}>{showFull ? '▾ Hide Full Changelog' : '▸ View Full Changelog'}</button>
              {showFull && fullChangelog && (
                <div className="mt-2 p-3 bg-bg rounded-lg border border-border max-h-72 overflow-y-auto">
                  <div className="text-[13px] text-text leading-relaxed"><MarkdownRenderer content={fullChangelog} /></div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Updating overlay */}
      {updating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm animate-rise">
          <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full mx-4 shadow-xl text-center">
            <div className="text-4xl mb-4 animate-pulse">🔄</div>
            <div className="text-lg font-bold text-text-strong mb-2">Updating Pi Dashboard…</div>
            <div className="text-sm text-muted mb-4">Pulling latest changes and rebuilding. The server will restart automatically.</div>
            <div className="mt-4 text-[13px] text-muted">Page will reconnect when ready…</div>
          </div>
        </div>
      )}

      {/* Nav */}
      <aside className={`hidden md:flex overflow-y-auto overflow-x-hidden bg-bg border-r border-border flex-col scrollbar-none transition-[padding] duration-[350ms] ease-in-out ${navCollapsed ? 'px-1.5 pb-4' : 'px-3 pb-4'}`} style={{ scrollbarWidth: 'none' }}>
        <button className={`flex items-center w-full py-2.5 bg-transparent border-none border-b border-border cursor-pointer text-muted hover:text-text hover:bg-bg-hover transition-colors mb-1 shrink-0 ${navCollapsed ? 'justify-center' : 'justify-end pr-2'}`} onClick={toggleNav} title={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <svg viewBox="0 0 24 24" className={`w-4 h-4 stroke-current fill-none stroke-2 transition-transform duration-[350ms] ease-in-out ${navCollapsed ? 'rotate-180' : ''}`} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className={`nav-brand-glow relative flex flex-col items-center text-center overflow-hidden transition-all duration-[350ms] ease-in-out ${navCollapsed ? 'h-0 p-0 m-0 opacity-0 pointer-events-none' : 'pt-7 px-3 pb-[22px] mb-3'}`}>
          <div className="relative z-[1] w-20 h-20 grid place-items-center mb-3.5 hover:scale-[1.12] hover:rotate-[-4deg] transition-transform duration-300 drop-shadow-[0_4px_24px_rgba(245,158,50,.35)]">
            <img src="/logo.png" alt="Pi" className="w-20 h-20 rounded-lg drop-shadow-[0_0_20px_rgba(245,158,50,.4)]" />
          </div>
          <div className="text-sm font-bold tracking-[.08em] text-text-strong">Pi Dashboard</div>
          <div className="text-[12px] font-medium text-muted tracking-[.06em] mt-0.5">Powered by pi coding agent</div>
        </div>

        {groups.map(group => (
          <div className="mb-4 grid gap-0.5" key={group}>
            <div className={`flex items-center gap-2 px-2.5 py-1.5 text-[13px] font-medium text-muted transition-all duration-200 ease-in-out ${navCollapsed ? 'opacity-0 h-0 p-0 m-0 overflow-hidden' : ''}`}>{group}</div>
            {NAV_ITEMS.filter(n => n.group === group).map(n => (
              <div key={n.id}
                className={`relative flex items-center rounded-md cursor-pointer text-sm font-medium whitespace-nowrap transition-all duration-200 ease-in-out ${navCollapsed ? 'justify-center py-2.5 gap-0' : 'gap-2.5 py-2 px-2.5'} ${activePath === n.path ? 'text-text-strong bg-accent-subtle' : 'text-muted hover:text-text hover:bg-bg-hover'}`}
                onClick={() => navigate(n.path)} title={navCollapsed ? n.label : undefined}>
                {n.id === 'chat' && notifCount > 0 && navCollapsed && <span className="absolute top-1 right-1 w-2 h-2 bg-danger rounded-full" />}
                <span className={`w-4 h-4 flex items-center justify-center shrink-0 transition-opacity ${activePath === n.path ? 'opacity-100 text-accent' : 'opacity-70'}`}>
                  <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">{n.icon}</svg>
                </span>
                <span className={`transition-all duration-200 ease-in-out whitespace-nowrap overflow-hidden ${navCollapsed ? 'opacity-0 w-0' : ''}`}>
                  {n.label}
                  {n.id === 'chat' && notifCount > 0 && <span className="ml-1.5 bg-danger text-white text-[12px] font-bold px-1 py-[2px] rounded-full min-w-[18px] text-center inline-block leading-[12px]">{notifCount}</span>}
                </span>
              </div>
            ))}
          </div>
        ))}

        {/* Watermark */}
        <div className={`mt-auto pt-4 pb-2 border-t border-border/50 transition-all duration-[350ms] ${navCollapsed ? 'opacity-0 h-0 overflow-hidden p-0 m-0' : ''}`}>
          <div className="px-1">
            <div className="text-[13px] font-medium text-accent/70 tracking-wide italic">🥧 Pi Dashboard</div>
          </div>
        </div>
      </aside>

      {/* Content */}
      <main className={`flex flex-col min-h-0 overflow-x-hidden min-w-0 ${isChat ? 'overflow-hidden p-0' : 'overflow-y-auto'}`}>
        <ErrorBoundary>
          <Routes>
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/system" element={<SystemPage />} />
            <Route path="/logs" element={<LogsPage />} />

            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden flex justify-around items-center bg-bg border-t border-border px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0.5rem))]">
        {NAV_ITEMS.map(n => (
          <button
            key={n.id}
            className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full bg-transparent border-none cursor-pointer transition-colors ${activePath === n.path ? 'text-accent' : 'text-muted'}`}
            onClick={() => navigate(n.path)}
          >
            <span className="relative">
              <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-current fill-none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">{n.icon}</svg>
              {n.id === 'chat' && notifCount > 0 && (
                <span className="absolute -top-1.5 -right-2.5 bg-danger text-white text-[10px] font-bold px-1 py-[1px] rounded-full min-w-[16px] text-center leading-[12px]">{notifCount}</span>
              )}
            </span>
            <span className="text-[11px] font-medium">{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
    </WsContext.Provider>
  )
}
