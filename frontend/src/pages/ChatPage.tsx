import { useState, useRef, useCallback, useEffect, useMemo, useContext } from 'react'

import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useNavigate, useSearchParams } from 'react-router-dom'
import DiffBlock from '../components/DiffBlock'
import ResizableImage from '../components/ResizableImage'
import { useAppSelector, useAppDispatch } from '../store'
import {
  switchSlot, createSlot, deleteSlot, fetchHistory,
  loadOlderMessages, appendMessage,
  setSlotRunning, setSlotStopping, setPendingInput, clearResendQueued, promoteQueued,
} from '../store/chatSlice'
import { sseSlotTitle } from '../store/dashboardSlice'
import { api } from '../api/client'
import TypewriterText from '../components/TypewriterText'
import DocumentPanel from '../components/DocumentPanel'
import FileBrowser from '../components/FileBrowser'
import ReferencedFiles from '../components/ReferencedFiles'
import { useReferencedFiles } from '../hooks/useReferencedFiles'
import WelcomeView from '../components/WelcomeView'
import SlashCommandMenu from '../components/SlashCommandMenu'
import PathCompleteMenu from '../components/PathCompleteMenu'
import { usePanelState, detectFileType } from '../hooks/usePanelState'
import { WsContext } from '../App'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { ChatFooter, AssistantMessage, ToolGroup, groupToolMessages } from './chat'
import SubagentCard from './chat/SubagentCard'
import ProcessCard from './chat/ProcessCard'
import ChatSidebar from './ChatSidebar'
import NotificationViewer from './NotificationViewer'
import ChatSettings, { loadChatConfig, type ChatConfig } from './chat/ChatSettings'
import ContextBar from './chat/ContextBar'
import SessionTree from './chat/SessionTree'
import TerminalPage from './TerminalPage'
import type { Notification, ChatMessage } from '../types'

