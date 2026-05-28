import { useState, useEffect, useCallback, useRef } from 'react'
import { j } from '../api/client'
import { PageHeader } from '../components/ui'

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

interface JournalEntry {
  run: string
  iteration: string
  topic: string
  fields?: Record<string, unknown>
  payload?: string
  source?: string
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'bg-ok-subtle text-ok border-ok/30',
    idle: 'bg-warn-subtle text-warn border-warn/30',
    complete: 'bg-muted/20 text-muted border-border',
  }
  const icons: Record<string, string> = { running: '⚡', idle: '💤', complete: '✅' }
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${colors[status] || colors.idle}`}>
      {icons[status] || '❓'} {status}
    </span>
  )
}

function RelativeTime({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted">—</span>
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return <span>just now</span>
  if (mins < 60) return <span>{mins}m ago</span>
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return <span>{hrs}h {mins % 60}m ago</span>
  return <span>{Math.floor(hrs / 24)}d ago</span>
}

function LoopCard({ session, onSelect }: { session: LoopSession; onSelect: () => void }) {
  const name = session.tmuxSession.replace(/^(autoloop|ralph)-/, '')
  return (
    <div
      className="card-glow border border-border bg-card rounded-lg p-4 animate-rise shadow-sm hover:border-accent hover:shadow-md transition-all cursor-pointer"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[15px] font-semibold text-text-strong">{name}</span>
            <StatusBadge status={session.status} />
            {session.runId && (
              <span className="px-1.5 py-[1px] rounded-full text-[11px] font-mono bg-aim-subtle text-aim border border-aim/30">
                {session.runId}
              </span>
            )}
          </div>
          {session.objective && (
            <div className="text-[13px] text-text mt-0.5 line-clamp-2">{session.objective}</div>
          )}
          <div className="text-[12px] text-muted font-mono truncate mt-1" title={session.cwd}>📂 {session.cwd}</div>
          <div className="flex items-center gap-3 mt-2 text-[12px] text-muted">
            {session.iteration != null && (
              <span>
                🔄 iter <span className="text-accent font-medium">{session.iteration}</span>
                {session.maxIterations && <span className="text-muted">/{session.maxIterations}</span>}
              </span>
            )}
            {session.lastEvent && <span>📡 {session.lastEvent}</span>}
            {session.startedAt && <span>⏱ <RelativeTime iso={session.startedAt} /></span>}
          </div>
          {session.lastOutput && (
            <div className="text-[12px] text-muted mt-2 line-clamp-3 font-mono bg-bg-elevated rounded px-2 py-1.5 border border-border whitespace-pre-wrap">
              {session.lastOutput.split('\n').slice(-3).join('\n')}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            className="px-3 py-1.5 rounded-md text-[13px] font-medium border border-accent text-accent bg-transparent cursor-pointer hover:bg-accent hover:text-white transition-all"
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`tmux attach -t ${session.tmuxSession}`) }}
          >
            📋 Attach
          </button>
        </div>
      </div>
    </div>
  )
}

function LoopDetail({ session }: { session: LoopSession }) {
  const [output, setOutput] = useState('')
  const [journal, setJournal] = useState<JournalEntry[]>([])
  const [activeTab, setActiveTab] = useState<'output' | 'journal' | 'progress'>('output')
  const outputRef = useRef<HTMLPreElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  const fetchOutput = useCallback(async () => {
    try {
      const d = await fetch(`/api/loops/${encodeURIComponent(session.id)}/output?lines=100`).then(j)
      if (d.output) setOutput(d.output)
    } catch {}
  }, [session.id])

  const fetchJournal = useCallback(async () => {
    try {
      const d = await fetch(`/api/loops/${encodeURIComponent(session.id)}/journal?limit=30`).then(j)
      if (d.entries) setJournal(d.entries)
    } catch {}
  }, [session.id])

  useEffect(() => {
    fetchOutput()
    fetchJournal()
    pollRef.current = setInterval(() => {
      fetchOutput()
      if (activeTab === 'journal') fetchJournal()
    }, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchOutput, fetchJournal, activeTab])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  const tabs = ['output', 'journal', 'progress'] as const

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-0 border-b border-border">
        {tabs.map(t => (
          <button
            key={t}
            className={`px-4 py-2 border-none bg-transparent text-sm font-medium font-body cursor-pointer border-b-2 -mb-px transition-all ${activeTab === t ? 'text-accent border-b-accent' : 'text-muted border-b-transparent hover:text-text'}`}
            onClick={() => setActiveTab(t)}
          >
            {t === 'output' ? '🖥 Output' : t === 'journal' ? '📜 Journal' : '📊 Progress'}
          </button>
        ))}
      </div>

      {activeTab === 'output' && (
        <pre
          ref={outputRef}
          className="bg-bg-elevated border border-border rounded-lg p-3 text-[12px] font-mono text-text overflow-auto max-h-[500px] whitespace-pre-wrap leading-relaxed"
        >
          {output || 'No output captured yet…'}
        </pre>
      )}

      {activeTab === 'journal' && (
        <div className="bg-bg-elevated border border-border rounded-lg overflow-auto max-h-[500px]">
          {journal.length === 0 ? (
            <div className="p-4 text-[13px] text-muted italic">No journal entries found</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-bg-elevated border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 text-muted font-medium">Iter</th>
                  <th className="text-left px-3 py-2 text-muted font-medium">Topic</th>
                  <th className="text-left px-3 py-2 text-muted font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((e, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-bg-hover">
                    <td className="px-3 py-2 font-mono text-accent">{e.iteration || '—'}</td>
                    <td className="px-3 py-2 font-mono">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] ${
                        e.topic.includes('complete') ? 'bg-ok-subtle text-ok' :
                        e.topic.includes('start') ? 'bg-aim-subtle text-aim' :
                        e.topic.includes('finish') ? 'bg-accent/10 text-accent' :
                        'bg-muted/10 text-muted'
                      }`}>
                        {e.topic}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted max-w-[400px] truncate">
                      {e.payload ? e.payload.slice(0, 120) : e.fields ? JSON.stringify(e.fields).slice(0, 120) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'progress' && (
        <div className="bg-bg-elevated border border-border rounded-lg p-4 text-[13px] font-mono text-text overflow-auto max-h-[500px] whitespace-pre-wrap leading-relaxed">
          {session.progressSummary || 'No progress file found for this run.'}
        </div>
      )}
    </div>
  )
}

