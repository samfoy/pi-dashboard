/**
 * Session persistence and JSONL parser for pi sessions.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const HOME = homedir()
const SESSIONS_DIR = join(HOME, '.pi', 'agent', 'sessions')
const STATE_FILE = join(HOME, '.pi', 'agent', 'pi-web-sessions.json')

// ── Parse a pi session JSONL into chat messages ──

export function parseSessionMessages(sessionPath, limit = 200) {
  if (!existsSync(sessionPath)) return []
  const messages = []
  try {
    const raw = readFileSync(sessionPath, 'utf-8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (obj.type !== 'message') continue
        const msg = obj.message
        if (!msg) continue
        const role = msg.role
        const ts = msg.timestamp ? new Date(msg.timestamp).toISOString() : undefined

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
          const resultText = Array.isArray(msg.content)
            ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('')
            : ''
          const toolMsg = [...messages].reverse().find(
            m => m.role === 'tool' && m.meta?.toolCallId === msg.toolCallId
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
      } catch {}
    }
  } catch {}
  // Return last N messages
  return messages.slice(-limit)
}

export function extractText(content, separator = '') {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(p => p.type === 'text')
      .map(p => p.text || '')
      .join(separator)
  }
  return ''
}

// ── Find session file by key ──

export function findSessionFile(key) {
  try {
    const dirs = readdirSync(SESSIONS_DIR).filter(d => d.startsWith('--'))
    for (const dir of dirs) {
      const full = join(SESSIONS_DIR, dir)
      if (!statSync(full).isDirectory()) continue
      const files = readdirSync(full).filter(f => f.endsWith('.jsonl'))
      for (const f of files) {
        if (f.replace('.jsonl', '') === key) {
          return join(full, f)
        }
      }
    }
  } catch {}
  return null
}

// ── Parse session JSONL into a tree structure ──

export function parseSessionTree(sessionPath) {
  if (!existsSync(sessionPath)) return { entries: [], leafId: null }
  const entries = []
  let leafId = null
  try {
    const raw = readFileSync(sessionPath, 'utf-8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (obj.type === 'session') continue
        const entry = {
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
            const tools = obj.message.content.filter(p => p.type === 'toolCall').map(p => p.name)
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
      } catch {}
    }
  } catch {}
  return { entries, leafId }
}

// ── Persist/restore dashboard slot state ──

export function saveSlotState(slots) {
  const data = []
  for (const [key, pi] of slots.entries()) {
    data.push({
      key,
      title: pi._title || 'New Chat',
      messages: pi.messages,
      sessionFile: pi.sessionFile || null,
      modelProvider: pi.modelProvider || null,
      modelId: pi.modelId || null,
      cwd: pi.cwd || null,
    })
  }
  try {
    writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf-8')
  } catch {}
}

export function loadSlotState() {
  if (!existsSync(STATE_FILE)) return []
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'))
  } catch { return [] }
}