/** Expandable thinking block */
function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!content || content.trim() === '') {
    return <div className="msg-content bg-card border border-border rounded-md px-3 py-2 text-[13px] text-muted font-mono animate-scale-in italic flex items-center gap-2"><span className="inline-block w-3.5 h-3.5 border-2 border-muted/30 border-t-accent rounded-full animate-spin" />Thinking…</div>
  }
  return (
    <div className="msg-content bg-card border border-border border-l-[3px] border-l-[#a78bfa] rounded-md animate-scale-in">
      <button className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-muted font-mono cursor-pointer bg-transparent border-none text-left hover:text-text transition-colors" onClick={() => setExpanded(!expanded)}>
        <span className={`text-[11px] transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <span>💭 Thinking</span>
        <span className="text-[12px] text-muted/60 ml-auto">{content.length.toLocaleString()} chars</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border">
          <pre className="text-[13px] text-muted leading-relaxed whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto mt-2 font-body">{content}</pre>
        </div>
      )}
    </div>
  )
}

/** Generate a unified diff string from edits array. */
function generateEditDiff(filePath: string, edits: { oldText: string; newText: string }[]): string {
  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`]
  for (const edit of edits) {
    const oldLines = edit.oldText.split('\n')
    const newLines = edit.newText.split('\n')
    lines.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`)
    for (const line of oldLines) lines.push(`-${line}`)
    for (const line of newLines) lines.push(`+${line}`)
  }
  return lines.join('\n')
}

/** Try to parse edit tool args into { path, edits }. */
function parseEditArgs(args: string): { path: string; edits: { oldText: string; newText: string }[] } | null {
  try {
    const parsed = JSON.parse(args)
    if (!parsed.path) return null
    // New format: { path, edits: [{ oldText, newText }] }
    if (Array.isArray(parsed.edits) && parsed.edits.length > 0 && typeof parsed.edits[0].oldText === 'string') {
      return { path: parsed.path, edits: parsed.edits }
    }
    // Legacy format: { path, oldText, newText }
    if (typeof parsed.oldText === 'string' && typeof parsed.newText === 'string') {
      return { path: parsed.path, edits: [{ oldText: parsed.oldText, newText: parsed.newText }] }
    }
  } catch { /* not JSON or missing fields */ }
  return null
}

/** Try to parse write tool args into { path, content }. */
function parseWriteArgs(args: string): { path: string; content: string } | null {
  try {
    const parsed = JSON.parse(args)
    if (parsed.path && typeof parsed.content === 'string') {
      return { path: parsed.path, content: parsed.content }
    }
  } catch { /* ignore */ }
  return null
}

/** Guess a language from a file extension for syntax highlighting. */
function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', java: 'java', json: 'json', yaml: 'yaml',
    yml: 'yaml', css: 'css', html: 'xml', xml: 'xml', sql: 'sql',
    md: 'markdown', sh: 'bash', bash: 'bash', zsh: 'bash',
  }
  return map[ext] || ''
}

/** Expandable tool call block with args and result — shows diff view for edit tool, code preview for write */
function ToolCallBlock({ content, meta, onFileOpen }: { content: string; meta?: Record<string, unknown>; onFileOpen?: (path: string) => void }) {
  const toolName = (meta?.toolName as string) || content.replace('🔧 ', '')
  const [expanded, setExpanded] = useState(false)
  const args = meta?.args as string | undefined
  const result = meta?.result as string | undefined
  const isError = meta?.isError as boolean | undefined
  const hasDetails = !!(args || result)

  // For edit tool calls, parse args and generate diff
  const editDiff = useMemo(() => {
    if (toolName !== 'edit' || !args) return null
    const parsed = parseEditArgs(args)
    if (!parsed) return null
    return { diff: generateEditDiff(parsed.path, parsed.edits), path: parsed.path }
  }, [toolName, args])

  // For write tool calls, parse args to show file content nicely
  const writeInfo = useMemo(() => {
    if (toolName !== 'write' || !args) return null
    return parseWriteArgs(args)
  }, [toolName, args])

  // For read tool calls, parse args and use result as file content
  const readInfo = useMemo(() => {
    if (toolName !== 'read' || !args) return null
    try {
      const parsed = JSON.parse(args)
      if (!parsed.path) return null
      return { path: parsed.path as string, offset: parsed.offset as number | undefined, limit: parsed.limit as number | undefined }
    } catch { return null }
  }, [toolName, args])

  // Edit tool calls default to expanded (showing diff)
  const isEdit = !!editDiff
  const isWrite = !!writeInfo
  const isRead = !!readInfo
  const [editExpanded, setEditExpanded] = useState(false)
  const [writeExpanded, setWriteExpanded] = useState(false)
  const [readExpanded, setReadExpanded] = useState(false)

  // Early returns AFTER all hooks (Rules of Hooks compliance)
  if (toolName === 'subagent') return <SubagentCard meta={meta} />
  if (toolName === 'process') return <ProcessCard meta={meta} />

  if (isEdit) {
    return (
      <div className="msg-content bg-card border border-border rounded-md animate-scale-in">
        <button
          className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted font-mono bg-transparent border-none text-left hover:text-text transition-colors cursor-pointer"
          onClick={() => setEditExpanded(!editExpanded)}
        >
          <span className={`text-[11px] transition-transform ${editExpanded ? 'rotate-90' : ''}`}>▶</span>
          <span>✏️ edit</span>
          <span className="text-text/70 text-[12px] font-normal truncate">{editDiff.path}</span>
          {onFileOpen && <button className="text-accent text-[11px] font-medium hover:underline shrink-0 bg-transparent border-none cursor-pointer" onClick={e => { e.stopPropagation(); onFileOpen(editDiff.path) }}>Open</button>}
          {isError && <span className="text-danger text-[12px] ml-auto shrink-0">✗ error</span>}
          {result && !isError && <span className="text-ok text-[12px] ml-auto shrink-0">✓</span>}
        </button>
        {editExpanded && (
          <div className="px-2 pb-2">
            <DiffBlock code={editDiff.diff} complete={true} />
            {isError && result && (
              <div className="mt-1">
                <pre className="bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-danger">{result}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (isRead && result && !isError) {
    const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(readInfo.path)
    if (isImage) {
      const imgUrl = `/api/local-file?path=${encodeURIComponent(readInfo.path)}`
      // Check if result has a saved temp image URL from the backend
      const match = result.match(/!\[image\]\(([^)]+)\)/)
      const src = match ? match[1] : imgUrl
      return (
        <div className="msg-content bg-card border border-border rounded-md animate-scale-in">
          <button
            className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted font-mono bg-transparent border-none text-left hover:text-text transition-colors cursor-pointer"
            onClick={() => setReadExpanded(!readExpanded)}
          >
            <span className={`text-[11px] transition-transform ${readExpanded ? 'rotate-90' : ''}`}>▶</span>
            <span>🖼️ read</span>
            <span className="text-text/70 text-[12px] font-normal truncate">{readInfo.path.split('/').pop()}</span>
            {onFileOpen && <button className="text-accent text-[11px] font-medium hover:underline shrink-0 bg-transparent border-none cursor-pointer" onClick={e => { e.stopPropagation(); onFileOpen(readInfo.path) }}>Open</button>}
          </button>
          {readExpanded && (
            <div className="px-2 pb-2">
              <ResizableImage src={src} alt={readInfo.path.split('/').pop() || ''} />
            </div>
          )}
        </div>
      )
    }
    const lang = langFromPath(readInfo.path)
    const lineCount = result.split('\n').length
    const rangeLabel = readInfo.offset ? `lines ${readInfo.offset}–${readInfo.offset + (readInfo.limit || lineCount) - 1}` : `${lineCount} lines`
    return (
      <div className="msg-content bg-card border border-border rounded-md animate-scale-in">
        <button
          className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted font-mono bg-transparent border-none text-left hover:text-text transition-colors cursor-pointer"
          onClick={() => setReadExpanded(!readExpanded)}
        >
          <span className={`text-[11px] transition-transform ${readExpanded ? 'rotate-90' : ''}`}>▶</span>
          <span>📖 read</span>
          <span className="text-text/70 text-[12px] font-normal truncate">{readInfo.path}</span>
          {onFileOpen && <button className="text-accent text-[11px] font-medium hover:underline shrink-0 bg-transparent border-none cursor-pointer" onClick={e => { e.stopPropagation(); onFileOpen(readInfo.path) }}>Open</button>}
          <span className="text-muted/50 text-[12px] font-normal ml-auto shrink-0">{rangeLabel}</span>
        </button>
        {readExpanded && (
          <div className="px-2 pb-2">
            <div className="relative group">
              <div className="flex items-center justify-between bg-bg-elevated border border-border rounded-t-md px-3 py-1.5">
                <span className="text-muted text-[12px] font-mono uppercase">{lang || readInfo.path.split('/').pop()}</span>
                <button className="text-muted text-[12px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-text bg-transparent border-none font-body" onClick={() => navigator.clipboard.writeText(result)}>Copy</button>
              </div>
              <pre className="bg-bg-elevated border border-t-0 border-border rounded-b-md p-3 overflow-x-auto max-h-[400px] overflow-y-auto">
                <code className="text-[13px] font-mono leading-relaxed text-text">{result}</code>
              </pre>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (isWrite) {
    const lang = langFromPath(writeInfo.path)
    const lineCount = writeInfo.content.split('\n').length
    return (
      <div className="msg-content bg-card border border-border rounded-md animate-scale-in">
        <button
          className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted font-mono bg-transparent border-none text-left hover:text-text transition-colors cursor-pointer"
          onClick={() => setWriteExpanded(!writeExpanded)}
        >
          <span className={`text-[11px] transition-transform ${writeExpanded ? 'rotate-90' : ''}`}>▶</span>
          <span>📝 write</span>
          <span className="text-text/70 text-[12px] font-normal truncate">{writeInfo.path}</span>
          {onFileOpen && <button className="text-accent text-[11px] font-medium hover:underline shrink-0 bg-transparent border-none cursor-pointer" onClick={e => { e.stopPropagation(); onFileOpen(writeInfo.path) }}>Open</button>}
          <span className="text-muted/50 text-[12px] font-normal ml-auto shrink-0">{lineCount} lines</span>
          {isError && <span className="text-danger text-[12px] shrink-0 ml-1">✗ error</span>}
          {result && !isError && <span className="text-ok text-[12px] shrink-0 ml-1">✓</span>}
        </button>
        {writeExpanded && (
          <div className="px-2 pb-2">
            <div className="relative group">
              <div className="flex items-center justify-between bg-bg-elevated border border-border rounded-t-md px-3 py-1.5">
                <span className="text-muted text-[12px] font-mono uppercase">{lang || writeInfo.path.split('/').pop()}</span>
                <button className="text-muted text-[12px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-text bg-transparent border-none font-body" onClick={() => navigator.clipboard.writeText(writeInfo.content)}>Copy</button>
              </div>
              <pre className="bg-bg-elevated border border-t-0 border-border rounded-b-md p-3 overflow-x-auto max-h-[400px] overflow-y-auto">
                <code className="text-[13px] font-mono leading-relaxed text-text">{writeInfo.content}</code>
              </pre>
            </div>
            {isError && result && (
              <div className="mt-1">
                <pre className="bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-danger">{result}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`msg-content bg-card border border-border rounded-md animate-scale-in ${hasDetails ? 'cursor-pointer' : ''}`}>
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted font-mono bg-transparent border-none text-left hover:text-text transition-colors"
        onClick={() => hasDetails && setExpanded(!expanded)}
        disabled={!hasDetails}
      >
        {hasDetails && <span className={`text-[11px] transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>}
        <span>🔧 {toolName}</span>
        {isError && <span className="text-danger text-[12px]">✗ error</span>}
        {result && !isError && <span className="text-ok text-[12px]">✓</span>}
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border space-y-2">
          {args && (
            <div>
              <div className="text-[11px] text-muted font-medium uppercase tracking-wider mt-2 mb-1">Arguments</div>
              <pre className="bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-text">{args}</pre>
            </div>
          )}
          {result && (
            <div>
              <div className={`text-[11px] font-medium uppercase tracking-wider mt-2 mb-1 ${isError ? 'text-danger' : 'text-muted'}`}>{isError ? 'Error' : 'Result'}</div>
              {/!\[image\]\(/.test(result) ? (
                <div className="space-y-2">
                  {result.split(/\n\n/).map((part, i) => {
                    const imgMatch = part.match(/!\[image\]\(([^)]+)\)/)
                    return imgMatch
                      ? <ResizableImage key={i} src={imgMatch[1]} alt="tool result" />
                      : part.trim() ? <pre key={i} className={`bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto ${isError ? 'text-danger' : 'text-muted'}`}>{part}</pre> : null
                  })}
                </div>
              ) : (
                <pre className={`bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto ${isError ? 'text-danger' : 'text-muted'}`}>{result}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Threshold (chars) above which tool_input gets an expand/collapse toggle. */
const _EXPAND_THRESHOLD = 200

/** Permission approval prompt with optional expandable command details. */
function PermissionMessage({ title, toolInput, showButtons, onApprove }: {
  title: string; toolInput: string; showButtons: boolean
  onApprove: (decision: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const needsExpand = toolInput.length > _EXPAND_THRESHOLD
  return (
    <div className="bg-card border border-border border-l-[3px] border-l-warn rounded-md px-3.5 py-2.5 text-sm animate-scale-in">
      {toolInput
        ? <><strong>Tool approval requested:</strong></>
        : <>{showButtons ? '📦 Running: ' : '🔧 '}<strong>{title}</strong>{showButtons ? ' wants to run' : ''}</>
      }
      {toolInput && (
        <div className="mt-1.5">
          {needsExpand && !expanded ? (
            <>
              <pre className="bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[4.5em] overflow-hidden text-muted">{toolInput.slice(0, _EXPAND_THRESHOLD)}…</pre>
              <button className="text-accent text-[13px] mt-1 cursor-pointer bg-transparent border-none font-body hover:underline" onClick={() => setExpanded(true)}>Show full command</button>
            </>
          ) : (
            <>
              <pre className="bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[40vh] overflow-y-auto text-muted">{toolInput}</pre>
              {needsExpand && <button className="text-accent text-[13px] mt-1 cursor-pointer bg-transparent border-none font-body hover:underline" onClick={() => setExpanded(false)}>Collapse</button>}
            </>
          )}
        </div>
      )}
      {showButtons && (
        <div className="mt-1.5 flex gap-1.5 flex-wrap">
          <button className="px-2.5 py-1 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer font-body hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all" onClick={() => onApprove('approved')}>✅ Approve</button>
          <button className="px-2.5 py-1 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer font-body hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all" onClick={() => onApprove('trust')}>🤝 Trust</button>
          <button className="px-2.5 py-1 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer font-body hover:text-danger hover:border-danger transition-all" onClick={() => onApprove('rejected')}>🚫 Reject</button>
        </div>
      )}
    </div>
  )
}

export default function ChatPage() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const slots = useAppSelector(s => s.dashboard.slots)
  const unreadSlots = useAppSelector(s => s.dashboard.unreadSlots)
  const refreshTrigger = useAppSelector(s => s.dashboard.refreshTrigger)
  const notifications = useAppSelector(s => s.notifications.items)
  const activeSlot = useAppSelector(s => s.chat.activeSlot)
  const messages = useAppSelector(s => s.chat.messages)
  const slotRunning = useAppSelector(s => s.chat.slotRunning)
  const slotStopping = useAppSelector(s => s.chat.slotStopping)
  const slotState = useAppSelector(s => s.chat.slotState)
  const contextUsage = useAppSelector(s => s.chat.contextUsage)
  const extensionStatuses = useAppSelector(s => s.chat.extensionStatuses)
  const pendingApproval = useAppSelector(s => { const slot = s.dashboard.slots.find(sl => sl.key === s.chat.activeSlot); return slot?.pending_approval ?? false })
  const slotHasMore = useAppSelector(s => s.chat.slotHasMore)
  const slotOldestIndex = useAppSelector(s => s.chat.slotOldestIndex)
  const history = useAppSelector(s => s.chat.history)
  const historyHasMore = useAppSelector(s => s.chat.historyHasMore)

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

  const [viewingNotification, setViewingNotification] = useState<Notification | null>(null)
  const [chatConfig, setChatConfig] = useState<ChatConfig>(loadChatConfig)
  const [showTerminal, setShowTerminal] = useState(false)
  const [showTree, setShowTree] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [showRefs, setShowRefs] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)

  // Sync viewingNotification from Redux store (e.g. after auto-ack)
  useEffect(() => {
    if (!viewingNotification) return
    const fresh = notifications.find(n => n.ts === viewingNotification.ts)
    if (fresh && fresh.acked !== viewingNotification.acked) setViewingNotification(fresh)
  }, [notifications, viewingNotification])
  
  const [availableModels, setAvailableModels] = useState<{id: string; name: string; provider: string; contextWindow?: number}[]>([])
  const [pendingModel, setPendingModel] = useState('')  // agent for next new slot
  const [pendingCwd, setPendingCwd] = useState('')
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
    { key: 'Escape', label: 'Stop generation', action: () => { if (activeSlot && slotRunning) api.stopChatSlot(activeSlot) } },
  ], [activeSlot, slotRunning, dispatch]))

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
      <div key={key} className={`flex gap-3 items-start mb-3 mr-4 ${isUser ? 'flex-row-reverse animate-slide-in-right' : 'animate-slide-up'}`}>
        {isUser
          ? <div className="w-8 h-8 rounded-md grid place-items-center font-semibold text-sm shrink-0 self-end mb-0.5 bg-accent-subtle text-accent">U</div>
          : <img src="/logo.png" alt="Pi Dashboard" className="w-8 h-8 rounded-md shrink-0 self-end mb-0.5 object-cover" />
        }
        <div className={`flex flex-col gap-0.5 max-w-[min(820px,calc(100%-56px))] ${isUser ? 'items-end' : ''} group/msg relative`}>
          {isUser ? (
            <div className="msg-content px-3.5 py-2.5 text-sm leading-relaxed break-all whitespace-pre-wrap rounded-lg bg-accent text-white rounded-br-[4px] overflow-hidden select-text">
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

  return (
    <div className="flex flex-1 min-h-0 h-full">
      <ChatSidebar
        slots={slots}
        activeSlot={activeSlot}
        unreadSlots={unreadSlots}
        notifications={notifications}
        history={history}
        historyHasMore={historyHasMore}
        viewingNotification={viewingNotification}
        onViewNotification={(n) => { setViewingNotification(n); setMobileSidebarOpen(false) }}
        onNewSessionInCwd={(cwd) => { setPendingCwd(cwd); wantsNewSession.current = true; dispatch(switchSlot(null)); setMobileSidebarOpen(false) }}
        onNewSession={() => { wantsNewSession.current = true; dispatch(switchSlot(null)); setMobileSidebarOpen(false) }}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      {/* Chat pane */}
      <div className={`flex flex-col bg-bg min-w-0 ${panel.isOpen ? 'flex-[1_1_60%]' : 'flex-1'}`} style={{ transition: 'flex 0.2s' }}>
        {viewingNotification ? (
          <NotificationViewer
            key={viewingNotification.ts}
            notification={viewingNotification}
            onClose={() => setViewingNotification(null)}
            dispatch={dispatch}
          />
        ) : !activeSlot ? (
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
          />
        ) : (
          <>
            <div className="px-3 md:px-5 py-2 md:py-2.5 border-b border-border flex justify-between items-center bg-chrome gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
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
                <button className={`bg-transparent border rounded-md px-3 py-[5px] text-[13px] font-medium cursor-pointer transition-all font-body ${showTree ? 'border-accent text-accent bg-accent-subtle' : 'border-border text-muted hover:text-text hover:border-border-strong hover:bg-bg-hover'}`} aria-label="Toggle session tree" onClick={() => setShowTree(t => !t)}>🌳 Tree</button>
                <button className={`bg-transparent border rounded-md px-3 py-[5px] text-[13px] font-medium cursor-pointer transition-all font-body ${showRefs ? 'border-accent text-accent bg-accent-subtle' : 'border-border text-muted hover:text-text hover:border-border-strong hover:bg-bg-hover'}`} aria-label="Toggle referenced files" onClick={() => setShowRefs(t => !t)}>📎 Refs{referencedFiles.length > 0 ? ` (${referencedFiles.length})` : ''}</button>
                <button className={`bg-transparent border rounded-md px-3 py-[5px] text-[13px] font-medium cursor-pointer transition-all font-body ${showFiles ? 'border-accent text-accent bg-accent-subtle' : 'border-border text-muted hover:text-text hover:border-border-strong hover:bg-bg-hover'}`} aria-label="Toggle file browser" onClick={() => setShowFiles(t => !t)}>📄 Files</button>
                <button className={`bg-transparent border rounded-md px-3 py-[5px] text-[13px] font-medium cursor-pointer transition-all font-body ${showTerminal ? 'border-accent text-accent bg-accent-subtle' : 'border-border text-muted hover:text-text hover:border-border-strong hover:bg-bg-hover'}`} aria-label="Toggle terminal" onClick={() => setShowTerminal(t => !t)}>▸_ Terminal</button>
                <ChatSettings config={chatConfig} onChange={setChatConfig} activeSlot={activeSlot} currentModel={currentSlot?.model} models={availableModels} />
                <button className="bg-transparent border border-border text-muted rounded-md px-3 py-[5px] text-[13px] font-medium cursor-pointer hover:text-danger hover:border-danger transition-all font-body" aria-label="Close session" onClick={() => { if (activeSlot) dispatch(deleteSlot(activeSlot)) }}>✕ Close</button>
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
              {extensionStatuses['meeting-copilot'] && (
                <div className="px-4 py-1.5 bg-accent-subtle text-accent text-[12px] font-medium border-b border-border flex items-center gap-2 shrink-0 animate-slide-up">
                  {extensionStatuses['meeting-copilot']}
                </div>
              )}
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
              itemContent={(_i, item) => (
                <div className="px-5 py-2">
                  {item.type === 'group' ? (
                    <ToolGroup tools={item.tools} renderTool={renderMessage} />
                  ) : (
                    renderMessage(item.index, item.message)
                  )}
                </div>
              )}
            />
            {!isAtBottom && messages.length > 0 && (
              <div className="flex justify-center py-1.5">
                <button
                  className="px-3 py-1.5 rounded-full bg-accent text-white text-[13px] font-medium shadow-lg cursor-pointer border-none hover:bg-accent-hover transition-all flex items-center gap-1"
                  onClick={() => { setIsAtBottom(true); isAtBottomRef.current = true; scrollBottom() }}
                  aria-label="Scroll to bottom"
                >↓ Bottom</button>
              </div>
            )}
            {prefillHint && (
              <div className="flex items-center gap-2 px-5 py-2 bg-accent/10 border-t border-accent/30">
                <span className="text-accent text-[13px]">📋 Plan pre-filled below — add your context then press Send</span>
                <button className="text-muted text-[12px] hover:text-text ml-auto" onClick={() => setPrefillHint(false)}>✕</button>
              </div>
            )}
            <div className={`flex flex-col md:flex-row gap-2.5 px-3 md:px-5 pt-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom,0.875rem))] md:pb-3.5 border-t border-border bg-chrome md:items-end transition-colors ${dragOver ? 'bg-accent-subtle border-accent' : ''}`}
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
                <textarea ref={inputRef} aria-label="Message input" className={`bg-bg-elevated border border-border rounded-lg px-4 py-3 text-text text-base md:text-sm font-body outline-none min-h-[44px] leading-normal transition-all focus-ring placeholder:text-muted ${prefillHint ? 'resize-y max-h-[50vh]' : 'resize-none max-h-[140px]'} ${slotStopping ? 'opacity-40 pointer-events-none' : ''}`} placeholder={slotStopping ? 'Stopping…' : pendingImages.length > 0 ? 'Add a message about the image(s)…' : 'Message Pi…'} rows={1} value={input}
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
      {panel.isOpen && (
        <DocumentPanel filePath={panel.filePath} content={panel.content} onContentChange={handleContentChange} onSave={handleFileSave} onClose={panel.closePanel} dirty={panel.dirty} versions={panel.versions} selectedVersion={panel.selectedVersion} conflictContent={panel.conflictContent} onSelectVersion={panel.selectVersion} onResolveConflict={panel.resolveConflict} diffMode={panel.diffMode} onToggleDiff={panel.toggleDiffMode} comments={panel.comments} onAddComment={handleAddComment} onEditComment={handleEditComment} onDeleteComment={handleDeleteComment} onReviewComments={handleReviewComments} />
      )}
    </div>
  )
}

