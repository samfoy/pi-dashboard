/**
 * Session routes — search, list, resume, host sessions, restart
 */
import { Request, Response } from 'express'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import os from 'os'
import { DatabaseSync } from 'node:sqlite'
import type { RouteDeps } from './types.js'
import * as piEnv from '../pi-env.js'

const SESSION_INDEX_DIR = join(os.homedir(), '.pi', 'session-search', 'index')

// ─── Session search (FTS5 + session-index.json) ─────────────────────
interface SessionSearchResult {
  id: string
  name: string
  file: string
  cwd: string
  startedAt: string
  projectSlug: string
  summary: string
  userMessageCount: number
  assistantMessageCount: number
  models: string[]
}

function toFtsQuery(q: string): string {
  const tokens = q.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return ''
  return tokens.map(t => `"${t}"*`).join(' OR ')
}

function searchSessionIndex(query: string, limit: number): SessionSearchResult[] {
  const ftsDbPath = join(SESSION_INDEX_DIR, 'hybrid-fts.db')
  const indexJsonPath = join(SESSION_INDEX_DIR, 'session-index.json')

  // Load metadata from session-index.json
  let sessions: Record<string, any> = {}
  try {
    const raw = readFileSync(indexJsonPath, 'utf8')
    sessions = JSON.parse(raw).sessions || {}
  } catch { /* index not built yet */ }

  // Query FTS5 for ranked IDs
  const ftsQuery = toFtsQuery(query)
  if (!ftsQuery) return []

  let ftsIds: string[] = []
  try {
    const db = new DatabaseSync(ftsDbPath, { open: true })
    const stmt = db.prepare(`SELECT id FROM sessions_fts WHERE sessions_fts MATCH ? ORDER BY rank LIMIT ?`)
    const rows = stmt.all(ftsQuery, limit) as { id: string }[]
    ftsIds = rows.map(r => r.id)
    db.close()
  } catch { /* FTS DB not available */ }

  // Map IDs back to full metadata
  return ftsIds.map(id => {
    const entry = sessions[id]
    if (!entry) return null
    const s = entry.session
    return {
      id: s.id,
      name: s.name || (s.firstUserMessage || '').slice(0, 100),
      file: s.file,
      cwd: s.cwd,
      startedAt: s.startedAt,
      projectSlug: s.projectSlug,
      summary: entry.summary || '',
      userMessageCount: s.userMessageCount || 0,
      assistantMessageCount: s.assistantMessageCount || 0,
      models: s.models || [],
    }
  }).filter((r): r is SessionSearchResult => r !== null)
}

function listRecentSessions(limit: number): SessionSearchResult[] {
  const indexJsonPath = join(SESSION_INDEX_DIR, 'session-index.json')
  let sessions: Record<string, any> = {}
  try {
    const raw = readFileSync(indexJsonPath, 'utf8')
    sessions = JSON.parse(raw).sessions || {}
  } catch { return [] }

  return Object.values(sessions)
    .map((entry: any) => {
      const s = entry.session
      return {
        id: s.id,
        name: s.name || (s.firstUserMessage || '').slice(0, 100),
        file: s.file,
        cwd: s.cwd,
        startedAt: s.startedAt,
        projectSlug: s.projectSlug,
        summary: entry.summary || '',
        userMessageCount: s.userMessageCount || 0,
        assistantMessageCount: s.assistantMessageCount || 0,
        models: s.models || [],
      } as SessionSearchResult
    })
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
    .slice(0, limit)
}

