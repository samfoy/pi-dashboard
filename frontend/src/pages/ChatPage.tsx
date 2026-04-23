import { useState, useRef, useCallback, useEffect, useMemo, useContext, lazy, Suspense } from 'react'

import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAppSelector, useAppDispatch } from '../store'
import {
  switchSlot, createSlot, deleteSlot, fetchHistory,
  loadOlderMessages, appendMessage,
  setSlotRunning, setSlotStopping, setPendingInput, clearResendQueued, promoteQueued,
} from '../store/chatSlice'
import { sseSlotTitle } from '../store/dashboardSlice'
import { api } from '../api/client'
import { recordDirUsage, migratePinnedDirs } from '../store/dirFrequency'
import TypewriterText from '../components/TypewriterText'
const DocumentPanel = lazy(() => import('../components/DocumentPanel'))
import FileBrowser from '../components/FileBrowser'
import ReferencedFiles from '../components/ReferencedFiles'
import { useReferencedFiles } from '../hooks/useReferencedFiles'
import WelcomeView from '../components/WelcomeView'
import SlashCommandMenu from '../components/SlashCommandMenu'
import PathCompleteMenu from '../components/PathCompleteMenu'
import { usePanelState, detectFileType } from '../hooks/usePanelState'
import { WsContext } from '../App'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { ChatFooter, AssistantMessage, ToolGroup, groupToolMessages, ThinkingBlock, ToolCallBlock, PermissionMessage, SystemMessage } from './chat'
import ChatSidebar from './ChatSidebar'

import ChatSettings, { loadChatConfig, type ChatConfig } from './chat/ChatSettings'
import ContextBar from './chat/ContextBar'
import SessionTree from './chat/SessionTree'
import TerminalPage from './TerminalPage'
import MessageSearch from './chat/MessageSearch'
import SessionCostBar from './chat/SessionCostBar'
import SplitPane from './chat/SplitPane'
import type { ChatMessage } from '../types'





