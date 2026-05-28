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
import * as piEnv from '../pi-env.js'

export function registerChatRoutes(deps: RouteDeps): void {
  const { app, manager, broadcast, broadcastSlots, persistSlots, notifications, addNotification, wireSlotEvents } = deps

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
      const result = await pi.request({ type: 'fork', entryId })
      if (result.data?.cancelled) return res.json({ ok: false, cancelled: true })
      const state = await pi.request({ type: 'get_state' })
      const forkedSessionFile = state.data?.sessionFile || null
      const forkedMessages = forkedSessionFile ? parseSessionMessages(forkedSessionFile, 200) : []
      const text = result.data?.text || ''
      const forkSlot = manager.createSlot('Fork: ' + text.slice(0, 40), null, {
        messages: forkedMessages,
        sessionFile: forkedSessionFile,
        title: 'Fork: ' + text.slice(0, 40),
        modelProvider: pi.modelProvider,
        modelId: pi.modelId,
        cwd: pi.cwd,
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
      const result = await pi.request({ type: 'get_fork_messages' })
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
      res.json({ models })
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
    if (pi.proc && pi.ready) {
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
    if (pi.proc && pi.ready) {
      try { await pi.setThinkingLevel(level) } catch {}
    }
    broadcastSlots()
    res.json({ ok: true })
  })

  // Set CWD for a slot (before process starts)
  app.post('/api/chat/slots/:key/cwd', (req: Request, res: Response) => {
    const { cwd } = req.body
    const pi = manager.getSlot(req.params.key as string)
    if (!pi) return res.status(404).json({ error: 'slot not found' })
    pi.cwd = cwd === '~' ? os.homedir() : cwd.startsWith('~/') ? join(os.homedir(), cwd.slice(2)) : cwd
    if (pi.proc && pi.messages.length === 0) {
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
      const contextFiles = loadProjectContextFiles({ cwd })
      const { skills } = loadSkills({ cwd })
      const staticPrompt = buildSystemPrompt({ cwd, contextFiles, skills })

      let memoryBlock = ''
      let memoryStats = { semantic: 0, lessons: 0 }
      try {
        const piMemoryCandidates = [
          join(os.homedir(), 'Projects', 'pi-memory'),
          join(os.homedir(), 'scratch', 'pi-memory'),
        ]
        const piMemoryPkg = piMemoryCandidates.find(p => { try { statSync(join(p, 'package.json')); return true } catch { return false } }) || piMemoryCandidates[0]
        const Module = await import('module')
        const req = Module.default.createRequire(join(piMemoryPkg, 'package.json'))
        const { MemoryStore } = req('./dist/store.js')
        const { buildContextBlock } = req('./dist/injector.js')
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
