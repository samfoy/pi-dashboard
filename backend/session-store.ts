/**
 * Session persistence and JSONL parser for pi sessions.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

const HOME: string = homedir()
const SESSIONS_DIR: string = join(HOME, '.pi', 'agent', 'sessions')
const STATE_FILE: string = join(HOME, '.pi', 'agent', 'pi-web-sessions.json')

// ── Types ──

export interface ChatMessage {
  role: 'user' | 'assistant' | 'thinking' | 'tool' | 'system'
  content: string
  ts?: string
  _partial?: boolean
  meta?: {
    toolName?: string
    toolCallId?: string
    args?: string
    result?: string
    isError?: boolean
    customType?: string
  }
}

export interface SlotState {
  key: string
  title: string
  messages?: ChatMessage[]
  sessionFile: string | null
  modelProvider: string | null
  modelId: string | null
  cwd: string | null
  tags?: string[]
}

export interface SessionTreeEntry {
  id: string | null
  parentId: string | null
  type: string
  timestamp?: string
  role?: string
  text?: string
  fullText?: string
  tools?: string[]
}

/** Duck-typed interface for PiProcess slots (avoids circular deps) */
interface SlotProcess {
  _title?: string
  _tags?: string[]
  messages: ChatMessage[]
  sessionFile?: string | null
  modelProvider?: string | null
  modelId?: string | null
  cwd?: string | null
}

type ContentPart = { type: string; text?: string; thinking?: string }

// ── Parse a pi session JSONL into chat messages ──

export function parseSessionMessages(sessionPath: string, limit: number = 200): ChatMessage[] {
  if (!existsSync(sessionPath)) return []
  const messages: ChatMessage[] = []
  try {
    const raw = readFileSync(sessionPath, 'utf-8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (obj.type !== 'message') continue
        const msg = obj.message
        if (!msg) continue
        const role: string = msg.role
        const ts: string | undefined = msg.timestamp ? new Date(msg.timestamp).toISOString() : undefined

        if (role === 'user') {
          const text = extractText(msg.content)
          if (text) messages.push({ role: 'user', content: text, ts })
        } else if (role === 'assistant') {
          // Extract thinking blocks
          if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === 'thinking' && part.thinking) {
                messages.push({ role: 'thinking', content: part.thinking, ts })
              }
            }
          }
          const text = extractText(msg.content)
          if (text) messages.push({ role: 'assistant', content: text, ts })
          // Extract tool calls with args
          if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === 'toolCall') {
                messages.push({
                  role: 'tool',
                  content: `🔧 ${part.name || 'tool'}`,
                  ts,
                  meta: {
                    toolName: part.name,
                    toolCallId: part.id,
                    args: typeof part.arguments === 'string'
                      ? part.arguments
                      : JSON.stringify(part.arguments || {}, null, 2),
                  },
                })
              }
            }
          }
        } else if (role === 'toolResult') {
          // Attach result to the matching tool message
          const resultText: string = Array.isArray(msg.content)
            ? msg.content.filter((c: ContentPart) => c.type === 'text').map((c: ContentPart) => c.text).join('')
            : ''
          const toolMsg = [...messages].reverse().find(
            (m: ChatMessage) => m.role === 'tool' && m.meta?.toolCallId === msg.toolCallId
          )
          if (toolMsg) {
            toolMsg.meta = {
              ...toolMsg.meta,
              result: resultText.slice(0, 5000),
              isError: msg.isError || false,
            }
          } else {
            messages.push({
              role: 'tool',
              content: `🔧 ${msg.toolName || 'tool'}`,
              ts,
              meta: { result: resultText.slice(0, 5000), isError: msg.isError || false },
            })
          }
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // skip unreadable files
  }
  // Return last N messages
  return messages.slice(-limit)
}

export function extractText(content: string | ContentPart[] | null | undefined, separator: string = ''): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p: ContentPart) => p.type === 'text')
      .map((p: ContentPart) => p.text || '')
      .join(separator)
  }
  return ''
}

// ── Find session file by key ──

export function findSessionFile(key: string): string | null {
  try {
    const dirs = readdirSync(SESSIONS_DIR).filter((d: string) => d.startsWith('--'))
    for (const dir of dirs) {
      const full = join(SESSIONS_DIR, dir)
      if (!statSync(full).isDirectory()) continue
      const files = readdirSync(full).filter((f: string) => f.endsWith('.jsonl'))
      for (const f of files) {
        if (f.replace('.jsonl', '') === key) {
          return join(full, f)
        }
      }
    }
  } catch {
    // skip
  }
  return null
}

