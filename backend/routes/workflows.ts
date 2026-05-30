/**
 * Workflow routes — pi-workflows run history and script discovery.
 *
 * Reads from ~/.pi/agent/workflows/runs/ (each subdirectory is one run).
 * Per-run data comes from:
 *   - manifest.json  → runId, workflowName, startedAt, cwd
 *   - result.json    → outcome, endedAt, durationMs, error, agentCount (terminal runs)
 *   - ledger.jsonl   → current state (for active/non-terminal runs)
 *
 * Scripts are discovered from:
 *   - ~/.pi/agent/workflows/*.js  (user scope)
 */
import { Request, Response } from 'express'
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import type { RouteDeps } from './types.js'

// ─── Paths ───────────────────────────────────────────────────────────────────

function workflowsHome(): string {
  return join(homedir(), '.pi', 'agent', 'workflows')
}

function runsHome(): string {
  return join(workflowsHome(), 'runs')
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkflowManifest {
  runId: string
  workflowName: string
  startedAt: string
  cwd: string
  input?: string
  piWorkflowsVersion?: string
  options?: {
    mockAgents?: boolean
    maxConcurrent?: number
  }
}

interface WorkflowResult {
  runId: string
  workflowName: string
  outcome: string
  startedAt: string
  endedAt?: string
  durationMs?: number
  result?: unknown
  error?: { name: string; message: string } | null
  agentCount?: number
  finishCallbackPrompt?: string | null
  approval?: {
    approved: boolean
    reason?: string
    cancelCause?: string
  } | null
}

type RunState =
  | 'pending'
  | 'approved'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'cancelled-pre-run'

const TERMINAL_STATES = new Set(['done', 'failed', 'stopped', 'cancelled-pre-run'])

interface RunSummary {
  runId: string
  workflowName: string
  state: RunState
  startedAt: string
  endedAt?: string
  durationMs?: number
  cwd?: string
  agentCount?: number
  error?: { name: string; message: string } | null
  result?: string | null  // serialized, only in detail
  input?: string
  piWorkflowsVersion?: string
}

interface LedgerEntry {
  type: string
  at: string
  from?: string
  to?: string
  outcome?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

/**
 * Derive current state from ledger.jsonl for active (non-terminal) runs.
 * Reads the last transition entry.
 */
function deriveStateFromLedger(ledgerPath: string): RunState {
  try {
    const lines = readFileSync(ledgerPath, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
    let state: RunState = 'pending'
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LedgerEntry
        if (entry.type === 'transition' && entry.to) {
          state = entry.to as RunState
        }
      } catch {
        // skip malformed lines
      }
    }
    return state
  } catch {
    return 'pending'
  }
}

/**
 * Build a RunSummary by reading manifest + result (+ ledger fallback).
 */
function buildRunSummary(runDir: string): RunSummary | null {
  const manifestPath = join(runDir, 'manifest.json')
  if (!existsSync(manifestPath)) return null

  const manifest = readJson<WorkflowManifest>(manifestPath)
  if (!manifest) return null

  const resultPath = join(runDir, 'result.json')
  const result = readJson<WorkflowResult>(resultPath)

  if (result) {
    // Terminal run — result.json is authoritative
    return {
      runId: manifest.runId,
      workflowName: manifest.workflowName,
      state: result.outcome as RunState,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      durationMs: result.durationMs,
      cwd: manifest.cwd,
      agentCount: result.agentCount,
      error: result.error,
      input: manifest.input,
      piWorkflowsVersion: manifest.piWorkflowsVersion,
    }
  }

  // Active/incomplete run — derive state from ledger
  const ledgerFilePath = join(runDir, 'ledger.jsonl')
  const state = deriveStateFromLedger(ledgerFilePath)

  return {
    runId: manifest.runId,
    workflowName: manifest.workflowName,
    state,
    startedAt: manifest.startedAt,
    cwd: manifest.cwd,
    input: manifest.input,
    piWorkflowsVersion: manifest.piWorkflowsVersion,
  }
}

/**
 * Build full run detail (same as summary but also includes result payload
 * and the ledger entries as a timeline).
 */
function buildRunDetail(runDir: string): (RunSummary & { timeline: LedgerEntry[]; resultPayload: unknown; finishCallbackPrompt: string | null }) | null {
  const summary = buildRunSummary(runDir)
  if (!summary) return null

  // Timeline from ledger
  const timeline: LedgerEntry[] = []
  const ledgerFilePath = join(runDir, 'ledger.jsonl')
  try {
    const lines = readFileSync(ledgerFilePath, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
    for (const line of lines) {
      try {
        timeline.push(JSON.parse(line) as LedgerEntry)
      } catch {}
    }
  } catch {}

  // Actual result payload
  let resultPayload: unknown = null
  const resultPath = join(runDir, 'result.json')
  const result = readJson<WorkflowResult>(resultPath)
  if (result?.result !== undefined) {
    resultPayload = result.result
  }

  return { ...summary, timeline, resultPayload, finishCallbackPrompt: result?.finishCallbackPrompt ?? null }
}

// ─── Route handlers ──────────────────────────────────────────────────────────

function listRuns(req: Request, res: Response): void {
  const home = runsHome()
  if (!existsSync(home)) {
    res.json({ runs: [] })
    return
  }

  try {
    const entries = readdirSync(home, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('wf-'))

    const runs: RunSummary[] = []
    for (const entry of entries) {
      const summary = buildRunSummary(join(home, entry.name))
      if (summary) runs.push(summary)
    }

    // Sort: active first, then by startedAt desc
    runs.sort((a, b) => {
      const aTerminal = TERMINAL_STATES.has(a.state)
      const bTerminal = TERMINAL_STATES.has(b.state)
      if (aTerminal !== bTerminal) return aTerminal ? 1 : -1
      return b.startedAt.localeCompare(a.startedAt)
    })

    res.json({ runs })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

function getRunDetail(req: Request, res: Response): void {
  const runId = req.params.id as string
  const runDir = join(runsHome(), runId)

  if (!existsSync(runDir)) {
    res.status(404).json({ error: 'Run not found' })
    return
  }

  try {
    const detail = buildRunDetail(runDir)
    if (!detail) {
      res.status(404).json({ error: 'Run data missing or corrupted' })
      return
    }
    res.json(detail)
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

function deleteRun(req: Request, res: Response): void {
  const runId = req.params.id as string
  if (!runId.startsWith('wf-')) {
    res.status(400).json({ error: 'Invalid run ID' })
    return
  }

  const runDir = join(runsHome(), runId)
  if (!existsSync(runDir)) {
    res.status(404).json({ error: 'Run not found' })
    return
  }

  // Only allow deleting terminal runs (safety guard)
  const summary = buildRunSummary(runDir)
  if (summary && !TERMINAL_STATES.has(summary.state)) {
    res.status(409).json({ error: 'Cannot delete an active run. Stop it first.' })
    return
  }

  try {
    rmSync(runDir, { recursive: true, force: true })
    res.json({ ok: true })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
}

function listScripts(_req: Request, res: Response): void {
  const home = workflowsHome()
  const scripts: { name: string; path: string; scope: 'user'; mtimeMs: number }[] = []

  if (existsSync(home)) {
    try {
      const entries = readdirSync(home, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.js'))
      for (const entry of entries) {
        const fullPath = join(home, entry.name)
        const name = basename(entry.name, '.js')
        try {
          const stat = statSync(fullPath)
          scripts.push({ name, path: fullPath, scope: 'user', mtimeMs: stat.mtimeMs })
        } catch {}
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message })
      return
    }
  }

  scripts.sort((a, b) => b.mtimeMs - a.mtimeMs)
  res.json({ scripts })
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerWorkflowRoutes(deps: RouteDeps): void {
  const { app } = deps

  app.get('/api/workflows/runs', listRuns)
  app.get('/api/workflows/runs/:id', getRunDetail)
  app.delete('/api/workflows/runs/:id', deleteRun)
  app.get('/api/workflows/scripts', listScripts)
}
