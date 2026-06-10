import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'

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
  nextRunAt?: string | null
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

const EXAMPLES = [
  { name: 'Daily standup prep', cron: '0 16 * * 1-5', prompt: 'Generate my standup prep from recent sessions, daily notes, and open tasks. Be concise.' },
  { name: 'Morning CR sweep', cron: '0 17 * * 1-5', prompt: 'Find CRs waiting on me and summarize the highest-priority reviews.' },
  { name: 'Weekly agentic digest', cron: '0 18 * * 5', prompt: 'Generate a weekly digest of notable agentic work and wins.' },
]

function fmt(ts?: string | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusClass(status?: string | null): string {
  if (status === 'success') return 'bg-ok/15 text-ok border-ok/25'
  if (status === 'failed') return 'bg-danger/15 text-danger border-danger/25'
  if (status === 'running') return 'bg-warn/15 text-warn border-warn/25'
  return 'bg-bg-elevated text-muted border-border'
}

export default function JobsPage() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [runs, setRuns] = useState<JobRun[]>([])
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', cron: '0 16 * * 1-5', cwd: '', prompt: '' })

  const load = useCallback(() => {
    api.jobs()
      .then((d: { jobs?: ScheduledJob[]; runs?: JobRun[] }) => { setJobs(d.jobs || []); setRuns(d.runs || []); setError('') })
      .catch(e => setError(e?.message || 'Failed to load jobs'))
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [load])

  const runsByJob = useMemo(() => {
    const map = new Map<string, JobRun[]>()
    for (const run of runs) {
      const arr = map.get(run.jobId) || []
      arr.push(run)
      map.set(run.jobId, arr)
    }
    return map
  }, [runs])

  const submit = async () => {
    if (!form.name.trim() || !form.prompt.trim() || !form.cron.trim()) return
    setSaving(true)
    try {
      await api.createJob({ name: form.name, prompt: form.prompt, cron: form.cron, cwd: form.cwd || null })
      setForm({ name: '', cron: '0 16 * * 1-5', cwd: '', prompt: '' })
      setFormOpen(false)
      load()
    } catch (e: any) {
      setError(e?.message || 'Failed to create job')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (job: ScheduledJob) => {
    await api.updateJob(job.id, { enabled: !job.enabled })
    load()
  }

  const runNow = async (job: ScheduledJob) => {
    try {
      await api.runJob(job.id)
      load()
    } catch (e: any) {
      setError(e?.message || 'Failed to run job')
    }
  }

  const remove = async (job: ScheduledJob) => {
    if (!confirm(`Delete scheduled job "${job.name}"?`)) return
    await api.deleteJob(job.id)
    load()
  }

  return (
    <div className="p-6 max-w-6xl w-full mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="text-[12px] uppercase tracking-[.14em] text-accent font-semibold mb-2">Automation</div>
          <h1 className="text-2xl md:text-3xl font-bold text-text-strong">Scheduled Jobs</h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">Cron for pi: run prompts on a schedule, spawn a fresh slot per run, and keep a visible run history.</p>
        </div>
        <button className="bg-accent text-white border-none rounded-lg px-4 py-2 text-sm font-semibold cursor-pointer hover:bg-accent-hover transition-colors" onClick={() => setFormOpen(v => !v)}>
          {formOpen ? 'Close' : '+ New Job'}
        </button>
      </div>

      {error && <div className="rounded-lg border border-danger/30 bg-danger-subtle text-danger text-sm px-3 py-2">{error}</div>}

      {formOpen && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3 animate-scale-in">
          <div className="grid md:grid-cols-[1fr_180px] gap-3">
            <label className="space-y-1">
              <span className="text-[12px] font-medium text-muted">Name</span>
              <input className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text focus-ring" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Daily standup prep" />
            </label>
            <label className="space-y-1">
              <span className="text-[12px] font-medium text-muted">Cron (UTC)</span>
              <input className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm font-mono text-text focus-ring" value={form.cron} onChange={e => setForm(f => ({ ...f, cron: e.target.value }))} placeholder="0 16 * * 1-5" />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-muted">Working directory</span>
            <input className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm font-mono text-text focus-ring" value={form.cwd} onChange={e => setForm(f => ({ ...f, cwd: e.target.value }))} placeholder="optional, e.g. ~/pi-dashboard" />
          </label>
          <label className="block space-y-1">
            <span className="text-[12px] font-medium text-muted">Prompt</span>
            <textarea className="w-full min-h-[120px] bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text focus-ring resize-y" value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} placeholder="What should pi do when this job runs?" />
          </label>
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex gap-1.5 flex-wrap">
              {EXAMPLES.map(ex => (
                <button key={ex.name} className="text-[12px] px-2.5 py-1 rounded-full bg-bg-elevated border border-border text-muted hover:text-text hover:border-border-strong cursor-pointer" onClick={() => setForm({ ...ex, cwd: '' })}>{ex.name}</button>
              ))}
            </div>
            <button className="bg-accent text-white border-none rounded-lg px-4 py-2 text-sm font-semibold cursor-pointer disabled:opacity-50" disabled={saving || !form.name || !form.prompt || !form.cron} onClick={submit}>{saving ? 'Saving…' : 'Create job'}</button>
          </div>
        </div>
      )}

      <section className="grid gap-3">
        {jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-muted">
            <div className="text-3xl mb-2">⏰</div>
            <div className="text-text-strong font-semibold mb-1">No scheduled jobs yet</div>
            <div className="text-sm">Create one for recurring reviews, digests, or monitoring checks.</div>
          </div>
        ) : jobs.map(job => {
          const jobRuns = runsByJob.get(job.id) || []
          return (
            <article key={job.id} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="p-4 flex flex-col md:flex-row md:items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h2 className="text-base font-semibold text-text-strong">{job.name}</h2>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${job.enabled ? 'bg-ok/10 text-ok border-ok/25' : 'bg-bg-elevated text-muted border-border'}`}>{job.enabled ? 'enabled' : 'paused'}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusClass(job.lastStatus)}`}>{job.lastStatus || 'never run'}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted mb-2">
                    <span className="font-mono">{job.cron} UTC</span>
                    <span>next {fmt(job.nextRunAt)}</span>
                    <span>last {fmt(job.lastRunAt)}</span>
                    {job.cwd && <span className="font-mono truncate max-w-[360px]">{job.cwd}</span>}
                  </div>
                  <p className="text-sm text-text whitespace-pre-wrap line-clamp-3">{job.prompt}</p>
                </div>
                <div className="flex md:flex-col gap-2 shrink-0">
                  <button className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm text-text cursor-pointer hover:border-border-strong" onClick={() => runNow(job)}>Run</button>
                  <button className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm text-text cursor-pointer hover:border-border-strong" onClick={() => toggle(job)}>{job.enabled ? 'Pause' : 'Enable'}</button>
                  <button className="px-3 py-1.5 rounded-lg bg-danger/10 border border-danger/25 text-sm text-danger cursor-pointer hover:bg-danger/15" onClick={() => remove(job)}>Delete</button>
                </div>
              </div>
              {jobRuns.length > 0 && (
                <div className="border-t border-border bg-bg/40 px-4 py-3">
                  <div className="text-[12px] uppercase tracking-wide text-muted font-semibold mb-2">Recent runs</div>
                  <div className="grid gap-1.5">
                    {jobRuns.slice(0, 5).map(run => (
                      <button key={run.id} className="w-full text-left flex items-center gap-2 rounded-lg bg-bg-elevated/70 border border-border px-2.5 py-2 cursor-pointer hover:border-border-strong" onClick={() => navigate(`/chat?slot=${encodeURIComponent(run.slotKey)}`)}>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusClass(run.status)}`}>{run.status}</span>
                        <span className="text-[12px] text-muted">{fmt(run.startedAt)}</span>
                        <span className="text-[12px] font-mono text-accent">{run.slotKey}</span>
                        {run.error && <span className="text-[12px] text-danger truncate">{run.error}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </section>
    </div>
  )
}