// ── Parse session JSONL into a tree structure ──

export function parseSessionTree(sessionPath: string): { entries: SessionTreeEntry[]; leafId: string | null } {
  if (!existsSync(sessionPath)) return { entries: [], leafId: null }
  const entries: SessionTreeEntry[] = []
  let leafId: string | null = null
  try {
    const raw = readFileSync(sessionPath, 'utf-8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (obj.type === 'session') continue
        const entry: SessionTreeEntry = {
          id: obj.id || null,
          parentId: obj.parentId || null,
          type: obj.type,
          timestamp: obj.timestamp,
        }
        if (obj.type === 'message' && obj.message) {
          entry.role = obj.message.role
          const rawText = extractText(obj.message.content)
          entry.text = rawText.slice(0, 200)
          if (obj.message.role === 'user') entry.fullText = rawText
          // For assistant, check for tool calls
          if (obj.message.role === 'assistant' && Array.isArray(obj.message.content)) {
            const tools: string[] = obj.message.content.filter((p: ContentPart) => p.type === 'toolCall').map((p: any) => p.name)
            if (tools.length) entry.tools = tools
          }
        } else if (obj.type === 'branch_summary') {
          entry.role = 'branchSummary'
          entry.text = (obj.summary || '').slice(0, 200)
        } else if (obj.type === 'compaction') {
          entry.role = 'compaction'
          entry.text = 'Context compacted'
        } else if (obj.type === 'model_change') {
          entry.role = 'system'
          entry.text = `Model: ${obj.modelId || ''}`
        } else if (obj.type === 'custom_message') {
          entry.role = 'system'
          entry.text = (obj.content || '').slice(0, 200)
        } else {
          entry.role = 'system'
          entry.text = obj.type
        }
        if (entry.id) {
          entries.push(entry)
          leafId = entry.id  // last entry is the leaf
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // skip unreadable files
  }
  return { entries, leafId }
}

// ── Persist/restore dashboard slot state ──

// Async persist with write coalescing — avoids blocking the event loop
let _persistPending: boolean = false
let _persistQueued: SlotState[] | null = null  // latest slots snapshot waiting to write

export function saveSlotState(slots: Map<string, SlotProcess>): void {
  // Snapshot the data immediately (cheap), write async
  const data: SlotState[] = []
  for (const [key, pi] of slots.entries()) {
    const entry: SlotState = {
      key,
      title: pi._title || 'New Chat',
      sessionFile: pi.sessionFile || null,
      modelProvider: pi.modelProvider || null,
      modelId: pi.modelId || null,
      cwd: pi.cwd || null,
      tags: pi._tags?.length ? pi._tags : undefined,
    }
    // Only persist messages for slots without a session file (unsaved new chats)
    if (!pi.sessionFile && pi.messages.length > 0) {
      entry.messages = pi.messages
    }
    data.push(entry)
  }
  _persistQueued = data
  if (!_persistPending) {
    _persistPending = true
    // Defer to next tick so multiple rapid calls coalesce
    setImmediate(_flushPersist)
  }
}

async function _flushPersist(): Promise<void> {
  while (_persistQueued) {
    const data = _persistQueued
    _persistQueued = null
    try {
      // Stringify in chunks won't help much, but at least the write is async
      const json = JSON.stringify(data)
      await writeFile(STATE_FILE, json, 'utf-8')
    } catch {
      // skip write errors
    }
  }
  _persistPending = false
}

/** Synchronous save for shutdown — blocks but ensures data is written */
export function saveSlotStateSync(slots: Map<string, SlotProcess>): void {
  const data: SlotState[] = []
  for (const [key, pi] of slots.entries()) {
    const entry: SlotState = {
      key,
      title: pi._title || 'New Chat',
      sessionFile: pi.sessionFile || null,
      modelProvider: pi.modelProvider || null,
      modelId: pi.modelId || null,
      cwd: pi.cwd || null,
      tags: pi._tags?.length ? pi._tags : undefined,
    }
    // Only persist messages for slots without a session file (unsaved new chats)
    if (!pi.sessionFile && pi.messages.length > 0) {
      entry.messages = pi.messages
    }
    data.push(entry)
  }
  try {
    writeFileSync(STATE_FILE, JSON.stringify(data), 'utf-8')
  } catch {
    // skip write errors
  }
}

export function loadSlotState(): SlotState[] {
  if (!existsSync(STATE_FILE)) return []
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
  } catch { return [] }
}
