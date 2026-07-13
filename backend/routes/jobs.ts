import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import type { Request, Response, RouteDeps } from './types.js'

interface ScheduledJob {
  id: string
  name: string
  prompt: string
  cron: string
  cwd?: string | null
  model?: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastRunAt?: string | null
  lastStatus?: 'success' | 'failed' | 'running' | null
  lastRunId?: string | null
}

interface JobRun {
  id: string
  jobId: string
  slotKey: string
  status: 'running' | 'success' | 'failed'
  startedAt: string
  finishedAt?: string | null
  error?: string | null
}

interface JobStore {
  jobs: ScheduledJob[]
  runs: JobRun[]
}

const STORE_PATH = join(os.homedir(), '.pi', 'dashboard-jobs.json')
const MAX_RUNS = 200
let store: JobStore = loadStore()
let schedulerStarted = false
let lastCheckedMinute = ''

function nowIso(): string { return new Date().toISOString() }

function loadStore(): JobStore {
  try {
    if (!existsSync(STORE_PATH)) return { jobs: [], runs: [] }
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf-8')) as Partial<JobStore>
    return {
      jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
      runs: Array.isArray(raw.runs) ? raw.runs : [],
    }
  } catch {
    return { jobs: [], runs: [] }
  }
}

function saveStore(): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true })
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + '\n')
}

function parseField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const rawPart of field.split(',')) {
    const part = rawPart.trim()
    if (!part) return null
    const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/)
    let rangePart = part
    let step = 1
    if (stepMatch) {
      rangePart = stepMatch[1]
      step = Number(stepMatch[2])
      if (!Number.isInteger(step) || step <= 0) return null
    }
    let start = min
    let end = max
    if (rangePart !== '*') {
      const rangeMatch = rangePart.match(/^(\d+)(?:-(\d+))?$/)
      if (!rangeMatch) return null
      start = Number(rangeMatch[1])
      end = rangeMatch[2] ? Number(rangeMatch[2]) : start
    }
    if (start < min || end > max || start > end) return null
    for (let i = start; i <= end; i += step) out.add(i)
  }
  return out
}

function parseCron(cron: string): Array<Set<number>> | null {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const ranges: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
  const parsed = fields.map((field, idx) => parseField(field, ranges[idx][0], ranges[idx][1]))
  if (parsed.some(v => !v)) return null
  // Treat 7 as Sunday too.
  if (parsed[4]!.has(7)) parsed[4]!.add(0)
  return parsed as Array<Set<number>>
}

function cronMatches(cron: string, date: Date): boolean {
  const p = parseCron(cron)
  if (!p) return false
  return p[0].has(date.getUTCMinutes()) &&
    p[1].has(date.getUTCHours()) &&
    p[2].has(date.getUTCDate()) &&
    p[3].has(date.getUTCMonth() + 1) &&
    p[4].has(date.getUTCDay())
}

function nextRun(cron: string, from = new Date()): string | null {
  if (!parseCron(cron)) return null
  const d = new Date(from)
  d.setUTCSeconds(0, 0)
  d.setUTCMinutes(d.getUTCMinutes() + 1)
  for (let i = 0; i < 60 * 24 * 31; i++) {
    if (cronMatches(cron, d)) return d.toISOString()
    d.setUTCMinutes(d.getUTCMinutes() + 1)
  }
  return null
}

function publicJob(job: ScheduledJob): ScheduledJob & { nextRunAt: string | null } {
  return { ...job, nextRunAt: job.enabled ? nextRun(job.cron) : null }
}

function normalizeCwd(cwd: unknown): string | null {
  if (!cwd) return null
  const raw = String(cwd)
  return raw === '~' ? os.homedir() : raw.startsWith('~/') ? join(os.homedir(), raw.slice(2)) : raw
}

function splitModel(model: unknown): { modelProvider: string | null; modelId: string | null; model: string | null } {
  if (!model || typeof model !== 'string' || !model.includes('/')) return { modelProvider: null, modelId: null, model: null }
  const idx = model.indexOf('/')
  return { modelProvider: model.slice(0, idx), modelId: model.slice(idx + 1), model }
}

