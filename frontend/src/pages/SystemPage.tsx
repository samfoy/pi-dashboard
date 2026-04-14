import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppSelector } from '../store'
import { useUptime } from '../hooks/useUptime'
import { api, j } from '../api/client'
import { StatCard, PageHeader } from '../components/ui'
import MarkdownRenderer from '../components/MarkdownRenderer'
import type { SystemData } from '../types'

export default function SystemPage() {
  const [data, setData] = useState<SystemData | null>(null)
  const [skills, setSkills] = useState<{name: string; description: string}[]>([])
  const [extensions, setExtensions] = useState<{name: string; file: string; description: string}[]>([])
  const [crontab, setCrontab] = useState<{schedule: string; command: string}[]>([])
  const [vault, setVault] = useState<{dailyNotes: number; taskNotes: number; meetingNotes: number; persons: number; recentDaily: string} | null>(null)
  const [memory, setMemory] = useState<{stats: {facts: number; lessons: number; events: number; episodic: number}; facts: any[]; lessons: any[]} | null>(null)
  const [sessions, setSessions] = useState<any[]>([])
  const [dailyNotes, setDailyNotes] = useState<{date: string; size: number}[]>([])
  const [dailyContent, setDailyContent] = useState<string | null>(null)
  const [selectedDaily, setSelectedDaily] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'memory' | 'skills' | 'sessions' | 'host' | 'vault'>('overview')
  const status = useAppSelector(s => s.dashboard.status)
  const statusUptime = useUptime()

  const [hostSessions, setHostSessions] = useState<any[]>([])
  const [hostLoading, setHostLoading] = useState(false)

  const loadingRef = useRef(false)
  const loadSystem = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    try { setData(await api.system()) } finally { loadingRef.current = false }
  }, [])

  useEffect(() => {
    loadSystem()
    const iv = setInterval(loadSystem, 5000)
    // Load static data once
    fetch('/api/skills').then(j).then(setSkills).catch(() => {})
    fetch('/api/pi/extensions').then(j).then(setExtensions).catch(() => {})
    fetch('/api/pi/crontab').then(j).then(setCrontab).catch(() => {})
    fetch('/api/pi/vault').then(j).then(setVault).catch(() => {})
    fetch('/api/pi/memory').then(j).then(setMemory).catch(() => {})
    fetch('/api/sessions?limit=20').then(j).then(d => setSessions(d.sessions || [])).catch(() => {})
    fetch('/api/pi/vault/daily?limit=10').then(j).then(setDailyNotes).catch(() => {})
    fetch('/api/host-sessions').then(j).then(d => setHostSessions(d.sessions || [])).catch(() => {})
    return () => clearInterval(iv)
  }, [loadSystem])

  const loadHostSessions = useCallback(async () => {
    setHostLoading(true)
    try {
      const d = await fetch('/api/host-sessions').then(j)
      setHostSessions(d.sessions || [])
    } catch {}
    setHostLoading(false)
  }, [])

  const loadDaily = (date: string) => {
    setSelectedDaily(date)
    fetch(`/api/pi/vault/daily/${date}`).then(j).then(d => setDailyContent(d.content)).catch(() => setDailyContent('Failed to load'))
  }

  const d = data
  const tabs = ['overview', 'host', 'memory', 'skills', 'sessions', 'vault'] as const
  const tabLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

  return (
    <>
      <PageHeader title="System" subtitle="Pi environment, memory, skills, sessions, and vault" />
      <div className="px-6 pb-8 overflow-y-auto flex-1 min-h-0">
        {/* Top stats */}
        <div className="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(130px,1fr))] mb-6">
          <StatCard label="Sessions" value={status?.sessions || 0} accent />
          <StatCard label="Host Pi" value={hostSessions.length} />
          <StatCard label="Skills" value={skills.length} />
          <StatCard label="Extensions" value={extensions.length} />
          <StatCard label="Lessons" value={memory?.stats.lessons || 0} />
          <StatCard label="Facts" value={memory?.stats.facts || 0} />
          <StatCard label="Vault Notes" value={vault ? vault.dailyNotes + vault.taskNotes + vault.meetingNotes : 0} />
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-border mb-6">
          {tabs.map(t => (
            <button key={t} className={`px-4 py-2 border-none bg-transparent text-sm font-medium font-body cursor-pointer border-b-2 -mb-px transition-all ${activeTab === t ? 'text-accent border-b-accent' : 'text-muted border-b-transparent hover:text-text'}`} onClick={() => { setActiveTab(t); if (t === 'host') loadHostSessions() }}>{t === 'host' ? 'Host Sessions' : tabLabel(t)}</button>
          ))}
        </div>

        {/* Overview tab */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
            <Card title="🖥 Host">
              <Info k="Hostname" v={d?.hostname} />
              <Info k="OS" v={d?.os} />
              <Info k="Arch" v={d?.arch} />
              <Info k="CPUs" v={d?.cpu_count} />
              <Info k="Load" v={d?.load_1m != null ? `${d.load_1m} / ${d.load_5m} / ${d.load_15m}` : '—'} />
              <Info k="Memory" v={d?.mem_used_gb ? `${d.mem_used_gb} / ${d.mem_total_gb} GB` : '—'} />
              <Info k="Disk" v={d?.disk_total_gb ? `${d.disk_free_gb} / ${d.disk_total_gb} GB free` : '—'} />
              <Info k="IP" v={d?.ip} />
            </Card>
            <Card title="🥧 Pi Dashboard">
              <Info k="PID" v={d?.pid} />
              <Info k="Uptime" v={statusUptime} />
              <Info k="Active Chats" v={status?.sessions} />
              <Info k="Messages" v={status?.messages} />
              <Info k="Tool Calls" v={status?.tool_calls} />
              <Info k="Memory (RSS)" v={d?.proc_mem_mb ? `${d.proc_mem_mb} MB` : '—'} />
            </Card>
            <Card title="⏰ Cron Jobs">
              {crontab.length === 0 ? <div className="text-muted text-sm italic py-2">No cron jobs</div> : crontab.map((c, i) => (
                <div key={i} className="py-2 border-b border-border last:border-0">
                  <div className="text-[13px] font-mono text-accent">{c.schedule}</div>
                  <div className="text-[13px] text-muted truncate" title={c.command}>{c.command.split('/').pop()}</div>
                </div>
              ))}
            </Card>
            <Card title="📁 Vault">
              {vault && <>
                <Info k="Daily Notes" v={vault.dailyNotes} />
                <Info k="Task Notes" v={vault.taskNotes} />
                <Info k="Meeting Notes" v={vault.meetingNotes} />
                <Info k="Person Notes" v={vault.persons} />
                <Info k="Latest" v={vault.recentDaily} />
              </>}
            </Card>
          </div>
        )}

        {/* Memory tab */}
        {activeTab === 'memory' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3 max-[900px]:grid-cols-2">
              <StatCard label="Facts" value={memory?.stats.facts || 0} />
              <StatCard label="Lessons" value={memory?.stats.lessons || 0} />
              <StatCard label="Events" value={memory?.stats.events || 0} />
              <StatCard label="Episodic" value={memory?.stats.episodic || 0} />
            </div>
            <Card title="📝 Lessons">
              <div className="max-h-[400px] overflow-y-auto">
                {memory?.lessons.map((l: any, i: number) => (
                  <div key={i} className="py-2.5 border-b border-border last:border-0">
                    <div className="flex items-start gap-2">
                      <span className={`shrink-0 text-[12px] px-1.5 py-0.5 rounded-full font-medium ${l.negative ? 'bg-danger-subtle text-danger' : 'bg-ok-subtle text-ok'}`}>{l.negative ? 'DON\'T' : 'DO'}</span>
                      <span className="text-[13px] text-text leading-relaxed">{l.rule}</span>
                    </div>
                    <div className="text-[12px] text-muted mt-1 ml-12">{l.category} · {l.created_at}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="🧠 Facts">
              <div className="max-h-[400px] overflow-y-auto">
                {memory?.facts.slice(0, 50).map((f: any, i: number) => (
                  <div key={i} className="py-2 border-b border-border last:border-0">
                    <div className="text-[13px] font-mono text-accent">{f.key}</div>
                    <div className="text-[13px] text-muted mt-0.5 line-clamp-2">{f.value}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* Skills tab */}
        {activeTab === 'skills' && (
          <div className="space-y-4">
            <Card title={`🛠 Skills (${skills.length})`}>
              <div className="grid gap-0">
                {skills.map((s, i) => (
                  <div key={i} className="py-2.5 border-b border-border last:border-0">
                    <div className="text-[13px] font-mono font-semibold text-text">{s.name}</div>
                    <div className="text-[12px] text-muted mt-0.5 line-clamp-2">{s.description}</div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title={`⚡ Extensions (${extensions.length})`}>
              <div className="grid gap-0">
                {extensions.map((e, i) => (
                  <div key={i} className="py-2.5 border-b border-border last:border-0">
                    <div className="text-[13px] font-mono font-semibold text-text">{e.name}</div>
                    <div className="text-[12px] text-muted mt-0.5">{e.file} {e.description ? `— ${e.description}` : ''}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* Host Sessions tab */}
        {activeTab === 'host' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-[13px] text-muted">
                Pi sessions running on this host (tmux). Click to open in a new dashboard chat.
              </div>
              <button className="px-2.5 py-1 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer font-body hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all" onClick={loadHostSessions}>
                {hostLoading ? '⏳' : '🔄'} Refresh
              </button>
            </div>
            {hostSessions.length === 0 ? (
              <Card title="🔍 No pi sessions found">
                <div className="text-[13px] text-muted py-4">
                  {hostLoading ? 'Scanning tmux sessions…' : 'No pi processes detected in tmux. Start a pi session in tmux and it will appear here.'}
                </div>
              </Card>
            ) : (
              <div className="grid gap-3">
                {hostSessions.map((s: any, i: number) => (
                  <div key={i} className="card-glow border border-border bg-card rounded-lg p-4 animate-rise shadow-sm hover:border-accent hover:shadow-md transition-all">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[13px] font-semibold text-text-strong">{s.windowName || s.tmuxSession}</span>
                          <span className="px-1.5 py-[1px] rounded-full text-[11px] font-mono bg-ok-subtle text-ok border border-ok/30">{s.tmuxSession}</span>
                          {s.model && <span className="px-1.5 py-[1px] rounded-full text-[11px] font-mono bg-aim-subtle text-aim border border-aim/30">🧠 {s.model}</span>}
                        </div>
                        <div className="text-[12px] text-muted font-mono truncate" title={s.cwd}>📂 {s.cwd}</div>
                        {s.lastOutput && <div className="text-[12px] text-muted mt-1.5 line-clamp-2 font-mono bg-bg-elevated rounded px-2 py-1 border border-border">{s.lastOutput}</div>}
                        <div className="flex items-center gap-3 mt-2 text-[12px] text-muted">
                          {s.contextPct && <span>ctx: <span className="text-accent font-medium">{s.contextPct}</span></span>}
                          {s.uptime && <span>⏱ {s.uptime}</span>}
                          <span className="font-mono">pid {s.pid}</span>
                          <span className="font-mono">{s.size}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button className="px-3 py-1.5 rounded-md text-[13px] font-medium border border-accent text-accent bg-transparent cursor-pointer hover:bg-accent hover:text-white transition-all" onClick={() => navigator.clipboard.writeText(s.attachCmd)}>
                          📋 Copy attach
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sessions tab */}
        {activeTab === 'sessions' && (
          <Card title={`📜 Recent Sessions (${sessions.length})`}>
            <div className="max-h-[600px] overflow-y-auto">
              {sessions.map((s: any, i: number) => (
                <div key={i} className="py-2.5 border-b border-border last:border-0">
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-text font-medium truncate">{s.title}</div>
                      <div className="text-[12px] text-muted mt-0.5">{s.project} · {(s.size / 1024).toFixed(0)} KB</div>
                    </div>
                    <div className="text-[12px] text-muted shrink-0">{new Date(s.modified).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Vault tab */}
        {activeTab === 'vault' && (
          <div className="grid grid-cols-[250px_1fr] gap-4 max-[900px]:grid-cols-1">
            <Card title="📅 Daily Notes">
              {dailyNotes.map((dn, i) => (
                <div key={i} className={`py-2 px-2 border-b border-border last:border-0 cursor-pointer rounded transition-all ${selectedDaily === dn.date ? 'bg-accent-subtle text-accent' : 'hover:bg-bg-hover text-text'}`} onClick={() => loadDaily(dn.date)}>
                  <div className="text-[13px] font-mono font-medium">{dn.date}</div>
                  <div className="text-[12px] text-muted">{(dn.size / 1024).toFixed(1)} KB</div>
                </div>
              ))}
            </Card>
            <Card title={selectedDaily ? `📝 ${selectedDaily}` : '📝 Select a daily note'}>
              {dailyContent ? (
                <div className="prose prose-sm max-w-none text-[13px] leading-relaxed max-h-[600px] overflow-y-auto">
                  <MarkdownRenderer content={dailyContent} />
                </div>
              ) : (
                <div className="text-muted text-sm italic py-4">Click a daily note to view its contents</div>
              )}
            </Card>
          </div>
        )}
      </div>
    </>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card-glow border border-border bg-card rounded-lg p-5 animate-rise shadow-sm hover:border-border-strong hover:shadow-md transition-all">
      <h3 className="text-sm font-semibold text-text-strong mb-3.5">{title}</h3>
      {children}
    </div>
  )
}

function Info({ k, v }: { k: string; v?: string | number | null }) {
  return <div className="flex justify-between gap-3 py-2 border-b border-border text-sm last:border-b-0"><span className="text-muted shrink-0">{k}</span><span className="text-text font-medium font-mono text-[13px] break-all text-right">{v ?? '—'}</span></div>
}