export default function ChatPage() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const slots = useAppSelector(s => s.dashboard.slots)
  const unreadSlots = useAppSelector(s => s.dashboard.unreadSlots)
  const refreshTrigger = useAppSelector(s => s.dashboard.refreshTrigger)
  const activeSlot = useAppSelector(s => s.chat.activeSlot)
  const messages = useAppSelector(s => s.chat.messages)
  const slotRunning = useAppSelector(s => s.chat.slotRunning)
  const slotStopping = useAppSelector(s => s.chat.slotStopping)
  const slotState = useAppSelector(s => s.chat.slotState)
  const slotSwitching = useAppSelector(s => s.chat.slotSwitching)
  const tokenStats = useAppSelector(s => s.chat.tokenStats)
  const contextUsage = useAppSelector(s => s.chat.contextUsage)
  const extensionStatuses = useAppSelector(s => s.chat.extensionStatuses)
  const pendingApproval = useAppSelector(s => { const slot = s.dashboard.slots.find(sl => sl.key === s.chat.activeSlot); return slot?.pending_approval ?? false })
  const slotHasMore = useAppSelector(s => s.chat.slotHasMore)
  const slotOldestIndex = useAppSelector(s => s.chat.slotOldestIndex)

  // Per-slot input state: store draft text per slot key
  const slotInputsRef = useRef<Map<string, string>>(new Map())
  const [input, setInputRaw] = useState('')
  const setInput = useCallback((v: string | ((prev: string) => string)) => {
    setInputRaw(prev => {
      const next = typeof v === 'function' ? v(prev) : v
      if (activeSlot) slotInputsRef.current.set(activeSlot, next)
      return next
    })
  }, [activeSlot])
  const [pendingImages, setPendingImages] = useState<{data: string; mimeType: string; preview: string}[]>([])
  const pendingInput = useAppSelector(s => s.chat.pendingInput)

  const [chatConfig, setChatConfig] = useState<ChatConfig>(loadChatConfig)
  const [showTerminal, setShowTerminal] = useState(false)
  const [showTree, setShowTree] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [showRefs, setShowRefs] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [splitSlot, setSplitSlot] = useState<string | null>(null)
  const [showSplitPicker, setShowSplitPicker] = useState(false)


  
  const [availableModels, setAvailableModels] = useState<{id: string; name: string; provider: string; contextWindow?: number}[]>([])
  const [pendingModel, setPendingModel] = useState('')  // agent for next new slot
  const [pendingCwd, setPendingCwd] = useState('')
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Migrate old pinned dirs to frequency store (one-time)
  useEffect(() => { migratePinnedDirs() }, [])

  const [prefillHint, setPrefillHint] = useState(false)
  const wantsNewSession = useRef(false)

  // Consume pendingInput from Redux (e.g. from "Optimize in Chat" on Tasks page)
  useEffect(() => {
    if (pendingInput) {
      setInput(pendingInput)
      dispatch(setPendingInput(null))
      if (searchParams.get('prefill')) setSearchParams({}, { replace: true })
      setPrefillHint(true)
      setTimeout(() => {
        if (inputRef.current) { inputRef.current.style.height = 'auto'; inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 320) + 'px'; inputRef.current.focus() }
      }, 100)
    }
  }, [pendingInput, dispatch, searchParams, setSearchParams])

  // Handle newCwd query param (from command palette)
  useEffect(() => {
    const cwd = searchParams.get('newCwd')
    if (cwd) {
      setSearchParams({}, { replace: true })
      setPendingCwd(cwd)
      wantsNewSession.current = true
      dispatch(switchSlot(null))
    }
  }, [searchParams, setSearchParams, dispatch])

  // Re-send queued message after abort
  const resendQueued = useAppSelector(s => s.chat._resendQueued)
  useEffect(() => {
    if (resendQueued && activeSlot) {
      dispatch(clearResendQueued())
      fetch('/api/chat?ws=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: resendQueued, slot: activeSlot }),
      }).catch(() => {})
    }
  }, [resendQueued, activeSlot, dispatch])
  // Restore per-slot input on tab switch
  const prevActiveSlotInput = useRef<string | null>(null)
  useEffect(() => {
    if (activeSlot && activeSlot !== prevActiveSlotInput.current) {
      prevActiveSlotInput.current = activeSlot
      const saved = slotInputsRef.current.get(activeSlot) ?? ''
      setInputRaw(saved)
      if (inputRef.current) {
        inputRef.current.style.height = 'auto'
        if (saved) inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 140) + 'px'
      }
      // Restore per-slot panel state
      panel.switchToSlot(activeSlot)
      // Focus input on session switch (desktop only — avoid keyboard pop on mobile)
      if (window.innerWidth >= 768) {
        setTimeout(() => inputRef.current?.focus(), 100)
      }
    }
  }, [activeSlot])
  useEffect(() => { if (inputRef.current && input) { inputRef.current.style.height = 'auto'; inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 140) + 'px' } }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-only auto-size
  const [availableWorkspaces, setAvailableWorkspaces] = useState<{name: string; path: string; is_default: boolean}[]>([])

  // Load installed agents (refresh on AIM changes)
  useEffect(() => { api.models().then(d => setAvailableModels(d.models || [])).catch(() => {}) }, [])
  // Load default agent
  // Load available workspaces
  useEffect(() => { api.workspaces().then(d => setAvailableWorkspaces(d.workspaces || [])).catch(() => {}) }, [refreshTrigger])

  // Prevent Chrome from navigating to dropped files.
  // Must be on document to catch drops anywhere on the page.
  useEffect(() => {
    const preventNav = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
    document.addEventListener('dragover', preventNav)
    document.addEventListener('drop', preventNav)
    return () => {
      document.removeEventListener('dragover', preventNav)
      document.removeEventListener('drop', preventNav)
    }
  }, [])

  const [dragOver, setDragOver] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(true)
  const [cursorPos, setCursorPos] = useState(0)
  const [pathMenuOpen, setPathMenuOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const isMac = useAppSelector(s => s.dashboard.status?.platform) === 'darwin'

  const panel = usePanelState()
  const { subscribeFileChange, wsRef } = useContext(WsContext)

  // Register file change callback (mirrors LogsPage subscribeLogs pattern)
  useEffect(() => {
    subscribeFileChange((data) => {
      if (!data || data.deleted) return
      if (data.path !== panel.filePath) return
      if (!panel.dirty) {
        panel.setContent(data.content ?? '')
        // Refresh version list on live update
        fetch('/api/file-versions?path=' + encodeURIComponent(panel.filePath))
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.versions) panel.setVersions(d.versions) })
          .catch(() => {})
      } else {
        panel.setConflictContent(data.content ?? '')
      }
    })
    return () => subscribeFileChange(null)
  }, [subscribeFileChange, panel.filePath, panel.dirty, panel.isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Watch/unwatch on panel open/close
  useEffect(() => {
    if (panel.isOpen && panel.filePath && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'watch_file', path: panel.filePath }))
      const ws = wsRef.current
      return () => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'unwatch_file', path: panel.filePath }))
        }
      }
    }
  }, [panel.isOpen, panel.filePath, wsRef])

  const handleFileOpen = useCallback(async (filePath: string) => {
    try {
      const ft = detectFileType(filePath)
      let text = ''
      if (ft === 'text') {
        const res = await fetch('/api/file-read?path=' + encodeURIComponent(filePath))
        text = res.ok ? await res.text() : `_Error: ${res.status}_`
      }
      panel.openPanel(filePath, text)
      // Fetch versions on open
      fetch('/api/file-versions?path=' + encodeURIComponent(filePath))
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.versions) panel.setVersions(d.versions) })
        .catch(() => {})
      // Fetch comments on open
      fetch('/api/file-comments?path=' + encodeURIComponent(filePath))
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.comments) panel.setComments(d.comments) })
        .catch(() => {})
    } catch { panel.openPanel(filePath, '_Error reading file_') }
  }, [panel.openPanel]) // eslint-disable-line react-hooks/exhaustive-deps -- panel.openPanel is stable

  const handleContentChange = useCallback((c: string) => { panel.setContent(c); panel.setDirty(true) }, [panel.setContent, panel.setDirty])

  const handleFileSave = useCallback(async (filePath: string, content: string) => {
    const res = await fetch('/api/file-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content }),
    })
    if (!res.ok) throw new Error(`Save failed: ${res.status}`)
    panel.setDirty(false)
    // Refresh version list after save
    fetch('/api/file-versions?path=' + encodeURIComponent(filePath))
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.versions) panel.setVersions(d.versions) })
      .catch(() => {})
  }, [panel.setDirty]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveComments = useCallback((comments: import('../hooks/usePanelState').Comment[]) => {
    if (!panel.filePath) return
    panel.setComments(comments)
    fetch('/api/file-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: panel.filePath, comments }),
    }).catch(() => {})
  }, [panel.filePath, panel.setComments])

  const handleAddComment = useCallback((startLine: number, endLine: number, content: string) => {
    const comment: import('../hooks/usePanelState').Comment = {
      id: crypto.randomUUID(),
      startLine, endLine, content,
      version: panel.versions.length > 0 ? panel.versions[panel.versions.length - 1].version : 1,
      createdAt: new Date().toISOString(),
    }
    saveComments([...panel.comments, comment])
  }, [panel.versions, panel.comments, saveComments])

  const handleEditComment = useCallback((id: string, content: string) => {
    saveComments(panel.comments.map(c => c.id === id ? { ...c, content } : c))
  }, [panel.comments, saveComments])

  const handleDeleteComment = useCallback((id: string) => {
    saveComments(panel.comments.filter(c => c.id !== id))
  }, [panel.comments, saveComments])

  const pickFiles = useCallback(async () => {
    setUploading(true)
    try {
      const { paths } = await api.pickFiles()
      if (paths?.length) {
        setInput(prev => (prev ? prev + '\n' : '') + paths.join('\n'))
        inputRef.current?.focus()
      }
    } catch { /* user cancelled */ }
    setUploading(false)
  }, [])

  const takeScreenshot = useCallback(async () => {
    setUploading(true)
    try {
      const { path } = await api.screenshot()
      if (path) {
        setInput(prev => (prev ? prev + '\n' : '') + path)
        inputRef.current?.focus()
      }
    } catch { /* user cancelled */ }
    setUploading(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    const names = Array.from(e.dataTransfer.files).map(f => f.name)
    if (names.length) {
      setInput(prev => (prev ? prev + '\n' : '') + names.join('\n'))
      inputRef.current?.focus()
    }
  }, [])

  const scrollBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'auto', align: 'end' })
  }, [])

  // Sticky-bottom scroll state
  const [isAtBottom, setIsAtBottom] = useState(true)
  const isAtBottomRef = useRef(true)
  const handleAtBottom = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom)
    isAtBottomRef.current = atBottom
  }, [])

  // followOutput: only auto-scroll when pinned to bottom
  const followOutput = useCallback((isAtBottom: boolean) => {
    return isAtBottom ? 'smooth' : false
  }, [])

  useEffect(() => { dispatch(fetchHistory(false)) }, [dispatch])
  // Persist active slot to localStorage for refresh recovery
  useEffect(() => { if (activeSlot) { localStorage.setItem('mc-active-slot', activeSlot); wantsNewSession.current = false } }, [activeSlot])
  // Re-fetch slot messages on mount (handles nav away + back)
  useEffect(() => { if (activeSlot) dispatch(switchSlot(activeSlot)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Auto-select slot after refresh — restore from localStorage or pick first
  useEffect(() => {
    if (activeSlot || slots.length === 0 || wantsNewSession.current) return
    const saved = localStorage.getItem('mc-active-slot')
    const target = saved && slots.find(s => s.key === saved) ? saved : slots[0].key
    dispatch(switchSlot(target))
  }, [activeSlot, slots, dispatch])

  // Scroll to bottom on tab switch or new messages
  const prevSlotRef = useRef<string | null>(null)
  useEffect(() => {
    if (activeSlot !== prevSlotRef.current) {
      prevSlotRef.current = activeSlot
      setIsAtBottom(true)
      isAtBottomRef.current = true
    }
  }, [activeSlot, messages.length, scrollBottom])

  // Auto-scroll during streaming — only when pinned to bottom
  const lastMsg = messages[messages.length - 1]
  const isStreaming = lastMsg?.role === 'streaming'
  const referencedFiles = useReferencedFiles(messages)

  const planTaskId = useMemo(() => {
    for (const m of messages) {
      const match = m.content?.match(/<!-- plan_task_id:(\S+) -->/)
      if (match) return match[1]
    }
    return ''
  }, [messages])
  useEffect(() => {
    if (isStreaming && isAtBottomRef.current) scrollBottom()
  }, [isStreaming, lastMsg?.content, scrollBottom])

  // Scroll to show Footer when agent starts running (loading indicator appears)
  const prevRunningRef = useRef(false)
  useEffect(() => {
    if (slotRunning && !prevRunningRef.current && isAtBottomRef.current) {
      setTimeout(() => scrollBottom(), 50)
    }
    prevRunningRef.current = slotRunning
  }, [slotRunning, scrollBottom])

  // Sync slotRunning from WS slot updates.
  useEffect(() => {
    if (!activeSlot) return
    const s = slots.find(s => s.key === activeSlot)
    if (!s) return
    dispatch(setSlotRunning(s.running))
    dispatch(setSlotStopping(s.stopping ?? false))
  }, [slots, activeSlot, dispatch])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          const base64 = dataUrl.split(',')[1]
          const mimeType = file.type
          setPendingImages(prev => [...prev, { data: base64, mimeType, preview: dataUrl }])
        }
        reader.readAsDataURL(file)
      }
    }
  }, [])

  const removeImage = useCallback((idx: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const send = useCallback(async (optionText?: string) => {
    const txt = (optionText || input).trim()
    const images = pendingImages.map(img => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType }))
    if (!txt && images.length === 0) return
    const isSlashCmd = txt.startsWith('/')
    // Handle /new and /clear client-side — they create a new session, not send to pi
    if (txt === '/new' || txt === '/clear') {
      if (!optionText) setInput('')
      wantsNewSession.current = true
      dispatch(switchSlot(null))
      return
    }
    setPrefillHint(false)
    let slot = activeSlot
    if (!slot) {
      wantsNewSession.current = false
      const result = await dispatch(createSlot({ model: pendingModel || undefined, cwd: pendingCwd || undefined })).unwrap()
      if (pendingCwd) recordDirUsage(pendingCwd)
      slot = result.key
    }
    if (!optionText) setInput('')
    setPendingImages([])
    if (inputRef.current) inputRef.current.style.height = 'auto'
    if (!isSlashCmd) {
      // Show user message with image previews (skip for slash commands)
      const imageMarkdown = pendingImages.map(img => `![image](${img.preview})`).join('\n')
      const displayContent = imageMarkdown ? (txt ? `${imageMarkdown}\n\n${txt}` : imageMarkdown) : txt
      const isQueued = slotRunning
      dispatch(appendMessage({ role: isQueued ? 'queued' : 'user', content: displayContent, cls: '', ts: new Date().toISOString() }))
      setIsAtBottom(true)
      isAtBottomRef.current = true
      scrollBottom()
      dispatch(setSlotRunning(true))
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const r = await fetch('/api/chat?ws=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: txt || 'What is in this image?', slot, images: images.length > 0 ? images : undefined }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      const body = await r.json().catch(() => ({}))
      if (body.ok) dispatch(promoteQueued())
      // If queued, the WS will handle the rest
      if (!body.queued && !body.ok) {
        dispatch(setSlotRunning(false))
        dispatch(appendMessage({ role: 'error', content: body.error || 'Send failed', cls: '' }))
      }
      // Chunks arrive via WS chat_chunk events, done via chat_done
    } catch (e: unknown) {
      clearTimeout(timeout)
      if (e instanceof DOMException && e.name === 'AbortError') {
        // Timeout — session is likely still starting.  Don't show error;
        // the message was received by the server and will be processed
        // once the pi session is ready.  WS will deliver the response.
      } else {
        dispatch(setSlotRunning(false))
        dispatch(appendMessage({ role: 'error', content: 'Connection error', cls: '' }))
      }
    }
    inputRef.current?.focus()
  }, [input, pendingImages, pendingModel, pendingCwd, activeSlot, dispatch, scrollBottom])

  const approve = useCallback(async (action: string) => { if (activeSlot) await api.approveChatSlot(activeSlot, action) }, [activeSlot])

  const handleReviewComments = useCallback(() => {
    if (!panel.filePath || panel.comments.length === 0) return
    const currentVersion = panel.selectedVersion ?? (panel.versions.length > 0 ? panel.versions[panel.versions.length - 1]?.version ?? 1 : 1)
    const filtered = panel.comments.filter(c => c.version === currentVersion)
    if (filtered.length === 0) return
    const lines = filtered.map(c => {
      const lineRef = c.startLine === c.endLine ? `Line ${c.startLine}` : `Lines ${c.startLine}-${c.endLine}`
      return `${lineRef}: ${c.content}`
    })
    const msg = `Please review and address the comments in ${panel.filePath}:\n\n${lines.join('\n')}`
    send(msg)
    // Clear comments after sending so the next review cycle starts fresh
    panel.setComments([])
    fetch('/api/file-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: panel.filePath, comments: [] })
    }).catch(() => {})
  }, [panel.filePath, panel.comments, panel.selectedVersion, panel.versions, send])

  // Chat keyboard shortcuts
  useKeyboardShortcuts(useMemo(() => [
    { key: 'n', ctrl: true, label: 'New session', action: () => { wantsNewSession.current = true; dispatch(switchSlot(null)) } },
    { key: 'l', ctrl: true, label: 'Focus input', action: () => inputRef.current?.focus() },
    { key: 'f', ctrl: true, label: 'Search messages', action: () => setShowSearch(s => !s) },
    { key: 'Escape', label: 'Stop / Close search', action: () => { if (showSearch) setShowSearch(false); else if (activeSlot && slotRunning) api.stopChatSlot(activeSlot) } },
    { key: 'w', ctrl: true, label: 'Close session', action: () => { if (activeSlot) dispatch(deleteSlot(activeSlot)) } },
  ], [activeSlot, slotRunning, showSearch, dispatch]))

  // Clear split pane if the slot was deleted
  useEffect(() => {
    if (splitSlot && !slots.some(s => s.key === splitSlot)) setSplitSlot(null)
  }, [slots, splitSlot])

  const loadingOlder = useAppSelector(s => s.chat.loadingOlder)

  const currentSlot = slots.find(s => s.key === activeSlot)
  const title = currentSlot ? (currentSlot.title !== currentSlot.key ? currentSlot.title : currentSlot.key) : ''
  const [editingHeader, setEditingHeader] = useState(false)
  const [editingTitle, setEditingTitle] = useState('')
  const cancelEditRef = useRef(false)

  const lastRole = messages[messages.length - 1]?.role ?? ''
  const virtuosoComponents = useMemo(() => ({
    Header: () => slotHasMore && slotOldestIndex > 0 ? (
      <div className="text-center py-2.5 px-5">
        {loadingOlder ? <span className="text-muted text-[13px]">Loading…</span> : <span className="text-muted text-[13px] opacity-40">scroll up for more</span>}
      </div>
    ) : null,
    Footer: () => <ChatFooter running={slotRunning} stopping={slotStopping} state={slotState} lastRole={lastRole} />,
  }), [slotRunning, slotStopping, slotState, slotHasMore, slotOldestIndex, loadingOlder, lastRole])

  // Group consecutive tool messages for collapsible rendering
  const groupedMessages = useMemo(() => groupToolMessages(messages), [messages])

  const renderMessage = useCallback((i: number, m: ChatMessage) => {
    const key = m.ts ? `${m.role}-${m.ts}` : `${m.role}-${i}`
    if (m.role === 'thinking') return <ThinkingBlock key={key} content={m.content} />
    if (m.role === 'tool') return <ToolCallBlock key={key} content={m.content} meta={m.meta} onFileOpen={handleFileOpen} />
    if (m.role === 'queued') return <div key={key} className="bg-warn-subtle border border-warn/15 rounded-md px-3 py-2 text-[13px] text-warn italic animate-scale-in">⏳ <em>Queued:</em> {m.content}</div>
    if (m.role === 'error') return <div key={key} className="bg-danger-subtle text-danger text-[13px] px-3 py-2 rounded-md border border-danger/15 self-center animate-scale-in">{m.content}</div>
    if (m.role === 'system') return <SystemMessage key={key} content={m.content} meta={m.meta} />
    if (m.role === 'permission') {
      const isLast = i === messages.map(x => x.role).lastIndexOf('permission')
      const showButtons = isLast && (pendingApproval || slotRunning)
      const toolInput = (m.meta?.tool_input as string) || ''
      return (
      <PermissionMessage key={key} title={m.content} toolInput={toolInput} showButtons={showButtons} onApprove={approve} />
    )}
    const isUser = m.role === 'user'
    const isStreaming = m.role === 'streaming'
    const msgTime = m.ts ? new Date(m.ts).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
    return (
      <div key={key} className={`pidash-msg-card flex gap-3 items-start mb-3 mr-4 ${isUser ? 'flex-row-reverse animate-slide-in-right' : 'animate-slide-up'}`} data-pidash-sender={isUser ? 'user' : 'assistant'} data-pidash-streaming={isStreaming ? 'true' : undefined}>
        {isUser
          ? <div className="w-8 h-8 rounded-md grid place-items-center font-semibold text-sm shrink-0 self-end mb-0.5 bg-accent-subtle text-accent">U</div>
          : <img src="/logo.png" alt="Pi Dashboard" className="w-8 h-8 rounded-md shrink-0 self-end mb-0.5 object-cover" />
        }
        <div className={`flex flex-col gap-0.5 max-w-[min(820px,calc(100%-56px))] ${isUser ? 'items-end' : ''} group/msg relative`}>
          {isUser ? (
            <div className="pidash-msg-content msg-content px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap rounded-lg bg-accent text-white rounded-br-[4px] overflow-hidden select-text" style={{ overflowWrap: 'anywhere' }}>
              {m.content.split('\n').map((line, li) => {
                const imgMatch = line.match(/^!\[image\]\((data:image\/[^)]+)\)$/)
                if (imgMatch) {
                  const dataUrl = imgMatch[1]
                  return (
                    <span key={li} className="relative inline-block group/img">
                      <img src={dataUrl} alt="Pasted" className="max-h-48 rounded-md my-1" />
                      <button className="absolute top-2 right-2 opacity-0 group-hover/img:opacity-100 bg-black/60 hover:bg-black/80 text-white text-[11px] px-2 py-1 rounded cursor-pointer border-none transition-opacity" title="Save image to disk" onClick={async (e) => {
                        e.stopPropagation()
                        const name = prompt('Save image as:', `screenshot-${Date.now()}.png`)
                        if (!name) return
                        const base64 = dataUrl.split(',')[1]
                        const mime = dataUrl.match(/^data:([^;]+)/)?.[1] || 'image/png'
                        try {
                          await api.saveImage(base64, mime, name.startsWith('/') || name.startsWith('~') ? name : `~/${name}`)
                        } catch (err: any) { alert(err.message || 'Save failed') }
                      }}>💾 Save</button>
                    </span>
                  )
                }
                return <span key={li}>{li > 0 && '\n'}{line}</span>
              })}
            </div>
          ) : (
            <AssistantMessage content={m.content} isStreaming={isStreaming} slotRunning={slotRunning} onOption={send} onFileOpen={handleFileOpen} planTaskId={planTaskId} onApplyPlan={async (steps: any[]) => {
              const r = await api.planFromChat(steps, planTaskId)
              if (r.ok) navigate('/tasks?applied=' + (r.task_id || planTaskId))
              else alert(r.error || 'Failed to apply plan')
            }} />
          )}
          <div className="flex items-center gap-1 px-1">
            {chatConfig.showTimestamps && msgTime && <span className="text-muted text-[12px] font-mono">{msgTime}</span>}
            <button className="opacity-0 group-hover/msg:opacity-100 text-[11px] text-muted hover:text-text cursor-pointer bg-transparent border-none transition-opacity px-1" title="Copy" onClick={() => { navigator.clipboard.writeText(m.content); }}>📋</button>
          </div>
        </div>
      </div>
    )
  }, [messages, pendingApproval, slotRunning, approve, send, handleFileOpen, chatConfig, navigate, planTaskId])

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('mc-chat-sidebar') === '1')

  return (
    <div className="flex flex-1 min-h-0 h-full">
      {!sidebarCollapsed && <ChatSidebar
        slots={slots}
        activeSlot={activeSlot}
        unreadSlots={unreadSlots}
        onNewSessionInCwd={(cwd) => { setPendingCwd(cwd); wantsNewSession.current = true; dispatch(switchSlot(null)); setMobileSidebarOpen(false) }}
        onNewSession={() => { wantsNewSession.current = true; dispatch(switchSlot(null)); setMobileSidebarOpen(false) }}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />}

      {/* Chat pane */}
      <div className={`flex flex-col bg-bg min-w-0 ${splitSlot ? 'flex-[1_1_50%] max-w-[50%]' : panel.isOpen ? 'flex-[1_1_60%]' : 'flex-1'}`} style={{ transition: 'flex 0.2s' }}>
        {!activeSlot ? (
          <WelcomeView
            input={input}
            setInput={setInput}
            send={() => send()}
            models={availableModels}
            selectedModel={pendingModel}
            onSelectModel={setPendingModel}
            workspaces={availableWorkspaces}
            selectedCwd={pendingCwd}
            onSelectCwd={setPendingCwd}
            prefillHint={prefillHint}
            onDismissHint={() => setPrefillHint(false)}
            pendingImages={pendingImages}
            onPaste={handlePaste}
            onRemoveImage={removeImage}
            inputRef={inputRef}
          />
        ) : (
          <>
            <div className="px-3 md:px-5 py-2 md:py-2.5 border-b border-border flex justify-between items-center bg-chrome gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {/* Sidebar toggle (desktop) */}
                <button className="hidden md:flex w-7 h-7 items-center justify-center bg-transparent border-none text-muted cursor-pointer hover:text-text shrink-0 rounded-md hover:bg-bg-hover transition-colors" onClick={() => setSidebarCollapsed(p => { const next = !p; localStorage.setItem('mc-chat-sidebar', next ? '1' : '0'); return next })} aria-label={sidebarCollapsed ? 'Show sessions' : 'Hide sessions'} title={sidebarCollapsed ? 'Show sessions' : 'Hide sessions'}>
                  <svg viewBox="0 0 24 24" className={`w-4 h-4 stroke-current fill-none transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>
                </button>
                {/* Mobile hamburger */}
                <button className="md:hidden w-8 h-8 flex items-center justify-center bg-transparent border-none text-muted cursor-pointer hover:text-text shrink-0" onClick={() => setMobileSidebarOpen(true)} aria-label="Open sessions">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-current fill-none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
                </button>
                {editingHeader ? (
                  <input className="text-sm font-semibold font-mono bg-transparent border border-accent rounded px-1 py-0 text-text-strong outline-none min-w-[80px] max-w-[200px]" aria-label="Edit session title" autoFocus maxLength={200} value={editingTitle} onChange={e => setEditingTitle(e.target.value)} onBlur={() => { if (!cancelEditRef.current && editingTitle.trim() && editingTitle !== title) { dispatch(sseSlotTitle({ key: activeSlot!, title: editingTitle.trim() })); api.renameSlot(activeSlot!, editingTitle.trim()).catch(() => {}) } cancelEditRef.current = false; setEditingHeader(false) }} onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() } else if (e.key === 'Escape') { cancelEditRef.current = true; setEditingHeader(false) } }} />
                ) : (
                  <TypewriterText className="text-sm font-semibold text-text font-mono truncate" text={title} onDoubleClick={() => { setEditingHeader(true); setEditingTitle(title) }} />
                )}
                {!editingHeader && <span className="hidden md:inline text-[11px] text-muted cursor-pointer opacity-40 hover:opacity-100 hover:text-accent transition-all" title="Rename session" onClick={() => { setEditingHeader(true); setEditingTitle(title) }}>✏️</span>}
                {currentSlot?.model && <span className="hidden md:inline px-2 py-0.5 rounded-md text-[12px] font-mono bg-bg-elevated border border-border text-muted" title="Model">🧠 {currentSlot.model.split('/').pop()}</span>}
                {contextUsage && <span className="hidden md:inline"><ContextBar usage={contextUsage} /></span>}
                {currentSlot?.cwd && <span className="hidden md:inline px-2 py-0.5 rounded-md text-[12px] font-mono bg-bg-elevated border border-border text-muted" title="Working directory">📂 {currentSlot.cwd.split('/').pop()}</span>}
              </div>
              {/* Desktop toolbar */}
              <div className="hidden md:flex gap-1.5 shrink-0">
                {slotRunning && <button className="bg-transparent border border-border text-muted rounded-md px-3 py-[5px] text-[13px] font-medium cursor-pointer hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all font-body" aria-label={slotStopping ? 'Skip queue' : 'Stop generation'} onClick={() => { if (activeSlot) api.stopChatSlot(activeSlot) }}>{slotStopping ? '■ Skip Queue' : '■ Stop'}</button>}
                {/* Panels dropdown — groups Tree, Refs, Files, Terminal */}
                <div className="relative">
                  <button
                    className={`bg-transparent border rounded-md px-3 py-[5px] text-[13px] font-medium cursor-pointer transition-all font-body ${showTree || showRefs || showFiles || showTerminal ? 'border-accent text-accent bg-accent-subtle' : 'border-border text-muted hover:text-text hover:border-border-strong hover:bg-bg-hover'}`}
                    onClick={() => setShowOverflowMenu(v => !v)}
                    aria-label="Toggle panels"
                  >
                    ☰ Panels{(showTree || showRefs || showFiles || showTerminal) ? ' ·' : ''}
                  </button>
                  {showOverflowMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowOverflowMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[180px]">
                        <button className={`w-full text-left px-3 py-2 text-[13px] hover:bg-bg-hover flex items-center gap-2 ${showTree ? 'text-accent' : 'text-text'}`} onClick={() => { setShowTree(t => !t); setShowOverflowMenu(false) }}>🌳 Tree{showTree ? ' ✓' : ''}</button>
                        <button className={`w-full text-left px-3 py-2 text-[13px] hover:bg-bg-hover flex items-center gap-2 ${showRefs ? 'text-accent' : 'text-text'}`} onClick={() => { setShowRefs(t => !t); setShowOverflowMenu(false) }}>📎 Refs{referencedFiles.length > 0 ? ` (${referencedFiles.length})` : ''}{showRefs ? ' ✓' : ''}</button>
                        <button className={`w-full text-left px-3 py-2 text-[13px] hover:bg-bg-hover flex items-center gap-2 ${showFiles ? 'text-accent' : 'text-text'}`} onClick={() => { setShowFiles(t => !t); setShowOverflowMenu(false) }}>📄 Files{showFiles ? ' ✓' : ''}</button>
                        <button className={`w-full text-left px-3 py-2 text-[13px] hover:bg-bg-hover flex items-center gap-2 ${showTerminal ? 'text-accent' : 'text-text'}`} onClick={() => { setShowTerminal(t => !t); setShowOverflowMenu(false) }}>▸_ Terminal{showTerminal ? ' ✓' : ''}</button>
                      </div>
                    </>
                  )}
                </div>
                {/* Split view button + picker */}
                <div className="relative">
                  <button
                    className={`bg-transparent border rounded-md px-3 py-[5px] text-[13px] font-medium cursor-pointer transition-all font-body ${splitSlot ? 'border-accent text-accent bg-accent-subtle' : 'border-border text-muted hover:text-text hover:border-border-strong hover:bg-bg-hover'}`}
                    onClick={() => { if (splitSlot) { setSplitSlot(null) } else { setShowSplitPicker(v => !v) } }}
                    aria-label={splitSlot ? 'Close split view' : 'Split view'}
                    title={splitSlot ? 'Close split view' : 'View another session side-by-side'}
                  >
                    {splitSlot ? '◧ Unsplit' : '◧ Split'}
                  </button>
                  {showSplitPicker && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowSplitPicker(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[220px] max-h-[300px] overflow-y-auto">
                        <div className="px-3 py-1.5 text-[11px] text-muted font-semibold uppercase tracking-wider">Pick session to view</div>
                        {slots.filter(s => s.key !== activeSlot).length === 0 ? (
                          <div className="px-3 py-2 text-[13px] text-muted italic">No other sessions open</div>
                        ) : (
                          slots.filter(s => s.key !== activeSlot).map(s => (
                            <button
                              key={s.key}
                              className="w-full text-left px-3 py-2 text-[13px] hover:bg-bg-hover flex items-center gap-2 text-text"
                              onClick={() => { setSplitSlot(s.key); setShowSplitPicker(false) }}
                            >
                              {s.running && <span className="typing-dots-sm"><span /><span /><span /></span>}
                              <span className="truncate font-mono">{s.title !== s.key ? s.title : s.key}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
                <ChatSettings config={chatConfig} onChange={setChatConfig} activeSlot={activeSlot} currentModel={currentSlot?.model} models={availableModels} />
                <button className="bg-transparent border border-border text-muted rounded-md px-3 py-[5px] text-[13px] font-medium cursor-pointer hover:text-danger hover:border-danger transition-all font-body" aria-label="Close session" onClick={() => { if (activeSlot) dispatch(deleteSlot(activeSlot)) }}>✕</button>
              </div>
              {/* Mobile overflow menu */}
              <div className="md:hidden relative shrink-0">
                {slotRunning && <button className="bg-transparent border border-border text-muted rounded-md px-2 py-1 text-[13px] font-medium cursor-pointer hover:text-text mr-1" onClick={() => { if (activeSlot) api.stopChatSlot(activeSlot) }}>■</button>}
                <button className="bg-transparent border border-border text-muted rounded-md w-8 h-8 text-[16px] cursor-pointer hover:text-text hover:border-border-strong" onClick={() => setShowOverflowMenu(v => !v)}>⋯</button>
                {showOverflowMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowOverflowMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                      <button className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover" onClick={() => { setShowTree(t => !t); setShowOverflowMenu(false) }}>🌳 Tree</button>
                      <button className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover" onClick={() => { setShowRefs(t => !t); setShowOverflowMenu(false) }}>📎 Refs{referencedFiles.length > 0 ? ` (${referencedFiles.length})` : ''}</button>
                      <button className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover" onClick={() => { setShowFiles(t => !t); setShowOverflowMenu(false) }}>📄 Files</button>
                      <button className="w-full text-left px-3 py-2 text-[13px] text-text hover:bg-bg-hover" onClick={() => { setShowTerminal(t => !t); setShowOverflowMenu(false) }}>▸_ Terminal</button>
                      <div className="border-t border-border my-1" />
                      <button className="w-full text-left px-3 py-2 text-[13px] text-danger hover:bg-bg-hover" onClick={() => { if (activeSlot) dispatch(deleteSlot(activeSlot)); setShowOverflowMenu(false) }}>✕ Close Session</button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 flex">
              {/* Tree panel */}
              {showTree && activeSlot && (
                <div className="fixed inset-0 z-30 bg-bg-elevated overflow-hidden flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:relative md:inset-auto md:z-auto md:w-[320px] md:shrink-0 md:border-r md:border-border md:pt-0 md:pb-0">
                  <SessionTree
                    slotKey={activeSlot}
                    onFork={(newSlotKey, text) => { setShowTree(false); dispatch(switchSlot(newSlotKey)); if (text) { setInput(text); setTimeout(() => inputRef.current?.focus(), 100) } }}
                    onClose={() => setShowTree(false)}
                  />
                </div>
              )}
              {showRefs && (
                <div className="fixed inset-0 z-30 bg-bg-elevated overflow-hidden flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:relative md:inset-auto md:z-auto md:w-[320px] md:shrink-0 md:border-r md:border-border md:pt-0 md:pb-0">
                  <ReferencedFiles files={referencedFiles} onFileOpen={handleFileOpen} onClose={() => setShowRefs(false)} />
                </div>
              )}
              {showFiles && (
                <div className="fixed inset-0 z-30 bg-bg-elevated overflow-hidden flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:relative md:inset-auto md:z-auto md:w-[320px] md:shrink-0 md:border-r md:border-border md:pt-0 md:pb-0">
                  <FileBrowser onFileOpen={handleFileOpen} onClose={() => setShowFiles(false)} startPath={currentSlot?.cwd || undefined} />
                </div>
              )}
              <div className="flex-1 min-h-0 flex flex-col" style={{ display: showTerminal ? 'flex' : 'none' }}><TerminalPage /></div>
              {showTerminal ? null : <><div className="flex-1 min-h-0 flex flex-col">
              {showSearch && (
                <MessageSearch
                  messages={messages}
                  onJumpToIndex={(msgIdx) => {
                    // Map message index to grouped messages index for Virtuoso
                    const gIdx = groupedMessages.findIndex(g =>
                      g.type === 'single' ? g.index === msgIdx
                        : g.tools.some(t => t.index === msgIdx)
                    )
                    if (gIdx >= 0) virtuosoRef.current?.scrollToIndex({ index: gIdx, behavior: 'smooth', align: 'center' })
                  }}
                  onClose={() => setShowSearch(false)}
                />
              )}
              {Object.keys(extensionStatuses).length > 0 && (
                <div className="px-4 py-1 bg-accent-subtle text-accent text-[11px] font-medium border-b border-border flex items-center gap-4 shrink-0">
                  {Object.entries(extensionStatuses).map(([key, text]) => (
                    <span key={key} className="opacity-80">{text}</span>
                  ))}
                </div>
              )}
              {slotSwitching && messages.length === 0 ? (
                <div className="flex-1 flex flex-col gap-4 px-5 py-6 animate-pulse">
                  {/* Skeleton: user message */}
                  <div className="flex gap-3 items-start flex-row-reverse">
                    <div className="w-8 h-8 rounded-md bg-bg-elevated shrink-0" />
                    <div className="flex flex-col gap-1.5 items-end max-w-[60%]">
                      <div className="skeleton h-10 w-48 rounded-lg" />
                    </div>
                  </div>
                  {/* Skeleton: tool calls */}
                  <div className="flex gap-3 items-start">
                    <div className="w-8 h-8 rounded-md bg-bg-elevated shrink-0" />
                    <div className="flex flex-col gap-1.5 max-w-[70%] w-full">
                      <div className="skeleton h-8 w-full rounded-md" />
                      <div className="skeleton h-8 w-[85%] rounded-md" />
                    </div>
                  </div>
                  {/* Skeleton: assistant response */}
                  <div className="flex gap-3 items-start">
                    <div className="w-8 h-8 rounded-md bg-bg-elevated shrink-0" />
                    <div className="flex flex-col gap-1.5 max-w-[70%] w-full">
                      <div className="skeleton h-24 w-full rounded-lg" />
                    </div>
                  </div>
                  {/* Skeleton: user message 2 */}
                  <div className="flex gap-3 items-start flex-row-reverse">
                    <div className="w-8 h-8 rounded-md bg-bg-elevated shrink-0" />
                    <div className="flex flex-col gap-1.5 items-end max-w-[60%]">
                      <div className="skeleton h-8 w-36 rounded-lg" />
                    </div>
                  </div>
                  {/* Skeleton: assistant response 2 */}
                  <div className="flex gap-3 items-start">
                    <div className="w-8 h-8 rounded-md bg-bg-elevated shrink-0" />
                    <div className="flex flex-col gap-1.5 max-w-[70%] w-full">
                      <div className="skeleton h-16 w-full rounded-lg" />
                    </div>
                  </div>
                </div>
              ) : (
              <Virtuoso
              key={activeSlot}
              ref={virtuosoRef}
              onTouchStart={() => { if (document.activeElement instanceof HTMLElement && document.activeElement.tagName === 'TEXTAREA') document.activeElement.blur() }}
              style={{ flex: 1, paddingBottom: 24 }}
              data={groupedMessages}
              followOutput={followOutput}
              atBottomThreshold={100}
              atBottomStateChange={handleAtBottom}
              initialTopMostItemIndex={groupedMessages.length - 1}
              atTopStateChange={(atTop) => {
                if (atTop && slotHasMore && slotOldestIndex > 0 && !loadingOlder) {
                  dispatch(loadOlderMessages())
                }
              }}
              components={virtuosoComponents}
              itemContent={(_i, item) => {
                // Add turn separator before user messages (except the first)
                const isUserTurn = item.type === 'single' && item.message.role === 'user' && _i > 0
                return (
                  <div className="px-5 py-2">
                    {isUserTurn && <div className="border-t border-border/40 mb-4 mt-2" />}
                    {item.type === 'group' ? (
                      <ToolGroup tools={item.tools} renderTool={renderMessage} />
                    ) : (
                      renderMessage(item.index, item.message)
                    )}
                  </div>
                )
              }}
            />
            )}
            {!isAtBottom && messages.length > 0 && (
              <div className="flex justify-center py-1.5">
                <button
                  className="px-3 py-1.5 rounded-full bg-accent text-white text-[13px] font-medium shadow-lg cursor-pointer border-none hover:bg-accent-hover transition-all flex items-center gap-1"
                  onClick={() => { setIsAtBottom(true); isAtBottomRef.current = true; scrollBottom() }}
                  aria-label="Scroll to bottom"
                >↓ Bottom</button>
              </div>
            )}
            {tokenStats && <SessionCostBar stats={tokenStats} />}
            {prefillHint && (
              <div className="flex items-center gap-2 px-5 py-2 bg-accent/10 border-t border-accent/30">
                <span className="text-accent text-[13px]">📋 Plan pre-filled below — add your context then press Send</span>
                <button className="text-muted text-[12px] hover:text-text ml-auto" onClick={() => setPrefillHint(false)}>✕</button>
              </div>
            )}
            <div className={`pidash-compose flex flex-col md:flex-row gap-2.5 px-3 md:px-5 pt-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom,0.875rem))] md:pb-3.5 border-t border-border bg-chrome md:items-end transition-colors ${dragOver ? 'bg-accent-subtle border-accent' : ''}`}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
              onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
              onDrop={handleDrop}>
              {isMac && <button className="hidden md:flex w-[44px] h-[44px] rounded-lg border border-border bg-bg-elevated text-muted items-center justify-center shrink-0 cursor-pointer hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all disabled:opacity-30" onClick={pickFiles} disabled={uploading} title="Attach file or folder">
                {uploading ? <span className="text-[13px] animate-pulse">⏳</span> : <span className="text-base">📎</span>}
              </button>}
              {isMac && <button className="hidden md:flex w-[44px] h-[44px] rounded-lg border border-border bg-bg-elevated text-muted items-center justify-center shrink-0 cursor-pointer hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all disabled:opacity-30" onClick={takeScreenshot} disabled={uploading} title="Screenshot (grant Screen Recording to your terminal app in System Settings)">
                <span className="text-base">📷</span>
              </button>}
              <SlashCommandMenu input={input} anchorRef={inputRef as React.RefObject<HTMLElement>} open={slashMenuOpen} onSelect={cmd => { setInput(cmd); setSlashMenuOpen(false) }} onClose={() => setSlashMenuOpen(false)} />
              {pathMenuOpen && <PathCompleteMenu input={input} cursorPos={cursorPos} anchorRef={inputRef as React.RefObject<HTMLElement>} onComplete={(before, completed, after) => { const val = before + completed + after; setInput(val); setPathMenuOpen(true); setTimeout(() => { if (inputRef.current) { const pos = before.length + completed.length; inputRef.current.selectionStart = inputRef.current.selectionEnd = pos; setCursorPos(pos) } }, 0) }} onClose={() => setPathMenuOpen(false)} />}
              <div className="flex-1 flex flex-col gap-1.5">
                {pendingImages.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {pendingImages.map((img, i) => (
                      <div key={i} className="relative group">
                        <img src={img.preview} alt="Pasted" className="h-16 rounded-md border border-border object-cover" />
                        <button className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger text-white text-[11px] border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" onClick={() => removeImage(i)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea ref={inputRef} aria-label="Message input" className={`bg-bg-elevated border border-border rounded-lg px-4 py-3 text-text text-base md:text-sm font-body outline-none min-h-[44px] leading-normal transition-all focus-ring placeholder:text-muted overflow-hidden ${prefillHint ? 'resize-y max-h-[50vh]' : 'resize-none max-h-[140px]'} ${slotStopping ? 'opacity-40 pointer-events-none' : ''}`} placeholder={slotStopping ? 'Stopping…' : pendingImages.length > 0 ? 'Add a message about the image(s)…' : 'Message Pi…'} rows={1} value={input}
                onPaste={handlePaste}
                onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                onDrop={handleDrop}
                onChange={e => { const val = e.target.value; setInput(val); setCursorPos(e.target.selectionStart ?? 0); if (val.startsWith('/')) setSlashMenuOpen(true); else setSlashMenuOpen(false) }}
                onSelect={e => setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                onClick={e => setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                onCompositionStart={() => { (inputRef.current as any).__composing = true }}
                onCompositionEnd={() => { (inputRef.current as any).__composing = true; setTimeout(() => { if (inputRef.current) (inputRef.current as any).__composing = false }, 50) }}
                onKeyDown={e => { if (e.key === 'Tab' && !e.shiftKey && !input.startsWith('/')) { e.preventDefault(); setPathMenuOpen(true); setCursorPos(inputRef.current?.selectionStart ?? 0) } else if (e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented && !e.nativeEvent.isComposing && !(inputRef.current as any)?.__composing) { e.preventDefault(); send() } }}
                onInput={e => { const t = e.target as HTMLTextAreaElement; const cap = prefillHint ? 320 : 140; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, cap) + 'px' }} />
              </div>
              <button className="btn-sweep bg-accent text-white border-none rounded-lg w-full md:w-auto px-5 h-[44px] text-sm font-semibold cursor-pointer hover:bg-accent-hover hover:shadow-[0_0_20px_var(--accent-glow)] disabled:opacity-30 disabled:cursor-not-allowed transition-all font-body" onClick={() => send()} disabled={(!input.trim() && pendingImages.length === 0) || slotStopping}>Send</button>
            </div>
          </div></>}
            </div>
          </>
        )}
      </div>
      {splitSlot && slots.some(s => s.key === splitSlot) && (
        <SplitPane slotKey={splitSlot} onClose={() => setSplitSlot(null)} onFileOpen={handleFileOpen} />
      )}
      {panel.isOpen && (
        <Suspense fallback={<div className="flex-[0_0_40%] border-l border-border bg-bg flex items-center justify-center"><span className="text-muted text-sm">Loading…</span></div>}>
          <DocumentPanel filePath={panel.filePath} content={panel.content} onContentChange={handleContentChange} onSave={handleFileSave} onClose={panel.closePanel} dirty={panel.dirty} versions={panel.versions} selectedVersion={panel.selectedVersion} conflictContent={panel.conflictContent} onSelectVersion={panel.selectVersion} onResolveConflict={panel.resolveConflict} diffMode={panel.diffMode} onToggleDiff={panel.toggleDiffMode} comments={panel.comments} onAddComment={handleAddComment} onEditComment={handleEditComment} onDeleteComment={handleDeleteComment} onReviewComments={handleReviewComments} />
        </Suspense>
      )}
    </div>
  )
}

