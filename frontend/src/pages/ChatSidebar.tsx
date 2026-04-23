import { useState, useRef, useEffect, memo } from 'react'
import { useAppDispatch } from '../store'
import { switchSlot, deleteSlot } from '../store/chatSlice'
import { api } from '../api/client'
import { SearchInput } from '../components/ui'
import InfoTip from '../components/InfoTip'
import TypewriterText from '../components/TypewriterText'


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
  updated?: string
  tags?: string[]
}

const STATUS_ORDER: Record<string, number> = {
  '⚠ Needs Input': 0, '▶ Running': 1, '⏸ Idle': 2,
}

function groupByStatus<T extends { running: boolean; stopping?: boolean; pending_approval?: boolean; updated?: string }>(items: T[]): { key: string; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = item.pending_approval ? '⚠ Needs Input' : item.running ? '▶ Running' : '⏸ Idle'
    const arr = map.get(k)
    if (arr) arr.push(item)
    else map.set(k, [item])
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (STATUS_ORDER[a] ?? 99) - (STATUS_ORDER[b] ?? 99))
    .map(([key, items]) => ({
      key,
      items: items.sort((a, b) => {
        const ta = a.updated ? new Date(a.updated).getTime() : 0
        const tb = b.updated ? new Date(b.updated).getTime() : 0
        return tb - ta
      })
    }))
}

