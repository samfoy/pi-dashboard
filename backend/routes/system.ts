/**
 * System routes — status, pi environment, skills, memory, config, workspaces, packages
 */
import { Request, Response } from 'express'
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { execSync } from 'child_process'
import { promisify } from 'util'
import { exec } from 'child_process'
import os from 'os'
import type { RouteDeps } from './types.js'
import * as piEnv from '../pi-env.js'

const execAsync = promisify(exec)
const PI_AGENT_DIR = join(os.homedir(), '.pi', 'agent')

export function registerSystemRoutes(deps: RouteDeps): void {
  const { app, manager } = deps

  app.get('/api/status', (_req: Request, res: Response) => res.json(manager.status()))

  app.get('/api/system', async (_req: Request, res: Response) => {
    const mem = os.totalmem()
    const free = os.freemem()
    const used = mem - free
    const toGB = (b: number): string => (b / 1073741824).toFixed(1)
    const cpus = os.cpus()
    const load = os.loadavg()

    // Disk usage
    let diskTotal: string | number = '', diskFree: string | number = ''
    try {
      const dfCmd = process.platform === 'darwin' ? "df -g / | tail -1" : "df -BG / | tail -1"
      const { stdout: dfOut } = await execAsync(dfCmd, { timeout: 2000 })
      const df = dfOut.trim().split(/\s+/)
      diskTotal = parseFloat(df[1])
      diskFree = parseFloat(df[3])
    } catch {}

    // IP
    let ip = ''
    try {
      const nets = os.networkInterfaces()
      for (const iface of Object.values(nets)) {
        for (const cfg of iface || []) {
          if (cfg.family === 'IPv4' && !cfg.internal) { ip = cfg.address; break }
        }
        if (ip) break
      }
    } catch {}

    // Process info
    let procMem: string = '', procCpu: string = '', childProcs: string = '', threads: string = ''
    try {
      procMem = (process.memoryUsage.rss() / 1048576).toFixed(1)
    } catch {}
    try {
      if (process.platform === 'darwin') {
        const { stdout: psOut } = await execAsync(`ps -o rss= -p ${process.pid}`, { timeout: 2000 })
        if (!procMem) procMem = (parseInt(psOut.trim()) / 1024).toFixed(1)
      } else {
        const { stdout: psOut2 } = await execAsync(`ps -o rss=,nlwp= -p ${process.pid}`, { timeout: 2000 })
        const ps = psOut2.trim().split(/\s+/)
        if (!procMem) procMem = (parseInt(ps[0]) / 1024).toFixed(1)
        threads = ps[1]
      }
    } catch {}
    try {
      const { stdout: pgrepOut } = await execAsync(`pgrep -c -P ${process.pid} 2>/dev/null || echo 0`, { timeout: 2000 })
      childProcs = pgrepOut.trim()
    } catch {}

    // CPU usage
    const cpuTimes = cpus.reduce((a, c) => {
      a.idle += c.times.idle; a.total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq
      return a
    }, { idle: 0, total: 0 })
    const cpuPct = (100 - (cpuTimes.idle / cpuTimes.total * 100)).toFixed(1)

    res.json({
      hostname: os.hostname(),
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpu_count: cpus.length,
      cpu_pct: parseFloat(cpuPct),
      load_1m: load[0].toFixed(2),
      load_5m: load[1].toFixed(2),
      load_15m: load[2].toFixed(2),
      mem_total_gb: toGB(mem),
      mem_used_gb: toGB(used),
      mem_free_gb: toGB(free),
      disk_total_gb: diskTotal || '—',
      disk_free_gb: diskFree || '—',
      ip,
      pid: process.pid,
      python: '—',
      proc_mem_mb: procMem || '—',
      proc_cpu_pct: null,
      child_processes: childProcs || '0',
      thread_count: threads || '—',
      cwd: process.cwd(),
      ollama_running: false,
      net_rx_kbs: null,
      net_tx_kbs: null,
    })
  })

  // Skills
  app.get('/api/skills', (_req: Request, res: Response) => res.json(piEnv.getSkills()))

  app.get('/api/skills/:name/files', (req: Request, res: Response) => {
    const skillDir = join(os.homedir(), '.pi', 'agent', 'skills', req.params.name as string)
    try {
      const files: string[] = []
      const walk = (dir: string, prefix: string): void => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? prefix + '/' + e.name : e.name
          if (e.isDirectory()) walk(join(dir, e.name), rel)
          else files.push(rel)
        }
      }
      walk(skillDir, '')
      res.json({ name: req.params.name as string, files })
    } catch (e: any) {
      res.status(e.code === 'ENOENT' ? 404 : 500).json({ error: e.message })
    }
  })

  app.get('/api/skills/:name/file', (req: Request, res: Response) => {
    const filePath = req.query.path as string
    if (!filePath) return res.status(400).json({ error: 'path query param required' })
    if (filePath.includes('..')) return res.status(400).json({ error: 'invalid path' })
    const full = join(os.homedir(), '.pi', 'agent', 'skills', req.params.name as string, filePath)
    try {
      res.json({ content: readFileSync(full, 'utf-8') })
    } catch (e: any) {
      res.status(e.code === 'ENOENT' ? 404 : 500).json({ error: e.message })
    }
  })

  app.put('/api/skills/:name/file', (req: Request, res: Response) => {
    const { path: filePath, content } = req.body
    if (!filePath || content == null) return res.status(400).json({ error: 'path and content required' })
    if (filePath.includes('..')) return res.status(400).json({ error: 'invalid path' })
    const full = join(os.homedir(), '.pi', 'agent', 'skills', req.params.name as string, filePath)
    try {
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content, 'utf-8')
      res.json({ ok: true })
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })

  // Pi agent file browser
  app.get('/api/pi/files', (req: Request, res: Response) => {
    const sub = (req.query.dir as string) || ''
    if (sub.includes('..')) return res.status(400).json({ error: 'invalid path' })
    const target = sub ? join(PI_AGENT_DIR, sub) : PI_AGENT_DIR
    try {
      const entries = readdirSync(target, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'sessions' && e.name !== 'sessions-archive')
        .map(e => ({ name: e.name, isDir: e.isDirectory() }))
        .sort((a, b) => a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1)
      res.json({ dir: sub || '.', entries })
    } catch (e: any) {
      res.status(e.code === 'ENOENT' ? 404 : 500).json({ error: e.message })
    }
  })

  app.get('/api/pi/file', (req: Request, res: Response) => {
    const filePath = req.query.path as string
    if (!filePath || filePath.includes('..')) return res.status(400).json({ error: 'invalid path' })
    try {
      res.json({ content: readFileSync(join(PI_AGENT_DIR, filePath), 'utf-8') })
    } catch (e: any) {
      res.status(e.code === 'ENOENT' ? 404 : 500).json({ error: e.message })
    }
  })

  app.put('/api/pi/file', (req: Request, res: Response) => {
    const { path: filePath, content } = req.body
    if (!filePath || content == null || filePath.includes('..')) return res.status(400).json({ error: 'invalid path or content' })
    const full = join(PI_AGENT_DIR, filePath)
    try {
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content, 'utf-8')
      res.json({ ok: true })
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })

  // Crons, Lessons, Hooks
  app.get('/api/crons', (_req: Request, res: Response) => res.json(piEnv.getCrontab()))
  app.get('/api/lessons', (_req: Request, res: Response) => res.json(piEnv.getLessons()))
  app.get('/api/hooks', (_req: Request, res: Response) => res.json([]))

  // MCP (stubs)
  app.get('/api/mcp', (_req: Request, res: Response) => res.json([]))
  app.get('/api/mcp/active', (_req: Request, res: Response) => res.json([]))
  app.get('/api/mcp/probe', (_req: Request, res: Response) => res.json({ results: {} }))
  app.post('/api/mcp/probe', (_req: Request, res: Response) => res.json({ results: {} }))

  // Memory
  app.get('/api/memory/preferences', (_req: Request, res: Response) => res.json({ content: JSON.stringify(piEnv.getFacts(), null, 2) }))
  app.get('/api/memory/projects', (_req: Request, res: Response) => res.json({ content: '' }))
  app.get('/api/memory/history', (_req: Request, res: Response) => res.json({ content: '' }))
  app.get('/api/memory/settings', (_req: Request, res: Response) => res.json({}))
  app.get('/api/memory/stats', (_req: Request, res: Response) => res.json(piEnv.getMemoryStats()))
  app.get('/api/memory/embedding-status', (_req: Request, res: Response) => res.json({ enabled: false }))
  app.put('/api/memory/preferences', (_req: Request, res: Response) => res.json({ ok: true }))
  app.put('/api/memory/projects', (_req: Request, res: Response) => res.json({ ok: true }))
  app.put('/api/memory/history', (_req: Request, res: Response) => res.json({ ok: true }))

  // Agent config (stubs)
  app.get('/api/agent/config', (_req: Request, res: Response) => res.json({}))
  app.put('/api/agent/config', (_req: Request, res: Response) => res.json({ ok: true }))
  app.get('/api/config/default-agent', (_req: Request, res: Response) => res.json({ agent: 'default' }))
  app.put('/api/config/default-agent', (_req: Request, res: Response) => res.json({ ok: true }))
  app.get('/api/agents/installed', (_req: Request, res: Response) => res.json([]))

  // Pi environment APIs
  app.get('/api/pi/extensions', (_req: Request, res: Response) => res.json(piEnv.getExtensions()))

  // Dashboard config
  app.get('/api/dash/config', (_req: Request, res: Response) => res.json(piEnv.getDashConfig()))
  app.put('/api/dash/config', (req: Request, res: Response) => {
    try {
      const saved = piEnv.saveDashConfig(req.body)
      res.json(saved)
    } catch (e: any) { res.status(500).json({ error: e.message }) }
  })

  // Vault
  app.get('/api/pi/vault', (_req: Request, res: Response) => res.json(piEnv.getVaultStats()))
  app.get('/api/pi/vault/daily', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string || '7', 10)
    res.json(piEnv.getRecentDailyNotes(limit))
  })
  app.get('/api/pi/vault/daily/:date', (req: Request, res: Response) => {
    const content = piEnv.getDailyNote(req.params.date as string)
    if (!content) return res.status(404).json({ error: 'not found' })
    res.json({ date: req.params.date as string, content })
  })
  app.get('/api/pi/crontab', (_req: Request, res: Response) => res.json(piEnv.getCrontab()))
  app.get('/api/pi/memory', (_req: Request, res: Response) => {
    res.json({
      stats: piEnv.getMemoryStats(),
      facts: piEnv.getFacts(),
      lessons: piEnv.getLessons(50),
    })
  })

  // Task runner (stubs)
  app.get('/api/taskrunner', (_req: Request, res: Response) => res.json({ tasks: [] }))

  // Logs (stubs)
  app.get('/api/logs/level', (_req: Request, res: Response) => res.json({ level: 'info' }))
  app.post('/api/logs/level', (_req: Request, res: Response) => res.json({ ok: true }))

  // Update (stubs)
  app.get('/api/update/check', (_req: Request, res: Response) => res.json({ available: false }))
  app.get('/api/changelog', (_req: Request, res: Response) => res.json({ content: '' }))

  // Workspaces
  app.get('/api/workspaces', (_req: Request, res: Response) => {
    const dirs: { name: string; path: string }[] = []
    const wsDir = process.env.WORKSPACE_DIR
    if (wsDir) {
      try {
        for (const ws of readdirSync(wsDir)) {
          const full = `${wsDir}/${ws}`
          if (statSync(full).isDirectory()) dirs.push({ name: ws, path: full })
        }
      } catch {}
    }
    dirs.push({ name: '~', path: os.homedir() })
    dirs.push({ name: 'pi-dashboard', path: join(os.homedir(), 'pi-dashboard') })
    res.json({ workspaces: dirs })
  })

  // Pi settings
  app.get('/api/pi/settings', (_req: Request, res: Response) => {
    try {
      const settingsPath = join(os.homedir(), '.pi', 'agent', 'settings.json')
      const content = readFileSync(settingsPath, 'utf-8')
      res.json(JSON.parse(content))
    } catch (e: any) { res.json({}) }
  })

  app.put('/api/pi/settings', (req: Request, res: Response) => {
    try {
      const settingsPath = join(os.homedir(), '.pi', 'agent', 'settings.json')
      writeFileSync(settingsPath, JSON.stringify(req.body, null, 2) + '\n')
      res.json({ ok: true })
    } catch (e: any) { res.status(500).json({ error: e.message }) }
  })

  // Package management
  app.post('/api/pi/packages/install', (req: Request, res: Response) => {
    const { source } = req.body
    if (!source) return res.status(400).json({ error: 'source required' })
    try {
      const out = execSync(`pi install ${JSON.stringify(source)} 2>&1`, { encoding: 'utf-8', timeout: 60000 })
      res.json({ ok: true, output: out })
    } catch (e: any) { res.status(500).json({ error: e.stderr || e.message }) }
  })

  app.post('/api/pi/packages/remove', (req: Request, res: Response) => {
    const { source } = req.body
    if (!source) return res.status(400).json({ error: 'source required' })
    try {
      const out = execSync(`pi remove ${JSON.stringify(source)} 2>&1`, { encoding: 'utf-8', timeout: 30000 })
      res.json({ ok: true, output: out })
    } catch (e: any) { res.status(500).json({ error: e.stderr || e.message }) }
  })

  // Package gallery (npm search)
  app.get('/api/pi/gallery', async (_req: Request, res: Response) => {
    try {
      const resp = await fetch('https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=50')
      const data = await resp.json() as any
      const packages = (data.objects || []).map((o: any) => ({
        name: o.package.name,
        description: o.package.description || '',
        version: o.package.version,
        author: o.package.author?.name || o.package.publisher?.username || '',
        date: o.package.date,
        links: o.package.links || {},
      }))
      res.json({ packages })
    } catch (e: any) { res.json({ packages: [], error: e.message }) }
  })
}
