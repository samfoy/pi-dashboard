/**
 * Chat routes — slot CRUD, message sending, notifications, models, system prompt
 */
import { Request, Response } from 'express'
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { execSync } from 'child_process'
import os from 'os'
import type { RouteDeps, ChatMessage } from './types.js'
import { parseSessionMessages, parseSessionTree, findSessionFile } from '../session-store.js'
import { PiRpcSession } from '../pi-manager.js'
import type { PiSession, PiTransport } from '../pi-session.js'
import * as piEnv from '../pi-env.js'

type ModelInfo = {
  provider?: string
  id?: string
  name?: string
}

// Opus/Sonnet are served via the claude-code provider (us.* inference profiles).
// The raw `amazon-bedrock` foundation-model IDs (e.g. anthropic.claude-opus-4-8)
// can't be invoked on-demand and Bedrock rejects them, so select from claude-code.
const DASHBOARD_BEDROCK_PROVIDER = 'amazon-claude-code'
const DASHBOARD_MANTLE_PROVIDER = 'bedrock-mantle'

function numericVersionParts(raw: string): number[] {
  const parts: number[] = []
  for (const token of raw.split(/[.:_-]/)) {
    if (/^\d{8}$/.test(token)) break
    if (/^\d+$/.test(token)) parts.push(Number.parseInt(token, 10))
  }
  return parts
}

function modelVersionParts(id: string, family: string): number[] {
  const familyIdx = id.toLowerCase().indexOf(family.toLowerCase())
  if (familyIdx === -1) return []
  return numericVersionParts(id.slice(familyIdx + family.length + 1))
}

function claudeVersionParts(id: string): number[] {
  return numericVersionParts(id.replace(/^(?:us\.)?anthropic\.claude-/i, ''))
}

