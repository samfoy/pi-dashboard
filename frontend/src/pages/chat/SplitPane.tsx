import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useAppSelector } from '../../store'
import { api } from '../../api/client'
import { AssistantMessage, ToolGroup, groupToolMessages, ThinkingBlock, ToolCallBlock } from '.'
import type { ChatMessage } from '../../types'

interface SplitPaneProps {
  slotKey: string
  onClose: () => void
  onFileOpen?: (path: string) => void
}

export default function SplitPane({ slotKey, onClose, onFileOpen }: SplitPaneProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const slots = useAppSelector(s => s.dashboard.slots)
  const slot = slots.find(s => s.key === slotKey)
  const title = slot ? (slot.title !== slot.key ? slot.title : slot.key) : slotKey

  // Fetch messages for the slot
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.chatSlotDetail(slotKey, 200)
      .then(d => {
        if (cancelled) return
        const SKIP_ROLES = new Set(['chunk', 'done'])
        const msgs = (d.messages || []).filter((m: ChatMessage) => !SKIP_ROLES.has(m.role))
        setMessages(msgs)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err?.message || 'Failed to load messages')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [slotKey])

  // Re-fetch periodically to pick up new messages (lightweight poll)
  useEffect(() => {
    const interval = setInterval(() => {
      api.chatSlotDetail(slotKey, 200)
        .then(d => {
          const SKIP_ROLES = new Set(['chunk', 'done'])
          const msgs = (d.messages || []).filter((m: ChatMessage) => !SKIP_ROLES.has(m.role))
          setMessages(msgs)
        })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(interval)
  }, [slotKey])

  const groupedMessages = useMemo(() => groupToolMessages(messages), [messages])

  const handleFileOpen = useCallback((path: string) => {
    if (onFileOpen) onFileOpen(path)
  }, [onFileOpen])

  const renderMessage = useCallback((i: number, m: ChatMessage) => {
    const key = m.ts ? `${m.role}-${m.ts}` : `${m.role}-${i}`
    if (m.role === 'thinking') return <ThinkingBlock key={key} content={m.content} />
    if (m.role === 'tool') return <ToolCallBlock key={key} content={m.content} meta={m.meta} onFileOpen={handleFileOpen} />
    if (m.role === 'queued') return <div key={key} className="bg-warn-subtle border border-warn/15 rounded-md px-3 py-2 text-[13px] text-warn italic">⏳ <em>Queued:</em> {m.content}</div>
    if (m.role === 'error') return <div key={key} className="bg-danger-subtle text-danger text-[13px] px-3 py-2 rounded-md border border-danger/15 self-center">{m.content}</div>
    if (m.role === 'permission') return (
      <div key={key} className="bg-warn-subtle border border-warn/20 rounded-md px-3 py-2 text-[13px] text-warn">🔒 {m.content}</div>
    )

    const isUser = m.role === 'user'
    const isStreaming = m.role === 'streaming'
    return (
      <div key={key} className={`flex gap-3 items-start mb-3 mr-4 ${isUser ? 'flex-row-reverse' : ''}`}>
        {isUser
          ? <div className="w-7 h-7 rounded-md grid place-items-center font-semibold text-xs shrink-0 self-end mb-0.5 bg-accent-subtle text-accent">U</div>
          : <img src="/logo.png" alt="Pi" className="w-7 h-7 rounded-md shrink-0 self-end mb-0.5 object-cover" />
        }
        <div className={`flex flex-col gap-0.5 max-w-[min(820px,calc(100%-48px))] ${isUser ? 'items-end' : ''}`}>
          {isUser ? (
            <div className="msg-content px-3 py-2 text-[13px] leading-relaxed break-all whitespace-pre-wrap rounded-lg bg-accent text-white rounded-br-[4px] overflow-hidden select-text">{m.content}</div>
          ) : (
            <AssistantMessage content={m.content} isStreaming={isStreaming} slotRunning={false} onOption={() => {}} onFileOpen={handleFileOpen} planTaskId="" onApplyPlan={async () => {}} />
          )}
        </div>
      </div>
    )
  }, [handleFileOpen])

  return (
    <div className="flex flex-col border-l border-border bg-bg" style={{ flex: '0 0 50%', maxWidth: '50%' }}>
      {/* Header */}
      <div className="px-4 py-2 border-b border-border flex justify-between items-center bg-chrome gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[11px] text-muted font-medium uppercase tracking-wider shrink-0">Split View</span>
          <span className="text-sm font-semibold text-text font-mono truncate">{title}</span>
          {slot?.running && <span className="typing-dots-sm"><span /><span /><span /></span>}
        </div>
        <button
          className="bg-transparent border border-border text-muted rounded-md px-3 py-[5px] text-[13px] font-medium cursor-pointer hover:text-danger hover:border-danger transition-all font-body"
          onClick={onClose}
          aria-label="Close split view"
        >
          ✕ Close
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-muted text-sm animate-pulse">Loading messages…</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-danger text-sm">{error}</span>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-muted text-sm">No messages yet</span>
        </div>
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          style={{ flex: 1 }}
          data={groupedMessages}
          followOutput="smooth"
          initialTopMostItemIndex={groupedMessages.length - 1}
          itemContent={(_i: number, item: ReturnType<typeof groupToolMessages>[number]) => {
            const isUserTurn = item.type === 'single' && item.message.role === 'user' && _i > 0
            return (
              <div className="px-4 py-2">
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
    </div>
  )
}