export default function LoopsPage() {
  const [sessions, setSessions] = useState<LoopSession[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<LoopSession | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  const fetchSessions = useCallback(async () => {
    try {
      const d = await fetch('/api/loops').then(j)
      setSessions(d.sessions || [])
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchSessions()
    pollRef.current = setInterval(fetchSessions, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchSessions])

  // Update selected session data when sessions refresh
  useEffect(() => {
    if (selected) {
      const updated = sessions.find(s => s.id === selected.id)
      if (updated) setSelected(updated)
    }
  }, [sessions, selected])

  return (
    <>
      <PageHeader title="Loops" subtitle="Active autoloop and ralph orchestration sessions" />
      <div className="px-3 md:px-6 pb-8 overflow-y-auto flex-1 min-h-0">
        {selected ? (
          <div className="space-y-4">
            <button
              className="px-3 py-1.5 rounded-md text-[13px] font-medium border border-border text-muted bg-transparent cursor-pointer hover:text-text hover:border-border-strong transition-all"
              onClick={() => setSelected(null)}
            >
              ← Back to all loops
            </button>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-lg font-semibold text-text-strong">
                {selected.tmuxSession.replace(/^(autoloop|ralph)-/, '')}
              </span>
              <StatusBadge status={selected.status} />
              {selected.iteration != null && (
                <span className="text-[13px] text-muted">
                  iteration {selected.iteration}{selected.maxIterations ? `/${selected.maxIterations}` : ''}
                </span>
              )}
            </div>
            {selected.objective && (
              <div className="text-[13px] text-muted mb-3 line-clamp-2">{selected.objective}</div>
            )}
            <LoopDetail session={selected} />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[13px] text-muted">
                Autoloop and ralph sessions running in tmux. Click to view live output.
              </div>
              <button
                className="px-2.5 py-1 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer font-body hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all"
                onClick={fetchSessions}
              >
                {loading ? '⏳' : '🔄'} Refresh
              </button>
            </div>
            {sessions.length === 0 ? (
              <div className="card-glow border border-border bg-card rounded-lg p-8 text-center">
                <div className="text-2xl mb-2">🔄</div>
                <div className="text-[14px] text-text-strong font-medium mb-1">No active loops</div>
                <div className="text-[13px] text-muted">
                  {loading ? 'Scanning tmux sessions…' : 'Start an autoloop or ralph session and it will appear here.'}
                </div>
                <div className="text-[12px] text-muted mt-3 font-mono">
                  tmux sessions matching: autoloop-* or ralph-*
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                {sessions.map(s => (
                  <LoopCard key={s.id} session={s} onSelect={() => setSelected(s)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