function compareVersionParts(a: number[], b: number[]): number {
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function latestByFamily(models: ModelInfo[], provider: string, family: 'opus' | 'sonnet'): ModelInfo | null {
  const familyPattern = new RegExp(`^(?:us\\.)?anthropic\\.claude-.*${family}`, 'i')
  return models
    .filter(m => m.provider === provider && !!m.id && familyPattern.test(m.id))
    .sort((a, b) => compareVersionParts(claudeVersionParts(b.id!), claudeVersionParts(a.id!)))
    [0] || null
}

function latestGptModels(models: ModelInfo[], provider: string, count: number): ModelInfo[] {
  return models
    .filter(m => m.provider === provider && !!m.id && /^openai\.gpt-\d+(?:\.\d+)*$/i.test(m.id))
    .sort((a, b) => compareVersionParts(modelVersionParts(b.id!, 'gpt'), modelVersionParts(a.id!, 'gpt')))
    .slice(0, count)
}

function preferredDashboardModels(models: ModelInfo[]): ModelInfo[] {
  const selected = [
    latestByFamily(models, DASHBOARD_BEDROCK_PROVIDER, 'opus'),
    latestByFamily(models, DASHBOARD_BEDROCK_PROVIDER, 'sonnet'),
    ...latestGptModels(models, DASHBOARD_MANTLE_PROVIDER, 2),
  ].filter((m): m is ModelInfo => !!m)

  const seen = new Set<string>()
  return selected.filter(m => {
    const key = `${m.provider}/${m.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function registerChatRoutes(deps: RouteDeps): void {
  const { app, manager, broadcast, broadcastSlots, persistSlots, notifications, addNotification, wireSlotEvents } = deps

  // Recreate a slot on a chosen transport, re-adopting its session state
  // (sessionFile, messages, model, thinking, cwd, tags, title). createSlot with
  // the same key registers a deferred slot that re-adopts `sessionFile` on its
  // next ensureRunning — no double process while we swap. Shared by the
  // POST .../transport endpoint and the conductor-detach reconstruction path.
  function recreateSlotWithTransport(key: string, transport: PiTransport): PiSession | null {
    const pi = manager.getSlot(key)
    if (!pi) return null
    const opts = {
      key,
      transport,
      messages: pi.messages,
      sessionFile: pi.sessionFile,
      title: pi._title || undefined,
      modelProvider: pi.modelProvider,
      modelId: pi.modelId,
      thinkingLevel: pi.thinkingLevel,
      cwd: pi.cwd,
      tags: pi._tags,
      // Preserve the permission-gating flag across a transport swap so a slot
      // toggled back to `sdk` keeps its opt-in (slice 11). No-op while on RPC.
      toolApproval: pi.toolApproval,
    }
    manager.deleteSlot(key)
    const slot = manager.createSlot(opts.title || key, null, opts)
    const newPi = manager.getSlot(slot.key)!
    wireSlotEvents(newPi, slot.key)
    newPi._wired = true
    persistSlots()
    broadcastSlots()
    return newPi
  }

  // Chat slots
  app.get('/api/chat/slots', (_req: Request, res: Response) => res.json(manager.listSlots()))

  app.post('/api/chat/slots', (req: Request, res: Response) => {
    const { name, agent, model, cwd } = req.body || {}
    let modelProvider: string | null = null, modelId: string | null = null
    if (model && model.includes('/')) {
      const idx = model.indexOf('/')
      modelProvider = model.slice(0, idx)
      modelId = model.slice(idx + 1)
    }
    const rawCwd = cwd || null
    const resolvedCwd = rawCwd
      ? (rawCwd === '~' ? os.homedir() : rawCwd.startsWith('~/') ? join(os.homedir(), rawCwd.slice(2)) : rawCwd)
      : null
    const slot = manager.createSlot(name, agent, { modelProvider, modelId, cwd: resolvedCwd })
    const pi = manager.getSlot(slot.key)!
    wireSlotEvents(pi, slot.key)
    pi._wired = true
    broadcastSlots()
    res.json(slot)
  })

  // Session tree for a slot
  app.get('/api/chat/slots/:key/tree', (req: Request, res: Response) => {
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    const sessionPath = pi.sessionFile
    if (!sessionPath) return res.json({ entries: [], leafId: null })
    res.json(parseSessionTree(sessionPath))
  })

  // Fork from a user message — creates a NEW slot with a forked session
  app.post('/api/chat/slots/:key/fork', async (req: Request, res: Response) => {
    const { entryId } = req.body
    if (!entryId) return res.status(400).json({ error: 'entryId required' })
    const pi = manager.ensureRunning(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    if (!pi._wired) { wireSlotEvents(pi, req.params.key as string); pi._wired = true }
    try {
      const result = await pi.fork(entryId)
      if (result.cancelled) return res.json({ ok: false, cancelled: true })
      const state = await pi.getState()
      const forkedSessionFile = state.data?.sessionFile || null
      const forkedMessages = forkedSessionFile ? parseSessionMessages(forkedSessionFile, 200) : []
      const text = result.text || ''
      const forkSlot = manager.createSlot('Fork: ' + text.slice(0, 40), null, {
        messages: forkedMessages,
        sessionFile: forkedSessionFile,
        title: 'Fork: ' + text.slice(0, 40),
        modelProvider: pi.modelProvider,
        modelId: pi.modelId,
        cwd: pi.cwd,
        // Inherit the parent slot's transport so a fork preserves isolation
        // characteristics (a fork of a detached/background RPC slot stays RPC;
        // a fork of a foreground SDK slot stays SDK).
        transport: pi.transport,
      })
      const forkPi = manager.getSlot(forkSlot.key)!
      wireSlotEvents(forkPi, forkSlot.key)
      forkPi._wired = true
      pi.kill()
      persistSlots()
      broadcastSlots()
      res.json({ ok: true, text, newSlotKey: forkSlot.key })
    } catch (e: any) { res.status(500).json({ error: e.message }) }
  })

  // Get fork-able messages for a slot
  app.get('/api/chat/slots/:key/fork-messages', async (req: Request, res: Response) => {
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    try {
      const result = await pi.getForkMessages()
      res.json(result)
    } catch (e: any) { res.status(500).json({ error: e.message }) }
  })

  app.get('/api/chat/slots/:key', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string || '200', 10)
    const detail = manager.getSlotDetail(req.params.key as string, limit)
    if (!detail) return res.status(404).json({ error: 'slot not found' })
    res.json(detail)
  })

  app.delete('/api/chat/slots/:key', (req: Request, res: Response) => {
    manager.deleteSlot(req.params.key as string)
    broadcastSlots()
    res.json({ ok: true })
  })

  app.post('/api/chat/slots/:key/stop', (req: Request, res: Response) => {
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    pi.abort()
    res.json({ ok: true })
  })

  app.post('/api/chat/slots/:key/conductor-detach', (req: Request, res: Response) => {
    const key = req.params.key as string
    const pi = manager.getSlot(key)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    // Detached/background sub-agents MUST run as isolated RPC subprocesses
    // (design decision #2). Since the slice-10 flip, a foreground slot defaults
    // to the in-process `sdk` transport — detaching it with only a field flip
    // would leave it running in-process (no isolation) AND break the sentinel
    // handshake (PiSdkSession has no `.proc`/pid). So if the slot isn't already
    // an RPC subprocess, reconstruct it as PiRpcSession (re-adopting session
    // state), spawn it so it has a real pid, then write the detach sentinel.
    let target: PiSession = pi
    if (!(pi instanceof PiRpcSession)) {
      const rebuilt = recreateSlotWithTransport(key, 'rpc')
      // ensureRunning spawns the RPC subprocess (re-adopts sessionFile) so the
      // sentinel write below has a live pid for pi-conductor to poll.
      target = manager.ensureRunning(key) ?? rebuilt ?? pi
    }
    target.conductorDetach()
    res.json({ ok: true })
  })

  // Answer a pending extension-UI dialog (confirm/select/input/editor) raised
  // via the `extension_ui_request` WS frame. Resolves the request on pi's
  // existing RPC response path, mapping to pi's per-method return type:
  //   confirm            → { confirmed: boolean }
  //   select/input/editor → { value: string | undefined }
  //   cancel (any)       → { cancelled: true }
  app.post('/api/chat/slots/:key/extension-ui-response', (req: Request, res: Response) => {
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    const { id, cancelled, value } = req.body || {}
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' })
    const ok = pi.respondExtensionUi(id, { cancelled, value })
    if (!ok) return res.status(404).json({ error: 'no pending extension-ui request' })
    res.json({ ok: true })
  })

  // Enable/disable permission gating for a slot (slice 11). Additive, default
  // OFF. The flag is read LIVE by the SDK `tool_call` hook, so toggling it takes
  // effect on the NEXT tool call — no session recreation. SDK-only at runtime
  // (RPC can't gate in-process); persisted for parity so the setting survives a
  // restart and a later transport swap to `sdk`.
  app.post('/api/chat/slots/:key/tool-approval', (req: Request, res: Response) => {
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    pi.toolApproval = !!(req.body && req.body.enabled)
    persistSlots()
    broadcastSlots()
    res.json({ ok: true, key: req.params.key as string, toolApproval: pi.toolApproval, transport: pi.transport })
  })

  // Resolve a pending gated tool call (slice 11) raised via the
  // `tool_approval_request` WS frame. `decision:'approve'` proceeds (mutating
  // the tool args with `editedArgs` when provided); `decision:'deny'` blocks it
  // with reason "denied by user". Returns 404 if the id is unknown (already
  // answered / timed out) or the slot can't gate (RPC).
  app.post('/api/chat/slots/:key/tool-approval-response', (req: Request, res: Response) => {
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    const { id, decision, editedArgs } = req.body || {}
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' })
    if (decision !== 'approve' && decision !== 'deny') {
      return res.status(400).json({ error: 'decision must be "approve" or "deny"' })
    }
    const ok = pi.respondToolApproval(id, decision, editedArgs)
    if (!ok) return res.status(404).json({ error: 'no pending tool-approval request' })
    res.json({ ok: true })
  })

  app.patch('/api/chat/slots/:key/title', (req: Request, res: Response) => {
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    pi._title = req.body.title || 'New Chat'
    pi._userRenamed = true
    broadcastSlots()
    broadcast('slot_title', { key: req.params.key as string, title: pi._title })
    persistSlots()
    res.json({ ok: true })
  })

  app.patch('/api/chat/slots/:key/tags', (req: Request, res: Response) => {
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    const tags: string[] = Array.isArray(req.body.tags) ? req.body.tags.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean) : []
    pi._tags = [...new Set(tags)]
    broadcastSlots()
    broadcast('slot_tags', { key: req.params.key as string, tags: pi._tags })
    persistSlots()
    res.json({ ok: true, tags: pi._tags })
  })

  app.post('/api/chat/slots/:key/generate-title', (req: Request, res: Response) => {
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    const firstUser = pi.messages.find((m: ChatMessage) => m.role === 'user')
    const title = firstUser ? firstUser.content.slice(0, 60).replace(/\n/g, ' ') : 'New Chat'
    pi._title = title
    broadcast('slot_title', { key: req.params.key as string, title })
    broadcastSlots()
    persistSlots()
    res.json({ ok: true, title })
  })

  app.post('/api/chat/slots/:key/resume', (req: Request, res: Response) => {
    const { name, key: reqKey, title, file: bodyFile } = req.body || {}
    const sessionKey = req.params.key as string
    const sessionPath = bodyFile || findSessionFile(sessionKey)
    let messages: ChatMessage[] = []
    if (sessionPath) {
      messages = parseSessionMessages(sessionPath, 200)
    }
    const slot = manager.createSlot(title || name || sessionKey, null, {
      messages,
      sessionFile: sessionPath,
      title: title || name || sessionKey,
    })
    const pi = manager.getSlot(slot.key)!
    wireSlotEvents(pi, slot.key)
    pi._wired = true
    broadcastSlots()
    persistSlots()
    res.json({ ok: true, key: slot.key, messages, has_more: false, total: messages.length })
  })

  // Send chat message
  app.post('/api/chat', async (req: Request, res: Response) => {
    const { message, slot, images } = req.body
    if (!slot) return res.status(400).json({ error: 'slot required' })
    const pi = manager.ensureRunning(slot)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    if (!pi._wired) {
      wireSlotEvents(pi, slot)
      pi._wired = true
    }
    await pi.prompt(message, images)
    persistSlots()
    res.json({ ok: true })
  })

  // Approval mode (stub)
  app.post('/api/chat/mode', (_req: Request, res: Response) => res.json({ ok: true }))

  // Notifications
  app.get('/api/notifications', (_req: Request, res: Response) => res.json({ notifications }))

  // Lightweight poll endpoint for iOS background refresh
  app.get('/api/poll', (_req: Request, res: Response) => {
    const slots = manager.listSlots().map((s: any) => ({
      key: s.key,
      title: s.title,
      running: s.running,
      updated_at: s.updated_at,
    }))
    const unacked = notifications.filter(n => !n.acked)
    res.json({ slots, notifications: unacked })
  })
  app.post('/api/notifications/clear', (_req: Request, res: Response) => { notifications.length = 0; res.json({ ok: true }) })
  app.post('/api/notifications/ack', (req: Request, res: Response) => {
    const n = notifications.find(n => n.ts === req.body.ts)
    if (n) n.acked = true
    res.json({ ok: true })
  })
  app.post('/api/notifications/unack', (req: Request, res: Response) => {
    const n = notifications.find(n => n.ts === req.body.ts)
    if (n) n.acked = false
    res.json({ ok: true })
  })
  app.post('/api/notifications/ack-all', (_req: Request, res: Response) => {
    for (const n of notifications) n.acked = true
    res.json({ ok: true })
  })
  app.delete('/api/notifications', (_req: Request, res: Response) => { notifications.length = 0; res.json({ ok: true }) })

  // Models
  app.get('/api/models', async (_req: Request, res: Response) => {
    try {
      const models = await manager.getModels()
      // Prefer the compact dashboard model set when those models are available.
      // Otherwise fall back to honouring `disabledProviders` from pi settings.
      let disabled: string[] = []
      try {
        const s = JSON.parse(readFileSync(join(os.homedir(), '.pi', 'agent', 'settings.json'), 'utf-8'))
        if (Array.isArray(s.disabledProviders)) disabled = s.disabledProviders
      } catch {}
      const preferred = preferredDashboardModels(models)
      const filtered = preferred.length > 0
        ? preferred
        : disabled.length
          ? models.filter((m: any) => !disabled.includes(m.provider))
          : models
      res.json({ models: filtered })
    } catch (e: any) {
      res.json({ models: [], error: e.message })
    }
  })

  // Set model for a slot
  app.post('/api/chat/slots/:key/model', async (req: Request, res: Response) => {
    const { provider, modelId } = req.body
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    pi.modelProvider = provider
    pi.modelId = modelId
    if (pi.alive && pi.ready) {
      try {
        await pi.setModel(provider, modelId)
      } catch {}
    }
    persistSlots()
    broadcastSlots()
    res.json({ ok: true })
  })

  // Set thinking level for a slot
  app.post('/api/chat/slots/:key/thinking', async (req: Request, res: Response) => {
    const { level } = req.body
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    pi.thinkingLevel = level
    if (pi.alive && pi.ready) {
      try { await pi.setThinkingLevel(level) } catch {}
    }
    persistSlots()
    broadcastSlots()
    res.json({ ok: true })
  })

  // Set transport backend for a slot. Both `rpc` (default) and `sdk` recreate
  // the slot's session on the chosen transport and re-adopt its session file
  // (mirrors the resume endpoint's create + wire). `sdk` is only constructed
  // when a caller EXPLICITLY opts in here; the default transport stays `rpc`
  // (resolveTransport unchanged) and no automatic path builds a PiSdkSession.
  // PiSdkSession is fully implemented (slices 7a-7e), so the SDK branch now
  // uses the SAME recreate/re-adopt/re-wire path as the RPC branch below.
  app.post('/api/chat/slots/:key/transport', (req: Request, res: Response) => {
    const { transport } = req.body || {}
    if (transport !== 'rpc' && transport !== 'sdk') {
      return res.status(400).json({ error: 'transport must be "rpc" or "sdk"' })
    }
    const key = req.params.key as string
    const pi = manager.getSlot(key)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    recreateSlotWithTransport(key, transport)
    res.json({ ok: true, key, transport })
  })

  // Git repo summary for a slot (branch, dirty file count, adds/dels)
  app.get('/api/chat/slots/:key/git', (req: Request, res: Response) => {
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    const cwd = pi.cwd
    if (!cwd) return res.json({ isRepo: false })
    const run = (cmd: string): string | null => {
      try { return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
    }
    const insideWorktree = run('git rev-parse --is-inside-work-tree')
    if (insideWorktree !== 'true') return res.json({ isRepo: false })
    const branch = run('git rev-parse --abbrev-ref HEAD') || null
    const statusOut = run('git status --porcelain') || ''
    const dirtyFiles = statusOut ? statusOut.split('\n').filter(Boolean).length : 0
    // Sum +/- across working-tree changes
    let additions = 0
    let deletions = 0
    const numstat = run('git diff --numstat HEAD') || ''
    for (const line of numstat.split('\n')) {
      const m = line.match(/^(\d+|-)\s+(\d+|-)\s+/)
      if (!m) continue
      if (m[1] !== '-') additions += parseInt(m[1]!, 10) || 0
      if (m[2] !== '-') deletions += parseInt(m[2]!, 10) || 0
    }
    const ahead = parseInt(run('git rev-list --count @{u}..HEAD 2>/dev/null') || '0', 10) || 0
    const behind = parseInt(run('git rev-list --count HEAD..@{u} 2>/dev/null') || '0', 10) || 0
    res.json({ isRepo: true, branch, dirtyFiles, additions, deletions, ahead, behind })
  })

  // Set CWD for a slot (before process starts)
  app.post('/api/chat/slots/:key/cwd', (req: Request, res: Response) => {
    const { cwd } = req.body
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    pi.cwd = cwd === '~' ? os.homedir() : cwd.startsWith('~/') ? join(os.homedir(), cwd.slice(2)) : cwd
    if (pi.alive && pi.messages.length === 0) {
      pi.kill()
      pi.start()
      if (!pi._wired) {
        wireSlotEvents(pi, req.params.key as string)
        pi._wired = true
      }
    }
    persistSlots()
    broadcastSlots()
    res.json({ ok: true })
  })

  // System prompt for a slot
  app.get('/api/chat/slots/:key/system-prompt', async (req: Request, res: Response) => {
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    try {
      const cwd = pi.cwd || process.env.HOME || '/tmp'
      const piPkg = process.env.PI_PKG_PATH || (() => {
        try {
          const piCli = execSync('realpath $(which pi)', { encoding: 'utf-8' }).trim()
          return join(dirname(dirname(piCli)))
        } catch { return '' }
      })()
      const { buildSystemPrompt } = await import(join(piPkg, 'dist/core/system-prompt.js'))
      const { loadProjectContextFiles } = await import(join(piPkg, 'dist/core/resource-loader.js'))
      const { loadSkills } = await import(join(piPkg, 'dist/core/skills.js'))
      const agentDir = process.env.PI_AGENT_DIR || join(os.homedir(), '.pi', 'agent')
      const contextFiles = loadProjectContextFiles({ cwd, agentDir })
      const { skills } = loadSkills({ cwd, agentDir, skillPaths: [], includeDefaults: true })
      const staticPrompt = buildSystemPrompt({ cwd, contextFiles, skills })

      let memoryBlock = ''
      let memoryStats = { semantic: 0, lessons: 0 }
      try {
        // pi-memory bundles to a single dist/index.js (esbuild) — older code
        // tried req('./dist/store.js') / './dist/injector.js' which never
        // existed. Use the bundled exports instead, and fall back to npm-
        // installed copy when the local Projects checkout is missing.
        const piMemoryCandidates = [
          join(os.homedir(), 'Projects', 'pi-memory'),
          join(os.homedir(), 'scratch', 'pi-memory'),
          '/opt/homebrew/lib/node_modules/@samfp/pi-memory',
        ]
        const piMemoryPkg = piMemoryCandidates.find(p => {
          try { statSync(join(p, 'dist', 'index.js')); return true } catch { return false }
        })
        if (!piMemoryPkg) throw new Error('pi-memory dist/index.js not found in any candidate path')
        const { MemoryStore, buildContextBlock } = await import(join(piMemoryPkg, 'dist', 'index.js'))
        let dbPath = join(os.homedir(), '.pi', 'memory', 'memory.db')
        try {
          const localSettings = JSON.parse(readFileSync(join(cwd, '.pi', 'settings.json'), 'utf-8'))
          const localPath = localSettings?.['pi-memory']?.localPath
          if (localPath) dbPath = join(localPath, 'memory.db')
        } catch {}
        const store = new MemoryStore(dbPath)
        const { text, stats } = buildContextBlock(store, cwd)
        store.close()
        memoryBlock = text || ''
        memoryStats = stats || memoryStats
      } catch (err: any) {
        console.warn('[system-prompt] Could not load pi-memory:', err.message)
      }

      res.json({
        static: staticPrompt,
        runtime: memoryBlock ? staticPrompt + '\n\n' + memoryBlock : staticPrompt,
        memory: memoryBlock,
        memoryStats,
      })
    } catch (err: any) {
      console.error('[system-prompt] Error building system prompt:', err)
      res.status(500).json({ error: 'Failed to build system prompt', detail: err.message })
    }
  })

  // Subagents
  app.get('/api/subagents/status', (req: Request, res: Response) => {
    const slot = (req.query as any).slot || 'default'
    try {
      const data = readFileSync(`/tmp/pi-subagents-${slot}.json`, 'utf-8')
      res.json(JSON.parse(data))
    } catch {
      res.json([])
    }
  })

  app.get('/api/subagents/:id/log', (req: Request, res: Response) => {
    try {
      const id = (req.params as any).id.replace(/[^a-zA-Z0-9_-]/g, '')
      const log = readFileSync(`/tmp/subagent-${id}-live.log`, 'utf-8')
      res.type('text/plain').send(log)
    } catch {
      res.type('text/plain').send('')
    }
  })

  app.get('/api/spawn', (_req: Request, res: Response) => res.json([]))
  app.get('/api/approvals', (_req: Request, res: Response) => res.json([]))

  // AIM (stubs)
  app.get('/api/aim/mcp', (_req: Request, res: Response) => res.json([]))
  app.get('/api/aim/skills', (_req: Request, res: Response) => res.json([]))
  app.get('/api/aim/agents', (_req: Request, res: Response) => res.json([]))
  app.get('/api/aim/mcp/registry', (_req: Request, res: Response) => res.json([]))

  // Slash commands
  const SLASH_BUILTINS: { name: string; description: string; source: string }[] = [
    { name: '/clear', description: 'Clear conversation history', source: 'builtin' },
    { name: '/compact', description: 'Compact conversation to free context', source: 'builtin' },
    { name: '/model', description: 'Select model', source: 'builtin' },
    { name: '/export', description: 'Export session (HTML/JSONL)', source: 'builtin' },
    { name: '/copy', description: 'Copy last agent message to clipboard', source: 'builtin' },
    { name: '/name', description: 'Set session display name', source: 'builtin' },
    { name: '/session', description: 'Show session info and stats', source: 'builtin' },
    { name: '/fork', description: 'Create a new fork from a previous message', source: 'builtin' },
    { name: '/new', description: 'Start a new session', source: 'builtin' },
    { name: '/reload', description: 'Reload extensions, skills, prompts, themes', source: 'builtin' },
    { name: '/tools', description: 'Show available tools', source: 'builtin' },
    { name: '/mcp', description: 'Show configured MCP servers', source: 'builtin' },
    { name: '/usage', description: 'Show billing and usage information', source: 'builtin' },
  ]

  app.get('/api/slash-commands', async (_req: Request, res: Response) => {
    const dedup = (cmds: { name: string; description: string; source: string }[]) => {
      const seen = new Map<string, { name: string; description: string; source: string }>()
      for (const c of cmds) {
        if (!seen.has(c.name)) seen.set(c.name, c)
      }
      return [...seen.values()]
    }

    const scanPromptTemplates = (): { name: string; description: string; source: string }[] => {
      const promptDir = join(os.homedir(), '.pi', 'agent', 'prompts')
      const results: { name: string; description: string; source: string }[] = []
      try {
        for (const entry of readdirSync(promptDir, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue
          const name = entry.name.replace(/\.md$/, '')
          try {
            const content = readFileSync(join(promptDir, entry.name), 'utf-8')
            const descMatch = content.match(/description:\s*(.+)/)
            const desc = descMatch ? descMatch[1].trim().slice(0, 80) : name
            results.push({ name: '/' + name, description: desc, source: 'prompt' })
          } catch {}
        }
      } catch {}
      return results
    }

    // Try RPC first
    try {
      const rpcCommands = await manager.getCommands()
      if (rpcCommands && rpcCommands.length > 0) {
        const merged: { name: string; description: string; source: string }[] = [...SLASH_BUILTINS]
        for (const c of rpcCommands) {
          merged.push({ name: '/' + c.name, description: c.description || '', source: c.source || 'extension' })
        }
        merged.push(...scanPromptTemplates())
        return res.json(dedup(merged))
      }
    } catch {}

    // Fallback: scan files
    const commands: { name: string; description: string; source: string }[] = []
    commands.push(...SLASH_BUILTINS, { name: '/import', description: 'Import and resume a session', source: 'builtin' })
    commands.push(...scanPromptTemplates())

    // Extension-registered commands
    const extDir = join(os.homedir(), '.pi', 'agent', 'extensions')
    try {
      const scan = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === 'node_modules') continue
          const full = join(dir, entry.name)
          if (entry.isDirectory()) { scan(full); continue }
          if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.js')) continue
          try {
            const src = readFileSync(full, 'utf-8')
            const re = /registerCommand\("([^"]+)"[^}]*description:\s*"([^"]+)"/g
            let m: RegExpExecArray | null
            while ((m = re.exec(src)) !== null) {
              commands.push({ name: '/' + m[1], description: m[2], source: 'extension' })
            }
          } catch {}
        }
      }
      scan(extDir)
    } catch {}

    // Skill commands
    const skillDir = join(os.homedir(), '.pi', 'agent', 'skills')
    try {
      for (const entry of readdirSync(skillDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const skillMd = join(skillDir, entry.name, 'SKILL.md')
        try {
          const content = readFileSync(skillMd, 'utf-8')
          const descMatch = content.match(/description:\s*(.+)/)
          const desc = descMatch ? descMatch[1].trim().slice(0, 80) : entry.name
          commands.push({ name: '/' + entry.name, description: desc, source: 'skill' })
        } catch {}
      }
    } catch {}

    res.json(dedup(commands))
  })
}
