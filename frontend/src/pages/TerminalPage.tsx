import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { loadFonts } from '@xterm/addon-web-fonts'
import '@xterm/xterm/css/xterm.css'
import { useAppSelector } from '../store'
import { api } from '../api/client'

export default function TerminalPage() {
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const slots = useAppSelector(s => s.dashboard.slots || [])
  const serverCwd = useAppSelector(s => s.dashboard.status?.cwd)
  const [cwd, setCwd] = useState(() => {
    return localStorage.getItem('pi-term-cwd') || ''
  })
  const [connected, setConnected] = useState(false)
  const [capturing, setCapturing] = useState(false)

  const connect = useCallback(async (targetCwd: string) => {
    // Ensure nerd font is fully loaded before xterm measures glyphs
    try { await loadFonts(['JetBrainsMono Nerd Font']) } catch {}

    // Tear down previous
    wsRef.current?.close()
    terminalRef.current?.dispose()

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light'
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'CaskaydiaCove Nerd Font', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: isDark ? {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#0d1117', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
        blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39d353', white: '#c9d1d9',
      } : {
        background: '#fafafa',
        foreground: '#3f3f46',
        cursor: '#d97706',
        selectionBackground: '#d4d4d8',
        black: '#18181b', red: '#dc2626', green: '#16a34a', yellow: '#d97706',
        blue: '#2563eb', magenta: '#7c3aed', cyan: '#0891b2', white: '#fafafa',
      },
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    const unicode11 = new Unicode11Addon()
    term.loadAddon(unicode11)
    term.unicode.activeVersion = '11'
    term.open(termRef.current!)
    fit.fit()

    terminalRef.current = term
    fitRef.current = fit

    const cols = term.cols
    const rows = term.rows
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({ cwd: targetCwd, cols: String(cols), rows: String(rows) })
    const ws = new WebSocket(`${proto}//${location.host}/api/terminal/ws?${params}`)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onerror = () => {} // Suppress console errors (PTY may be disabled server-side)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (e) => {
      const data = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)
      term.write(data)
    }

    term.onData((data) => {
      if (ws.readyState === 1) ws.send(data)
    })

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    })
  }, [])

  // Auto-connect on mount
  useEffect(() => {
    const initial = cwd || serverCwd || '/tmp'
    if (!cwd) setCwd(initial)
    connect(initial)

    const onResize = () => fitRef.current?.fit()
    window.addEventListener('resize', onResize)

    // Re-fit when container becomes visible (e.g. tab switch from display:none)
    const ro = new ResizeObserver(() => fitRef.current?.fit())
    if (termRef.current) ro.observe(termRef.current)

    return () => {
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      wsRef.current?.close()
      terminalRef.current?.dispose()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist cwd choice
  useEffect(() => {
    if (cwd) localStorage.setItem('pi-term-cwd', cwd)
  }, [cwd])

  const handleCwdChange = (newCwd: string) => {
    setCwd(newCwd)
    connect(newCwd)
  }

  // Capture terminal content and send to a pi chat slot
  const sendToPi = useCallback(async (slotKey: string) => {
    const term = terminalRef.current
    if (!term) return
    setCapturing(true)
    try {
      // Get the active selection, or fall back to visible buffer
      let text = term.getSelection()
      if (!text) {
        const buf = term.buffer.active
        const lines: string[] = []
        for (let i = Math.max(0, buf.baseY); i < buf.baseY + buf.viewportY + term.rows; i++) {
          const line = buf.getLine(i)
          if (line) lines.push(line.translateToString(true))
        }
        text = lines.join('\n').trimEnd()
      }
      if (!text) return

      const msg = `Here is terminal output for context:\n\n\`\`\`\n${text}\n\`\`\``
      await api.sendChat(msg, slotKey)
    } finally {
      setCapturing(false)
    }
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card shrink-0">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-ok' : 'bg-danger'}`} />
        <span className="text-[13px] text-muted font-mono truncate flex-1">{cwd}</span>

        {/* CWD picker */}
        <select
          className="text-[13px] bg-bg border border-border rounded px-2 py-1 text-text font-mono max-w-[200px]"
          value={cwd}
          onChange={(e) => handleCwdChange(e.target.value)}
        >
          {cwd && <option value={cwd}>{cwd.split('/').pop() || cwd}</option>}
          {slots.filter(s => s.cwd && s.cwd !== cwd).map(s => (
            <option key={s.key} value={s.cwd!}>{s.title} — {s.cwd!.split('/').pop()}</option>
          ))}
        </select>

        {/* Send to Pi */}
        <div className="relative group">
          <button
            className="text-[13px] bg-accent text-white border-none rounded px-3 py-1 cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50"
            disabled={capturing || slots.length === 0}
            onClick={() => {
              // If only one slot, send directly; otherwise show dropdown
              if (slots.length === 1) sendToPi(slots[0].key)
            }}
          >
            {capturing ? '…' : '📋 Send to Pi'}
          </button>
          {slots.length > 1 && (
            <div className="hidden group-hover:block absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-xl z-10 min-w-[200px] py-1">
              {slots.map(s => (
                <button
                  key={s.key}
                  className="w-full text-left px-3 py-1.5 text-[13px] text-text hover:bg-bg-hover cursor-pointer bg-transparent border-none font-body"
                  onClick={() => sendToPi(s.key)}
                >
                  {s.title || s.key}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="text-[13px] bg-bg border border-border rounded px-2 py-1 text-muted cursor-pointer hover:text-text hover:border-border-strong transition-colors"
          onClick={() => connect(cwd)}
          title="Reconnect"
        >
          🔄
        </button>
      </div>

      {/* Terminal */}
      <div ref={termRef} className="flex-1 min-h-0 bg-[#0d1117]" style={{ padding: '4px' }} />
    </div>
  )
}