async function runJob(deps: RouteDeps, job: ScheduledJob, triggeredBy: 'schedule' | 'manual'): Promise<JobRun> {
  const { modelProvider, modelId } = splitModel(job.model)
  const slot = deps.manager.createSlot(`Job: ${job.name}`, null, {
    cwd: normalizeCwd(job.cwd),
    modelProvider,
    modelId,
    tags: ['job', job.id],
    // Scheduled/manual jobs run unattended in the background — pin to the
    // isolated RPC subprocess transport (design decision #2). Without this,
    // the slice-10 foreground `sdk` default would run jobs in-process, so a
    // job's WASM-OOM/crash would take down all slots + the server.
    transport: 'rpc',
  })
  const pi = deps.manager.getSlot(slot.key)!
  if (!pi._wired) { deps.wireSlotEvents(pi, slot.key); pi._wired = true }
  const run: JobRun = {
    id: randomUUID(),
    jobId: job.id,
    slotKey: slot.key,
    status: 'running',
    startedAt: nowIso(),
  }
  store.runs.unshift(run)
  store.runs = store.runs.slice(0, MAX_RUNS)
  job.lastRunAt = run.startedAt
  job.lastRunId = run.id
  job.lastStatus = 'running'
  job.updatedAt = nowIso()
  saveStore()
  deps.broadcastSlots()
  deps.broadcast('jobs', listPayload())
  deps.addNotification({ kind: 'job', title: `Started job: ${job.name}`, body: triggeredBy === 'manual' ? 'Manual run started.' : 'Scheduled run started.', slot: slot.key, job_id: job.id })

  const finish = (status: 'success' | 'failed', error?: string): void => {
    if (run.status !== 'running') return
    run.status = status
    run.finishedAt = nowIso()
    run.error = error || null
    job.lastStatus = status
    job.updatedAt = nowIso()
    saveStore()
    deps.broadcast('jobs', listPayload())
    deps.addNotification({ kind: status === 'success' ? 'job' : 'error', title: `${status === 'success' ? 'Completed' : 'Failed'} job: ${job.name}`, body: status === 'success' ? `Result is in ${slot.key}.` : (error || 'Run failed.'), slot: slot.key, job_id: job.id })
  }

  pi.once('agent_end', () => finish('success'))
  pi.once('exit', (code: number | null) => finish('failed', `Pi process exited${code === null ? '' : ` with code ${code}`}`))

  try {
    const running = deps.manager.ensureRunning(slot.key)
    if (!running) throw new Error('slot not found after creation')
    await running.prompt(job.prompt)
  } catch (e: any) {
    finish('failed', e?.message || 'Unable to start job')
  }
  return run
}

function listPayload(): { jobs: ReturnType<typeof publicJob>[]; runs: JobRun[] } {
  return { jobs: store.jobs.map(publicJob), runs: store.runs }
}

function startScheduler(deps: RouteDeps): void {
  if (schedulerStarted || process.env.VITEST) return
  schedulerStarted = true
  setInterval(() => {
    const now = new Date()
    const minuteKey = now.toISOString().slice(0, 16)
    if (minuteKey === lastCheckedMinute) return
    lastCheckedMinute = minuteKey
    for (const job of store.jobs) {
      if (!job.enabled || !parseCron(job.cron)) continue
      if (!cronMatches(job.cron, now)) continue
      const running = store.runs.some(r => r.jobId === job.id && r.status === 'running')
      if (running) continue
      runJob(deps, job, 'schedule').catch(e => console.error('[jobs] run failed', e))
    }
  }, 15_000)
}

export function registerJobsRoutes(deps: RouteDeps): void {
  const { app } = deps
  startScheduler(deps)

  app.get('/api/jobs', (_req: Request, res: Response) => res.json(listPayload()))

  app.post('/api/jobs', (req: Request, res: Response) => {
    const name = String(req.body?.name || '').trim()
    const prompt = String(req.body?.prompt || '').trim()
    const cron = String(req.body?.cron || '').trim()
    if (!name || !prompt || !cron) return res.status(400).json({ error: 'name, prompt, and cron are required' })
    if (!parseCron(cron)) return res.status(400).json({ error: 'cron must have 5 fields: minute hour day month weekday' })
    const job: ScheduledJob = {
      id: randomUUID(),
      name,
      prompt,
      cron,
      cwd: normalizeCwd(req.body?.cwd),
      model: splitModel(req.body?.model).model,
      enabled: req.body?.enabled !== false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastRunAt: null,
      lastStatus: null,
      lastRunId: null,
    }
    store.jobs.unshift(job)
    saveStore()
    deps.broadcast('jobs', listPayload())
    res.json({ ok: true, job: publicJob(job) })
  })

  app.patch('/api/jobs/:id', (req: Request, res: Response) => {
    const job = store.jobs.find(j => j.id === req.params.id)
    if (!job) return res.status(404).json({ error: 'job not found' })
    if (req.body?.name !== undefined) job.name = String(req.body.name).trim() || job.name
    if (req.body?.prompt !== undefined) job.prompt = String(req.body.prompt).trim() || job.prompt
    if (req.body?.cron !== undefined) {
      const cron = String(req.body.cron).trim()
      if (!parseCron(cron)) return res.status(400).json({ error: 'cron must have 5 fields: minute hour day month weekday' })
      job.cron = cron
    }
    if (req.body?.cwd !== undefined) job.cwd = normalizeCwd(req.body.cwd)
    if (req.body?.model !== undefined) job.model = splitModel(req.body.model).model
    if (req.body?.enabled !== undefined) job.enabled = !!req.body.enabled
    job.updatedAt = nowIso()
    saveStore()
    deps.broadcast('jobs', listPayload())
    res.json({ ok: true, job: publicJob(job) })
  })

  app.delete('/api/jobs/:id', (req: Request, res: Response) => {
    const before = store.jobs.length
    store.jobs = store.jobs.filter(j => j.id !== req.params.id)
    if (store.jobs.length === before) return res.status(404).json({ error: 'job not found' })
    saveStore()
    deps.broadcast('jobs', listPayload())
    res.json({ ok: true })
  })

  app.post('/api/jobs/:id/run', async (req: Request, res: Response) => {
    const job = store.jobs.find(j => j.id === req.params.id)
    if (!job) return res.status(404).json({ error: 'job not found' })
    const running = store.runs.some(r => r.jobId === job.id && r.status === 'running')
    if (running) return res.status(409).json({ error: 'job already running' })
    const run = await runJob(deps, job, 'manual')
    res.json({ ok: true, run })
  })
}
