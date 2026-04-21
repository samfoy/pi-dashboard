import { useState, useRef, useEffect, memo } from 'react'
import { useAppDispatch } from '../store'
import { clearNotifications, deleteNotification, ackAllNotifications } from '../store/notificationsSlice'
import { switchSlot, deleteSlot, fetchHistory, resumeFromHistory, deleteHistorySession } from '../store/chatSlice'
import { api } from '../api/client'
import { SearchInput } from '../components/ui'
import InfoTip from '../components/InfoTip'
import TypewriterText from '../components/TypewriterText'
import { NotificationItem } from './chat'
import type { Notification } from '../types'

interface Slot {
  key: string
  title: string
  running: boolean
  stopping?: boolean
  pending_approval?: boolean
  agent?: string
  workspace?: string
  cwd?: string
  created?: string
}

interface HistoryItem {
  key: string
  title: string
  created?: string
  project?: string
}


interface ChatSidebarProps {
  slots: Slot[]
  activeSlot: string | null
  unreadSlots: string[]
  notifications: Notification[]
  history: HistoryItem[]
  historyHasMore: boolean
  viewingNotification: Notification | null
  onViewNotification: (n: Notification | null) => void
  onNewSessionInCwd?: (cwd: string) => void
  onNewSession?: () => void
  mobileOpen?: boolean
  onMobileClose?: () => void
}

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 800
const SIDEBAR_LS_KEY = 'mc-sidebar-width'

/** Extract a short project name from a cwd path or project string. */
function projectName(cwd?: string | null): string {
  if (!cwd) return ''
  // Strip trailing slashes, take last path segment
  return cwd.replace(/\/+$/, '').split('/').pop() || ''
}

/** Group items by a key function, preserving order of first appearance. */
function groupBy<T>(items: T[], keyFn: (item: T) => string): { key: string; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = keyFn(item)
    const arr = map.get(k)
    if (arr) arr.push(item)
    else map.set(k, [item])
  }
  return Array.from(map.entries()).map(([key, items]) => ({ key, items }))
}

type GroupMode = 'date' | 'project'
const SLOTS_GROUP_LS_KEY = 'mc-slots-group-mode'

/** Temporal grouping matching iOS: Today, Yesterday, Last 7 Days, Last 30 Days, then months. */
function temporalGroupLabel(dateStr?: string): string {
  if (!dateStr) return 'Unknown'
  const date = new Date(dateStr)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000)
  const ts = date.getTime()
  if (ts >= startOfToday.getTime()) return 'Today'
  if (ts >= startOfYesterday.getTime()) return 'Yesterday'
  const daysAgo = Math.floor((startOfToday.getTime() - ts) / 86400000)
  if (daysAgo <= 7) return 'Last 7 Days'
  if (daysAgo <= 30) return 'Last 30 Days'
  return date.toLocaleDateString([], { month: 'long', year: 'numeric' })
}

/** Fixed ordering for temporal groups. Lower = shown first. */
const TEMPORAL_ORDER: Record<string, number> = {
  'Today': 0, 'Yesterday': 1, 'Last 7 Days': 2, 'Last 30 Days': 3,
}

function groupByDate<T extends { created?: string }>(items: T[]): { key: string; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = temporalGroupLabel(item.created)
    const arr = map.get(k)
    if (arr) arr.push(item)
    else map.set(k, [item])
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      const oa = TEMPORAL_ORDER[a] ?? 100
      const ob = TEMPORAL_ORDER[b] ?? 100
      if (oa !== ob) return oa - ob
      if (oa === 100 && ob === 100) {
        return new Date(b + ' 1').getTime() - new Date(a + ' 1').getTime()
      }
      return 0
    })
    .map(([key, items]) => ({
      key,
      items: items.sort((a, b) => {
        const ta = a.created ? new Date(a.created).getTime() : 0
        const tb = b.created ? new Date(b.created).getTime() : 0
        return tb - ta
      })
    }))
}