interface ChatSidebarProps {
  slots: Slot[]
  activeSlot: string | null
  unreadSlots: string[]

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

type GroupMode = 'date' | 'project' | 'status' | 'tag'
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

/** Group slots by their tags. Slots with multiple tags appear in each group. Untagged slots go to 'Untagged'. */
function groupByTag<T extends { tags?: string[]; updated?: string }>(items: T[]): { key: string; items: T[] }[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const tags = item.tags?.length ? item.tags : ['untagged']
    for (const tag of tags) {
      const arr = map.get(tag)
      if (arr) arr.push(item)
      else map.set(tag, [item])
    }
  }
  // Sort: named tags first (alphabetical), then 'untagged' last
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      if (a === 'untagged') return 1
      if (b === 'untagged') return -1
      return a.localeCompare(b)
    })
    .map(([key, items]) => ({
      key,
      items: items.sort((a, b) => {
        const ta = (a as any).updated ? new Date((a as any).updated).getTime() : 0
        const tb = (b as any).updated ? new Date((b as any).updated).getTime() : 0
        return tb - ta
      })
    }))
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
  slots, activeSlot, unreadSlots,
  onNewSessionInCwd, onNewSession,
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

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem('mc-collapsed-groups'); return s ? new Set(JSON.parse(s)) : new Set() } catch { return new Set() }
  })
  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      localStorage.setItem('mc-collapsed-groups', JSON.stringify([...next]))
      return next
    })
  }
  const [editingTagsSlot, setEditingTagsSlot] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')
  const tagInputRef = useRef<HTMLInputElement>(null)
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


  return (
    <>
    {mobileOpen && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={onMobileClose} />}
    <div className={`pidash-sidebar bg-bg-accent border-r border-border flex-col shrink-0 relative
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
          <select className="h-6 rounded-md border border-border bg-transparent text-[11px] text-muted cursor-pointer outline-none px-1 hover:border-border-strong hover:text-text transition-all" value={slotsGroupMode} onChange={e => { const v = e.target.value as GroupMode; setSlotsGroupMode(v); localStorage.setItem(SLOTS_GROUP_LS_KEY, v) }}>
            <option value="date">🕐 Date</option>
            <option value="project">📂 Project</option>
            <option value="status">⚡ Status</option>
            <option value="tag">🏷 Tag</option>
          </select>
          <button className="w-7 h-7 rounded-md bg-accent text-white border-none text-lg cursor-pointer flex items-center justify-center hover:bg-accent-hover hover:shadow-[0_0_16px_var(--accent-glow)] hover:rotate-90 hover:scale-110 active:scale-95 transition-all" onClick={() => onNewSession ? onNewSession() : dispatch(switchSlot(null))} title="New chat" aria-label="New chat session">+</button>
        </div>
      </div>
      <div className="px-2 pt-2 pb-1"><SearchInput placeholder="Filter sessions…" value={slotFilter} onChange={e => setSlotFilter(e.target.value)} /></div>
      <div className="flex-1 overflow-y-auto p-2">
        {(() => {
          const filtered = slots.filter(s => !slotFilter || (s.title + s.key + (s.agent || '') + (s.tags || []).join(' ')).toLowerCase().includes(slotFilter.toLowerCase()))
          const groups = slotsGroupMode === 'status'
            ? groupByStatus(filtered)
            : slotsGroupMode === 'date'
            ? groupByDate(filtered)
            : slotsGroupMode === 'tag'
            ? groupByTag(filtered)
            : groupBy(filtered, s => projectName(s.cwd) || '')
          const needsHeaders = groups.length > 1 || (groups.length === 1 && groups[0].key !== '')
          return groups.map(g => (
            <div key={g.key || '__ungrouped'}>
              {needsHeaders && <div className="text-[11px] text-muted font-semibold uppercase tracking-wider px-2 pt-2 pb-1 flex items-center gap-1.5 cursor-pointer select-none hover:text-text transition-colors" onClick={() => toggleGroup(g.key || '__ungrouped')}><span className={`text-[10px] transition-transform ${collapsedGroups.has(g.key || '__ungrouped') ? '' : 'rotate-90'}`}>▶</span>{g.key || 'Other'}<span className="text-[10px] opacity-50 font-mono">{g.items.length}</span></div>}
              {!collapsedGroups.has(g.key || '__ungrouped') && g.items.map(s => {
                const agentName = 'pi'
                const agentColor = 'text-accent'
                const needsAttention = s.pending_approval && !s.stopping
                const isIdle = !s.running && !s.stopping && !s.pending_approval
                const hasUnread = unreadSlots.includes(s.key)
                return (
                  <div key={s.key}>
                  <div className={`pidash-slot-item group flex items-start gap-2.5 px-2.5 py-2 rounded-md cursor-pointer text-sm transition-all mb-0.5 border animate-slide-in-left ${needsAttention ? 'bg-warn-subtle border-warn/40 text-text-strong shadow-[0_0_12px_rgba(245,158,11,.15)]' : activeSlot === s.key ? 'text-text-strong bg-accent-subtle border-accent-subtle' : 'text-muted hover:text-text hover:bg-bg-hover border-transparent'}`}
                    data-pidash-slot-status={needsAttention ? 'attention' : s.running ? 'busy' : 'idle'}
                    role="button"
                    tabIndex={0}
                    onMouseDown={(e) => { e.preventDefault(); if ((e.target as HTMLElement).dataset.close) { dispatch(deleteSlot(s.key)); return }; dispatch(switchSlot(s.key)) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatch(switchSlot(s.key)) } }}>
                    {needsAttention ? <span className="w-2 h-2 rounded-full bg-warn shrink-0 shadow-[0_0_8px_rgba(245,158,11,.5)] animate-dot-breathe self-center" /> : unreadSlots.includes(s.key) ? <span className="w-2 h-2 rounded-full bg-[var(--info)] shrink-0 shadow-[0_0_6px_rgba(59,130,246,.4)] animate-dot-breathe self-center" /> : <span className="w-2 shrink-0" />}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className={`text-[11px] font-semibold truncate leading-tight flex items-center gap-1 ${agentColor}`}>
                      {agentName}
                      {needsAttention ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-[2px] rounded-full text-[10px] font-bold bg-warn text-white animate-pulse" title="Waiting for approval">⚠ Needs input</span>
                      ) : s.stopping ? (
                        <span className="inline-flex items-center gap-0.5 px-1 py-[1px] rounded-full text-[10px] font-bold bg-danger-subtle text-danger border border-danger/30" title="Stopping">■</span>
                      ) : s.running ? (
                        <span className="typing-dots-sm"><span /><span /><span /></span>
                      ) : isIdle && !hasUnread ? (
                        <span className="inline-flex items-center px-1 py-[1px] rounded-full text-[10px] text-muted/50">idle</span>
                      ) : null}
                    </div>
                      <div className="overflow-x-auto" title={s.title !== s.key ? s.title : s.key}>
                        <TypewriterText className="whitespace-nowrap font-mono text-[13px]" text={s.title !== s.key ? s.title : s.key} />
                      </div>
                      {s.tags && s.tags.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-0.5">
                          {s.tags.map(tag => (
                            <span key={tag} className="px-1.5 py-[1px] rounded-full text-[10px] font-semibold bg-accent/15 text-accent border border-accent/25 leading-tight">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {s.workspace && s.workspace !== 'default' && <span className="px-1.5 py-[2px] rounded-full text-[11px] font-bold bg-ok-subtle text-ok border border-ok/30 shrink-0 max-w-[60px] overflow-hidden text-ellipsis whitespace-nowrap self-center" title={`workspace: ${s.workspace}`}>{s.workspace}</span>}
                    {s.cwd && onNewSessionInCwd && <span className="opacity-0 text-[12px] text-muted cursor-pointer px-[3px] py-[2px] rounded hover:opacity-100 hover:text-accent hover:bg-accent-subtle group-hover:opacity-50 transition-all self-center" title={`New session in ${s.cwd}`} onClick={e => { e.stopPropagation(); onNewSessionInCwd(s.cwd!) }}>+</span>}
                    <span className="opacity-0 text-[12px] text-muted cursor-pointer px-[3px] py-[2px] rounded hover:opacity-100 hover:text-accent hover:bg-accent-subtle group-hover:opacity-50 transition-all self-center" title="Edit tags" onClick={e => { e.stopPropagation(); e.preventDefault(); setEditingTagsSlot(editingTagsSlot === s.key ? null : s.key); setTagInput(''); setTimeout(() => tagInputRef.current?.focus(), 50) }}>🏷</span>
                    <span data-close="1" className="opacity-0 text-[12px] text-muted cursor-pointer px-[5px] py-[2px] rounded hover:opacity-100 hover:text-danger hover:bg-danger-subtle group-hover:opacity-50 transition-all self-center">✕</span>
                  </div>
                  {editingTagsSlot === s.key && (
                    <div className="px-2.5 pb-2 pt-0.5 flex flex-wrap items-center gap-1 animate-slide-in-left" onClick={e => e.stopPropagation()}>
                      {(s.tags || []).map(tag => (
                        <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[10px] font-semibold bg-accent/15 text-accent border border-accent/25">
                          {tag}
                          <span className="cursor-pointer hover:text-danger ml-0.5" onClick={() => { api.tagSlot(s.key, (s.tags || []).filter(t => t !== tag)) }}>×</span>
                        </span>
                      ))}
                      <input
                        ref={editingTagsSlot === s.key ? tagInputRef : undefined}
                        className="bg-transparent border border-border rounded-md px-1.5 py-[2px] text-[11px] text-text w-20 outline-none focus:border-accent"
                        placeholder="add tag…"
                        value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onBlur={() => { setTimeout(() => { setEditingTagsSlot(null); setTagInput('') }, 150) }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && tagInput.trim()) {
                            e.preventDefault()
                            const newTag = tagInput.trim().toLowerCase()
                            const current = s.tags || []
                            if (!current.includes(newTag)) {
                              api.tagSlot(s.key, [...current, newTag])
                            }
                            setTagInput('')
                            setEditingTagsSlot(null)
                          } else if (e.key === 'Escape') {
                            setEditingTagsSlot(null)
                            setTagInput('')
                          } else if (e.key === 'Backspace' && !tagInput && s.tags?.length) {
                            api.tagSlot(s.key, s.tags.slice(0, -1))
                          }
                        }}
                      />
                    </div>
                  )}
                  </div>
                )
              })}
            </div>
          ))
        })()}
      </div>



    </div>
    </>
  )
}

export default memo(ChatSidebar)
