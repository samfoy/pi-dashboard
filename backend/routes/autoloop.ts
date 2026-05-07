/**
 * Autoloop routes — loop session discovery, output, journal
 */
import { Request, Response } from 'express'
import { readFileSync, statSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import type { RouteDeps } from './types.js'

interface LoopSession {
  id: string
  tmuxSession: string
  cwd: string
  runId: string | null
  objective: string | null
  iteration: number | null
  maxIterations: number | null
  status: 'running' | 'idle' | 'complete'
  lastEvent: string | null
  lastOutput: string
  progressSummary: string | null
  journalPath: string | null
  startedAt: string | null
}

/** Walk child PIDs to find the real project dir (where .autoloop/ lives). */
function findProjectDir(panePid: string, paneCwd: string): string {
  try {
    const children = execSync(`pgrep -P ${panePid} 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean)
    for (const childPid of children) {
      try {
        const childCwd = execSync(`readlink /proc/${childPid}/cwd 2>/dev/null`, { encoding: 'utf-8' }).trim()
        if (childCwd && childCwd !== paneCwd) {
          try { statSync(join(childCwd, '.autoloop')); return childCwd } catch {}
        }
        const grandchildren = execSync(`pgrep -P ${childPid} 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n').filter(Boolean)
        for (const gcPid of grandchildren) {
          try {
            const gcCwd = execSync(`readlink /proc/${gcPid}/cwd 2>/dev/null`, { encoding: 'utf-8' }).trim()
            if (gcCwd && gcCwd !== paneCwd) {
              try { statSync(join(gcCwd, '.autoloop')); return gcCwd } catch {}
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return paneCwd
}

function scanLoopSessions(): LoopSession[] {
  const sessions: LoopSession[] = []
  let panes: string[]
  try {
    panes = execSync("tmux list-panes -a -F '#{session_name}|#{window_index}|#{pane_index}|#{pane_pid}|#{pane_current_command}|#{pane_current_path}' 2>/dev/null", { encoding: 'utf-8' }).trim().split('\n').filter(Boolean)
  } catch { return [] }

  // Group panes by tmux session name
  const sessionPanes = new Map<string, { widx: string; pidx: string; ppid: string; cmd: string; cpath: string }[]>()
  for (const pane of panes) {
    const [sname, widx, pidx, ppid, cmd, cpath] = pane.split('|')
    if (!sname.startsWith('autoloop-') && !sname.startsWith('ralph-')) continue
    if (!sessionPanes.has(sname)) sessionPanes.set(sname, [])
    sessionPanes.get(sname)!.push({ widx, pidx, ppid, cmd, cpath })
  }

  for (const [sname, paneList] of sessionPanes) {
    const mainPane = paneList[0]
    let lastOutput = ''
    try {
      const captured = execSync(`tmux capture-pane -t ${JSON.stringify(sname + ':' + mainPane.widx + '.' + mainPane.pidx)} -p -S -40 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 })
      const lines = captured.split('\n').filter((l: string) => l.trim())
      lastOutput = lines.slice(-20).join('\n')
    } catch {}

    const projectDirs = new Set<string>()
    for (const p of paneList) {
      const dir = findProjectDir(p.ppid, p.cpath)
      projectDirs.add(dir)
    }

    const seenRunIds = new Set<string>()
    let foundAnyRun = false

    let tmuxStartedAt: string | null = null
    try {
      const created = execSync(`tmux display-message -t ${JSON.stringify(sname)} -p '#{session_created}' 2>/dev/null`, { encoding: 'utf-8' }).trim()
      if (created) tmuxStartedAt = new Date(parseInt(created) * 1000).toISOString()
    } catch {}

    for (const projectDir of projectDirs) {
      const autoloopDir = join(projectDir, '.autoloop')
      const registryPath = join(autoloopDir, 'registry.jsonl')

      let regEntries: any[] = []
      try {
        const regRaw = readFileSync(registryPath, 'utf-8')
        const regLines = regRaw.trim().split('\n').filter(Boolean)
        const runStates = new Map<string, any>()
        for (const line of regLines) {
          try {
            const entry = JSON.parse(line)
            if (entry.run_id) runStates.set(entry.run_id, entry)
          } catch {}
        }
        regEntries = [...runStates.values()]
      } catch {}

      for (const entry of regEntries) {
        if (entry.status !== 'running') continue
        if (seenRunIds.has(entry.run_id)) continue

        let isAlive = false
        if (entry.pid) {
          try {
            process.kill(entry.pid, 0)
            isAlive = true
          } catch {
            isAlive = false
          }
        }

        seenRunIds.add(entry.run_id)
        foundAnyRun = true

        const runId = entry.run_id
        const iteration = entry.iteration || 0
        const maxIterations = entry.max_iterations || null
        const lastEvent = entry.latest_event || null
        const objective = entry.objective || null
        const stateDir = entry.state_dir || null
        const journalPath = entry.journal_file || null
        const startedAt = entry.created_at || tmuxStartedAt
        let status: 'running' | 'idle' | 'complete' = isAlive ? 'running' : 'idle'

        let progressSummary: string | null = null
        if (stateDir) {
          try { progressSummary = readFileSync(join(stateDir, 'progress.md'), 'utf-8').trim() } catch {}
          if (!progressSummary) {
            try { progressSummary = readFileSync(join(stateDir, 'runs', runId, 'progress.md'), 'utf-8').trim() } catch {}
          }
        } else {
          try { progressSummary = readFileSync(join(autoloopDir, 'runs', runId, 'progress.md'), 'utf-8').trim() } catch {}
        }

        sessions.push({
          id: `${sname}/${runId}`,
          tmuxSession: sname,
          cwd: entry.work_dir || projectDir,
          runId,
          objective,
          iteration,
          maxIterations,
          status,
          lastEvent,
          lastOutput,
          progressSummary,
          journalPath,
          startedAt,
        })
      }

      // If no registry runs found, fall back to journal.jsonl
      if (!foundAnyRun) {
        const jPath = join(autoloopDir, 'journal.jsonl')
        try {
          const jRaw = readFileSync(jPath, 'utf-8')
          const lines = jRaw.trim().split('\n').filter(Boolean)
          let runId: string | null = null
          let iteration: number | null = null
          let lastEvent: string | null = null
          let status: 'running' | 'idle' | 'complete' = 'running'
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const e = JSON.parse(lines[i])
              if (!runId && e.run) runId = e.run
              if ((e.topic === 'iteration.finish' || e.topic === 'iteration.start') && iteration === null) {
                iteration = parseInt(e.iteration) || null
              }
              if (e.topic === 'loop.complete') { status = 'complete'; break }
              if (!lastEvent && e.topic) lastEvent = e.topic
            } catch {}
          }
          if (runId && !seenRunIds.has(runId)) {
            seenRunIds.add(runId)
            foundAnyRun = true
            sessions.push({
              id: `${sname}/${runId || 'unknown'}`,
              tmuxSession: sname,
              cwd: projectDir,
              runId,
              objective: null,
              iteration,
              maxIterations: null,
              status,
              lastEvent,
              lastOutput,
              progressSummary: null,
              journalPath: jPath,
              startedAt: tmuxStartedAt,
            })
          }
        } catch {}
      }
    }

    // If no runs found at all, still show the tmux session as idle
    if (!foundAnyRun) {
      sessions.push({
        id: sname,
        tmuxSession: sname,
        cwd: mainPane.cpath,
        runId: null,
        objective: null,
        iteration: null,
        maxIterations: null,
        status: 'idle',
        lastEvent: null,
        lastOutput,
        progressSummary: null,
        journalPath: null,
        startedAt: tmuxStartedAt,
      })
    }
  }
  return sessions
}

function parseLoopId(id: string): { tmuxSession: string; runId: string | null } {
  if (id.includes('/')) {
    const idx = id.indexOf('/')
    return { tmuxSession: id.slice(0, idx), runId: id.slice(idx + 1) }
  }
  return { tmuxSession: id, runId: null }
}

export function registerAutoloopRoutes(deps: RouteDeps): void {
  const { app } = deps

  app.get('/api/loops', (_req: Request, res: Response) => {
    try {
      const sessions = scanLoopSessions()
      res.json({ sessions })
    } catch (e: any) {
      res.json({ sessions: [], error: e.message })
    }
  })

  app.get('/api/loops/:id/output', (req: Request, res: Response) => {
    const { tmuxSession } = parseLoopId(req.params.id as string)
    const lines = parseInt(req.query.lines as string) || 80
    try {
      const panes = execSync("tmux list-panes -a -F '#{session_name}|#{window_index}|#{pane_index}' 2>/dev/null", { encoding: 'utf-8' }).trim().split('\n')
      const match = panes.find(p => p.startsWith(tmuxSession + '|'))
      if (!match) return res.status(404).json({ error: 'Session not found' })
      const [, widx, pidx] = match.split('|')
      const target = `${tmuxSession}:${widx}.${pidx}`
      const captured = execSync(`tmux capture-pane -t ${JSON.stringify(target)} -p -S -${lines} 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 })
      res.json({ output: captured })
    } catch (e: any) {
      res.status(404).json({ error: 'Session not found or no output' })
    }
  })

  app.get('/api/loops/:id/journal', (req: Request, res: Response) => {
    const { tmuxSession, runId } = parseLoopId(req.params.id as string)
    const limit = parseInt(req.query.limit as string) || 50
    try {
      const panes = execSync("tmux list-panes -a -F '#{session_name}|#{pane_pid}|#{pane_current_path}' 2>/dev/null", { encoding: 'utf-8' }).trim().split('\n')
      const match = panes.find(p => p.startsWith(tmuxSession + '|'))
      if (!match) return res.status(404).json({ error: 'Session not found' })
      const [, ppid, paneCwd] = match.split('|')
      const projectDir = findProjectDir(ppid, paneCwd)
      const autoloopDir = join(projectDir, '.autoloop')

      let jPath = join(autoloopDir, 'journal.jsonl')
      try {
        const regRaw = readFileSync(join(autoloopDir, 'registry.jsonl'), 'utf-8')
        const regLines = regRaw.trim().split('\n').filter(Boolean)
        for (let i = regLines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(regLines[i])
            if (entry.journal_file && (!runId || entry.run_id === runId)) {
              jPath = entry.journal_file
              break
            }
          } catch {}
        }
      } catch {}

      const raw = readFileSync(jPath, 'utf-8')
      const lines = raw.trim().split('\n').filter(Boolean)
      const entries = lines.slice(-limit).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      res.json({ entries })
    } catch (e: any) {
      res.status(404).json({ error: e.message })
    }
  })
}