function ChatSidebar({
  slots, activeSlot, unreadSlots, notifications, history, historyHasMore,
  viewingNotification, onViewNotification, onNewSessionInCwd, onNewSession,
  mobileOpen, onMobileClose,
}: ChatSidebarProps) {
  const dispatch = useAppDispatch()

  // Sidebar width (self-managed)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_LS_KEY)
    const n = saved ? parseInt(saved, 10) : NaN
    return !isNaN(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX ? n : 260
  })

  // Sidebar-only state
  const [slotFilter, setSlotFilter] = useState('')
  const [notifFilter, setNotifFilter] = useState('')
  const [historyFilter, setHistoryFilter] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [notifLimit, setNotifLimit] = useState(50)
  const [slotsGroupMode, setSlotsGroupMode] = useState<GroupMode>(() => {
    return (localStorage.getItem(SLOTS_GROUP_LS_KEY) as GroupMode) || 'date'
  })

  // Resize logic
  const sidebarDragging = useRef(false)
  const sidebarStartX = useRef(0)
  const sidebarStartW = useRef(0)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!sidebarDragging.current) return
      const newW = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, sidebarStartW.current + e.clientX - sidebarStartX.current))
      setSidebarWidth(newW)
    }
    const onUp = () => {
      if (!sidebarDragging.current) return
      sidebarDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setSidebarWidth(w => { localStorage.setItem(SIDEBAR_LS_KEY, String(w)); return w })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const visibleNotifs = notifications.slice().reverse().slice(0, notifLimit)

  return (
    <>
    {mobileOpen && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={onMobileClose} />}
    <div className={`bg-bg-accent border-r border-border flex-col shrink-0 relative
      fixed top-0 left-0 bottom-0 w-[280px] z-50 transition-transform duration-300
      pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]
      md:relative md:z-auto md:translate-x-0 md:transition-none md:flex md:pt-0 md:pb-0
      ${mobileOpen ? 'flex translate-x-0' : 'hidden md:flex -translate-x-full md:translate-x-0'}`}
      style={{ width: typeof window !== 'undefined' && window.innerWidth >= 768 ? sidebarWidth : undefined }}>
      {/* Drag handle (desktop only) */}
      <div
        className="absolute top-0 -right-[2px] w-[5px] h-full cursor-col-resize z-10 group/drag items-center justify-center hidden md:flex"
        onMouseDown={e => { e.preventDefault(); sidebarDragging.current = true; sidebarStartX.current = e.clientX; sidebarStartW.current = sidebarWidth; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none' }}
      >
        <div className="w-[2px] h-full bg-transparent group-hover/drag:bg-orange-400 group-active/drag:bg-orange-500 transition-colors duration-200" />
      </div>
      <div className="flex justify-between items-center px-4 py-3.5 border-b border-border">
        <span className="text-[13px] font-medium text-muted uppercase tracking-[.04em] flex items-center gap-1.5">Sessions <InfoTip text="Each tab is an independent pi session with its own context. Switch agents per tab. Sessions persist to history on close." /></span>
        <div className="flex items-center gap-1.5">
          <button className={`w-6 h-6 rounded-md border text-[11px] cursor-pointer flex items-center justify-center transition-all ${slotsGroupMode === 'date' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-transparent text-muted hover:text-text'}`} onClick={() => { setSlotsGroupMode('date'); localStorage.setItem(SLOTS_GROUP_LS_KEY, 'date') }} title="Group by date">🕐</button>
          <button className={`w-6 h-6 rounded-md border text-[11px] cursor-pointer flex items-center justify-center transition-all ${slotsGroupMode === 'project' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-transparent text-muted hover:text-text'}`} onClick={() => { setSlotsGroupMode('project'); localStorage.setItem(SLOTS_GROUP_LS_KEY, 'project') }} title="Group by project">📂</button>
          <button className="w-7 h-7 rounded-md bg-accent text-white border-none text-lg cursor-pointer flex items-center justify-center hover:bg-accent-hover hover:shadow-[0_0_16px_var(--accent-glow)] hover:rotate-90 hover:scale-110 active:scale-95 transition-all" onClick={() => onNewSession ? onNewSession() : dispatch(switchSlot(null))} title="New chat" aria-label="New chat session">+</button>
        </div>
      </div>
      <div className="px-2 pt-2 pb-1"><SearchInput placeholder="Filter sessions…" value={slotFilter} onChange={e => setSlotFilter(e.target.value)} /></div>
      <div className="flex-1 overflow-y-auto p-2">
        {(() => {
          const filtered = slots.filter(s => !slotFilter || (s.title + s.key + (s.agent || '')).toLowerCase().includes(slotFilter.toLowerCase()))
          const groups = slotsGroupMode === 'date'
            ? groupByDate(filtered)
            : groupBy(filtered, s => projectName(s.cwd) || '')
          const needsHeaders = groups.length > 1 || (groups.length === 1 && groups[0].key !== '')
          return groups.map(g => (
            <div key={g.key || '__ungrouped'}>
              {needsHeaders && <div className="text-[11px] text-muted font-semibold uppercase tracking-wider px-2 pt-2 pb-1 flex items-center gap-1.5"><span className="text-[10px]">{slotsGroupMode === 'date' ? '🕐' : '📂'}</span>{g.key || 'Other'}</div>}
              {g.items.map(s => {
                const agentName = 'pi'
                const agentColor = 'text-accent'
                return (
                  <div key={s.key} className={`group flex items-start gap-2.5 px-2.5 py-2 rounded-md cursor-pointer text-sm transition-all mb-0.5 border animate-slide-in-left ${activeSlot === s.key ? 'text-text-strong bg-accent-subtle border-accent-subtle' : 'text-muted hover:text-text hover:bg-bg-hover border-transparent'}`}
                    role="button"
                    tabIndex={0}
                    onMouseDown={(e) => { e.preventDefault(); if ((e.target as HTMLElement).dataset.close) { dispatch(deleteSlot(s.key)); return }; onViewNotification(null); dispatch(switchSlot(s.key)) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewNotification(null); dispatch(switchSlot(s.key)) } }}>
                    {unreadSlots.includes(s.key) ? <span className="w-2 h-2 rounded-full bg-[var(--info)] shrink-0 shadow-[0_0_6px_rgba(59,130,246,.4)] animate-dot-breathe self-center" /> : <span className="w-2 shrink-0" />}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className={`text-[11px] font-semibold truncate leading-tight flex items-center gap-1 ${agentColor}`}>
                      {agentName}
                      {s.pending_approval ? (
                        <span className="inline-flex items-center gap-0.5 px-1 py-[1px] rounded-full text-[10px] font-bold bg-warn-subtle text-warn border border-warn/30 animate-scale-in" title="Waiting for approval">🔐</span>
                      ) : s.stopping ? (
                        <span className="inline-flex items-center gap-0.5 px-1 py-[1px] rounded-full text-[10px] font-bold bg-danger-subtle text-danger border border-danger/30" title="Stopping">■</span>
                      ) : s.running ? (
                        <span className="typing-dots-sm"><span /><span /><span /></span>
                      ) : null}
                    </div>
                      <div className="overflow-x-auto" title={s.title !== s.key ? s.title : s.key}>
                        <TypewriterText className="whitespace-nowrap font-mono text-[13px]" text={s.title !== s.key ? s.title : s.key} />
                      </div>
                    </div>
                    {s.workspace && s.workspace !== 'default' && <span className="px-1.5 py-[2px] rounded-full text-[11px] font-bold bg-ok-subtle text-ok border border-ok/30 shrink-0 max-w-[60px] overflow-hidden text-ellipsis whitespace-nowrap self-center" title={`workspace: ${s.workspace}`}>{s.workspace}</span>}
                    {s.cwd && onNewSessionInCwd && <span className="opacity-0 text-[12px] text-muted cursor-pointer px-[3px] py-[2px] rounded hover:opacity-100 hover:text-accent hover:bg-accent-subtle group-hover:opacity-50 transition-all self-center" title={`New session in ${s.cwd}`} onClick={e => { e.stopPropagation(); onNewSessionInCwd(s.cwd!) }}>+</span>}
                    <span data-close="1" className="opacity-0 text-[12px] text-muted cursor-pointer px-[5px] py-[2px] rounded hover:opacity-100 hover:text-danger hover:bg-danger-subtle group-hover:opacity-50 transition-all self-center">✕</span>
                  </div>
                )
              })}
            </div>
          ))
        })()}
      </div>

      {/* Notifications */}
      <div className="flex justify-between items-center px-3 pt-2.5 pb-1.5 mt-1 border-t border-border bg-bg-accent">
        <span className="text-[13px] font-semibold text-text-strong flex items-center gap-1.5 select-none min-w-0 shrink">
          🔔 <span className="truncate">Notifications</span> {notifications.filter(n => !n.acked).length > 0 && <span className="bg-danger text-white text-[12px] font-bold px-1 py-[2px] rounded-full min-w-[18px] text-center leading-[12px] animate-scale-in shrink-0">{notifications.filter(n => !n.acked).length}</span>}
        </span>
        <div className="flex gap-1 shrink-0">
          {notifications.some(n => !n.acked) && <button className="h-[22px] px-1.5 rounded-sm border border-ok/40 bg-ok/10 text-ok text-[11px] font-semibold cursor-pointer flex items-center hover:bg-ok/20 hover:border-ok transition-all shrink-0 whitespace-nowrap" onClick={() => dispatch(ackAllNotifications())} title="Mark all as read" aria-label="Mark all notifications as read">✓ All</button>}
          <button className="w-[22px] h-[22px] rounded-sm border border-border bg-transparent text-muted text-[12px] cursor-pointer flex items-center justify-center hover:text-danger hover:border-danger hover:bg-danger-subtle transition-all shrink-0" onClick={() => dispatch(clearNotifications())} title="Clear all">✕</button>
        </div>
      </div>
      <div className="px-2 pb-1"><SearchInput placeholder="Filter notifications…" value={notifFilter} onChange={e => setNotifFilter(e.target.value)} /></div>
      <div className="overflow-y-auto p-2 scroll-shadow" style={{ maxHeight: '30%' }}>
        {visibleNotifs.filter(n => !notifFilter || (n.title + (n.body || '')).toLowerCase().includes(notifFilter.toLowerCase())).map(n => (
          <NotificationItem key={n.ts} n={n} active={viewingNotification?.ts === n.ts} onOpen={() => { onViewNotification(n) }} onDelete={(ts) => dispatch(deleteNotification(ts))} />
        ))}
        {notifications.length > notifLimit && (
          <div
            className="flex justify-center py-2 text-accent text-[13px] font-medium cursor-pointer hover:bg-accent-subtle rounded-md"
            role="button"
            tabIndex={0}
            onClick={() => setNotifLimit(prev => prev + 50)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setNotifLimit(prev => prev + 50) } }}
          >
            Load more… ({notifications.length - notifLimit} remaining)
          </div>
        )}
      </div>

      {/* History */}
      <div className="flex justify-between items-center px-3 pt-2.5 pb-1.5 mt-1 border-t border-border bg-bg-accent">
        <span className="text-[13px] font-semibold text-text-strong cursor-pointer flex items-center gap-1.5 select-none hover:text-accent transition-colors" onClick={() => { setHistoryOpen(!historyOpen); if (!historyOpen) dispatch(fetchHistory(false)) }}>
          📜 History <span className={`text-[12px] transition-transform duration-200 ${historyOpen ? 'rotate-90' : ''}`}>▸</span>
        </span>
        {historyOpen && history.length > 0 && <button className="px-2 py-0.5 rounded-md border border-border bg-transparent text-muted text-[12px] cursor-pointer hover:text-danger hover:border-danger transition-all" onClick={async () => { if (confirm('Delete ALL history sessions? This cannot be undone.')) { await api.clearSessions(); dispatch(fetchHistory(false)) } }}>Clear all</button>}
      </div>
      {historyOpen && (<>
        <div className="px-2 pb-1"><SearchInput placeholder="Filter history…" value={historyFilter} onChange={e => setHistoryFilter(e.target.value)} /></div>
        <div className="overflow-y-auto p-2 scroll-shadow" style={{ maxHeight: '30%' }}>
          {(() => {
            const filtered = history.filter(s => !historyFilter || (s.title + s.key).toLowerCase().includes(historyFilter.toLowerCase()))
            const groups = groupBy(filtered, s => s.project || '')
            const needsHeaders = groups.length > 1 || (groups.length === 1 && groups[0].key !== '')
            return groups.map(g => (
              <div key={g.key || '__ungrouped'}>
                {needsHeaders && <div className="text-[11px] text-muted font-semibold uppercase tracking-wider px-2 pt-2 pb-1 flex items-center gap-1.5"><span className="text-[10px]">📂</span>{g.key || 'Other'}</div>}
                {g.items.map(s => (
                  <div key={s.key} className="group flex items-start gap-2.5 px-2.5 py-2 rounded-md cursor-pointer text-sm text-muted hover:text-text hover:bg-bg-hover transition-all mb-0.5 border border-transparent" title={s.title || s.key}
                    role="button"
                    tabIndex={0}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      if ((e.target as HTMLElement).dataset.close) { dispatch(deleteHistorySession(s.key)); return }
                      dispatch(resumeFromHistory({ key: s.key, title: s.title || s.key }))
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatch(resumeFromHistory({ key: s.key, title: s.title || s.key })) } }}>
                    <span className="w-2 h-2 mt-1.5 rounded-full border-[1.5px] border-muted-strong shrink-0" />
                    <span className="text-[12px] mt-0.5 shrink-0">{s.key.startsWith('dashboard') ? '🖥' : <svg className="w-3.5 h-3.5 inline-block" viewBox="0 0 24 24" fill="none"><path d="M6 15a2 2 0 1 1 0-4h4v4a2 2 0 1 1-4 0Zm4-4V5a2 2 0 1 1 4 0v6h-4Z" fill="#E01E5A"/><path d="M18 9a2 2 0 1 1 0 4h-4V9a2 2 0 1 1 4 0Zm-4 4v6a2 2 0 1 1-4 0v-6h4Z" fill="#36C5F0"/><path d="M10 5a2 2 0 0 1 4 0v4h-4V5Z" fill="#2EB67D"/><path d="M14 19a2 2 0 0 1-4 0v-4h4v4Z" fill="#ECB22E"/></svg>}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[13px] leading-snug break-words line-clamp-2">{s.title || s.key}</div>
                      <div className="text-[11px] text-muted font-mono mt-0.5">{s.created ? new Date(s.created).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : ''}</div>
                    </div>
                    {onNewSessionInCwd && s.project && <span className="opacity-0 group-hover:opacity-40 text-[12px] cursor-pointer hover:!opacity-100 hover:text-accent shrink-0 mt-0.5 transition-opacity" title={`New session in /${s.project}`} onClick={e => { e.stopPropagation(); e.preventDefault(); onNewSessionInCwd('/' + s.project) }}>+</span>}
                    <span data-close="1" className="opacity-0 group-hover:opacity-40 text-[12px] cursor-pointer hover:!opacity-100 hover:text-danger shrink-0 mt-0.5 transition-opacity">✕</span>
                  </div>
                ))}
              </div>
            ))
          })()}
          {historyHasMore && <div className="flex justify-center py-2 text-accent text-[13px] font-medium cursor-pointer hover:bg-accent-subtle rounded-md" role="button" tabIndex={0} onMouseDown={(e) => { e.preventDefault(); dispatch(fetchHistory(true)) }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatch(fetchHistory(true)) } }}>Load more…</div>}
        </div>
      </>)}
    </div>
    </>
  )
}

export default memo(ChatSidebar)
