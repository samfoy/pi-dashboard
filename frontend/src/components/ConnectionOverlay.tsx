import { useState, useEffect, useRef } from 'react'
import { useAppSelector } from '../store'

type ConnectionState = 'connected' | 'reconnecting' | 'disconnected'

/** Overlay shown when the WebSocket connection to the backend is lost. */
export default function ConnectionOverlay() {
  const connected = useAppSelector(s => s.dashboard.connected)
  const [state, setState] = useState<ConnectionState>('connected')
  const [elapsed, setElapsed] = useState(0)
  const disconnectedAt = useRef<number | null>(null)

  useEffect(() => {
    if (connected) {
      setState('connected')
      disconnectedAt.current = null
      setElapsed(0)
      return
    }

    // Just disconnected
    if (!disconnectedAt.current) {
      disconnectedAt.current = Date.now()
      setState('reconnecting')
    }

    const iv = setInterval(() => {
      const secs = Math.floor((Date.now() - (disconnectedAt.current || Date.now())) / 1000)
      setElapsed(secs)
      // After 15s of no connection, show full disconnected state
      if (secs >= 15) setState('disconnected')
    }, 1000)

    return () => clearInterval(iv)
  }, [connected])

  if (state === 'connected') return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-bg/80 backdrop-blur-sm animate-rise">
      <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
        {state === 'reconnecting' ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-block w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              <span className="text-sm font-semibold text-text-strong">Reconnecting…</span>
            </div>
            <div className="text-[13px] text-muted">
              Lost connection to Pi Dashboard. Retrying automatically…
              <span className="font-mono text-muted/60 ml-1">{elapsed}s</span>
            </div>
          </>
        ) : (
          <>
            <div className="text-2xl mb-3">🔌</div>
            <div className="text-sm font-semibold text-text-strong mb-2">Connection Lost</div>
            <div className="text-[13px] text-muted mb-4">
              Can't reach the Pi Dashboard server. This usually means the SSH tunnel dropped or the server stopped.
              <span className="font-mono text-muted/60 ml-1">({elapsed}s)</span>
            </div>

            <div className="space-y-3 text-[13px]">
              <div className="bg-bg-elevated rounded-lg p-3 border border-border">
                <div className="font-medium text-text mb-1">🔑 Check SSH access</div>
                <code className="text-[12px] text-accent font-mono">ssh user@your-remote-host echo ok</code>
                <div className="text-[12px] text-muted mt-1">Verify you can reach the remote host</div>
              </div>

              <div className="bg-bg-elevated rounded-lg p-3 border border-border">
                <div className="font-medium text-text mb-1">🔗 Restart SSH tunnel</div>
                <code className="text-[12px] text-accent font-mono block break-all">ssh -f -N -L 7777:localhost:7777 user@your-remote-host</code>
              </div>

              <div className="bg-bg-elevated rounded-lg p-3 border border-border">
                <div className="font-medium text-text mb-1">🥧 Restart dashboard</div>
                <code className="text-[12px] text-accent font-mono block break-all">ssh user@your-remote-host 'tmux new-session -d -s pi-dash "cd ~/pi-dashboard && node backend/server.js"'</code>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                className="flex-1 py-2 rounded-lg text-[13px] font-medium cursor-pointer bg-accent text-white border-none hover:opacity-90 transition-opacity"
                onClick={() => window.location.reload()}
              >
                🔄 Retry Now
              </button>
              <button
                className="px-4 py-2 rounded-lg text-[13px] font-medium cursor-pointer bg-transparent text-muted border border-border hover:text-text hover:border-border-strong transition-all"
                onClick={() => {
                  navigator.clipboard.writeText('ssh -f -N -L 7777:localhost:7777 user@your-remote-host')
                }}
              >
                📋 Copy fix
              </button>
            </div>

            <div className="mt-3 text-center">
              <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                Auto-retrying in background
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
