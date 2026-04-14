import { useState, useEffect, useRef, useCallback, useContext } from 'react'
import { WsContext } from '../App'
import { PageHeader, Card, SearchInput, Badge } from '../components/ui'

interface LogEntry {
  level: string
  msg: string
  ts: string
}

const LEVEL_COLORS: Record<string, 'ok' | 'warn' | 'err' | 'aim'> = {
  debug: 'aim',
  info: 'ok',
  warn: 'warn',
  warning: 'warn',
  error: 'err',
}

const MAX_LOGS = 2000

export default function LogsPage() {
  const { subscribeLogs } = useContext(WsContext)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [tail, setTail] = useState(true)
  const [paused, setPaused] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(false)
  pausedRef.current = paused

  useEffect(() => {
    subscribeLogs((data) => {
      if (!data) return
      if (pausedRef.current) return
      setLogs(prev => {
        const next = [...prev, { ...data, ts: new Date().toISOString() }]
        return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next
      })
    })
    return () => subscribeLogs(null)
  }, [subscribeLogs])

  useEffect(() => {
    if (tail && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, tail])

  const filtered = logs.filter(l => {
    if (levelFilter !== 'all' && l.level !== levelFilter) return false
    if (filter && !l.msg.toLowerCase().includes(filter.toLowerCase())) return false
    return true
  })

  const clear = useCallback(() => setLogs([]), [])

  return (
    <>
      <PageHeader title="Logs" subtitle="Real-time pi session logs" />
      <div className="px-6 pb-8 overflow-y-auto flex-1 min-h-0 flex flex-col gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput placeholder="Filter logs…" value={filter} onChange={e => setFilter(e.target.value)} className="w-64" />
          <select
            className="bg-bg-elevated border border-border rounded-md px-3 py-1.5 text-text text-[13px] font-body outline-none cursor-pointer transition-colors focus-ring"
            value={levelFilter}
            onChange={e => setLevelFilter(e.target.value)}
          >
            <option value="all">All levels</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
          <label className="flex items-center gap-2 cursor-pointer">
            <div className={`w-9 h-5 rounded-full relative transition-colors ${tail ? 'bg-accent' : 'bg-border'}`} onClick={() => setTail(!tail)}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${tail ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-[13px] text-muted">Auto-scroll</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <div className={`w-9 h-5 rounded-full relative transition-colors ${paused ? 'bg-warn' : 'bg-border'}`} onClick={() => setPaused(!paused)}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${paused ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-[13px] text-muted">{paused ? 'Paused' : 'Live'}</span>
          </label>
          <button className="px-2.5 py-1 rounded-md border border-border bg-transparent text-muted text-[13px] cursor-pointer font-body hover:text-text hover:border-border-strong hover:bg-bg-hover transition-all ml-auto" onClick={clear}>Clear</button>
          <span className="text-[12px] text-muted font-mono">{filtered.length} / {logs.length}</span>
        </div>

        <Card className="flex-1 min-h-0 !p-0 flex flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-auto font-mono text-[13px] leading-relaxed p-3">
            {filtered.length === 0 ? (
              <div className="text-muted text-center py-8">
                {logs.length === 0 ? '📡 Waiting for log events…' : 'No logs match filter'}
              </div>
            ) : (
              <table className="w-full border-collapse">
                <tbody>
                  {filtered.map((l, i) => (
                    <tr key={i} className="hover:bg-bg-hover transition-colors group">
                      <td className="px-2 py-0.5 text-muted/50 text-[11px] whitespace-nowrap align-top select-none w-[140px]">
                        {new Date(l.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as any)}
                      </td>
                      <td className="px-2 py-0.5 whitespace-nowrap align-top w-[60px]">
                        <Badge variant={LEVEL_COLORS[l.level] || 'aim'}>{l.level.toUpperCase()}</Badge>
                      </td>
                      <td className="px-2 py-0.5 text-text whitespace-pre-wrap break-all">{l.msg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}