export function registerSessionRoutes(deps: RouteDeps): void {
  const { app, manager, persistSlots, shutdownPty } = deps

  // Session search (uses pi-session-search FTS5 index)
  app.get('/api/sessions/search', (req: Request, res: Response) => {
    const query = (req.query.q as string || '').trim()
    const limit = Math.min(parseInt(req.query.limit as string || '20', 10), 50)
    if (!query) {
      try {
        const results = listRecentSessions(limit)
        return res.json({ results })
      } catch (err: any) {
        return res.json({ results: [], error: err.message })
      }
    }
    try {
      const results = searchSessionIndex(query, limit)
      res.json({ results })
    } catch (err: any) {
      res.json({ results: [], error: err.message })
    }
  })

  // Sessions history
  app.get('/api/sessions', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string || '30', 10)
    const sessions = piEnv.getRecentSessions(limit)
    res.json({ sessions, has_more: false })
  })
  app.delete('/api/sessions/:key', (_req: Request, res: Response) => res.json({ ok: true }))
  app.delete('/api/sessions', (_req: Request, res: Response) => res.json({ ok: true }))

  // Sessions context/usage (stubs)
  app.get('/api/sessions/context', (_req: Request, res: Response) => res.json({}))
  app.get('/api/sessions/usage', (_req: Request, res: Response) => res.json({}))
  app.post('/api/sessions/restart', (_req: Request, res: Response) => {
    res.json({ ok: true })
    console.log('🔄 Restart requested via API — persisting state and gracefully shutting down...')
    setTimeout(() => {
      persistSlots()
      manager.gracefulShutdown(55000).finally(() => {
        shutdownPty()
        process.exit(0)
      })
      setTimeout(() => { shutdownPty(); process.exit(0) }, 60000).unref()
    }, 500)
  })

  // Host pi sessions (tmux scan)
  app.get('/api/host-sessions', (_req: Request, res: Response) => {
    try {
      const sessions: any[] = []
      let panes: string[]
      try {
        panes = execSync("tmux list-panes -a -F '#{session_name}|#{window_index}|#{pane_index}|#{pane_pid}|#{pane_current_command}|#{pane_current_path}|#{window_name}|#{pane_width}x#{pane_height}' 2>/dev/null", { encoding: 'utf-8' }).trim().split('\n').filter(Boolean)
      } catch { return res.json({ sessions: [] }) }

      for (const pane of panes) {
        const [sname, widx, pidx, ppid, cmd, cpath, wname, size] = pane.split('|')
        if (cmd !== 'pi') continue
        if (sname === 'pi-dash') continue

        let lastOutput = ''
        let model = '', contextPct = '', uptime = ''
        try {
          const captured = execSync(`tmux capture-pane -t ${JSON.stringify(sname + ':' + widx + '.' + pidx)} -p -S -10 2>/dev/null`, { encoding: 'utf-8', timeout: 2000 })
          const lines = captured.split('\n').filter((l: string) => l.trim())
          for (const line of lines) {
            const mMatch = line.match(/^\S\s+([\w][-\w.]*)\s+\|/)
            if (mMatch) model = mMatch[1]
            const cMatch = line.match(/ctx:\s*(\d+%)/)
            if (cMatch) contextPct = cMatch[1]
            const tMatch = line.match(/(\d+h\d+m|\d+m\d+s)/)
            if (tMatch) uptime = tMatch[1]
          }
          for (let i = lines.length - 2; i >= 0; i--) {
            const l = lines[i].trim()
            if (l && !l.match(/^[─━═]+$/) && !l.startsWith('ctx:') && !l.match(/^\S\s+[\w][-\w.]*\s+\|/)) {
              lastOutput = l.slice(0, 200)
              break
            }
          }
        } catch {}

        let sessionFile = ''
        try {
          const sessDir = '--' + cpath.replace(/\//g, '-').replace(/^-/, '') + '--'
          const sessPath = join(os.homedir(), '.pi', 'agent', 'sessions', sessDir)
          const files = readdirSync(sessPath).filter(f => f.endsWith('.jsonl')).sort().reverse()
          if (files.length > 0) sessionFile = join(sessPath, files[0])
        } catch {}

        sessions.push({
          tmuxSession: sname,
          tmuxWindow: parseInt(widx),
          tmuxPane: parseInt(pidx),
          pid: parseInt(ppid),
          cwd: cpath,
          windowName: wname,
          size,
          model,
          contextPct,
          uptime,
          lastOutput,
          attachCmd: `tmux attach -t ${sname}`,
          sessionFile,
        })
      }
      res.json({ sessions })
    } catch (e: any) {
      res.json({ sessions: [], error: e.message })
    }
  })
}
