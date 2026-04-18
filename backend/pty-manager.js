/**
 * PTY Manager — spawns real shell sessions over WebSocket.
 */
import pty from 'node-pty'
import os from 'os'

const shells = new Map() // ws → pty

export function handlePtyConnection(ws, req) {
  const params = new URL(req.url, 'http://localhost').searchParams
  const cwd = params.get('cwd') || process.env.HOME || '/tmp'
  const cols = parseInt(params.get('cols') || '120', 10)
  const rows = parseInt(params.get('rows') || '30', 10)
  const shell = process.env.SHELL || '/bin/bash'

  let proc
  try {
    proc = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols, rows, cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    })
  } catch (err) {
    console.error('⚠ PTY spawn failed (non-fatal):', err.message)
    if (ws.readyState === 1) ws.close(1011, 'PTY spawn failed')
    return
  }

  shells.set(ws, proc)

  proc.onData((data) => {
    if (ws.readyState === 1) ws.send(data)
  })

  proc.onExit(() => {
    shells.delete(ws)
    if (ws.readyState === 1) ws.close()
  })

  ws.on('message', (raw) => {
    const msg = typeof raw === 'string' ? raw : raw.toString()
    // JSON control messages
    if (msg[0] === '{') {
      try {
        const cmd = JSON.parse(msg)
        if (cmd.type === 'resize') proc.resize(cmd.cols, cmd.rows)
        return
      } catch { /* not JSON, pass through */ }
    }
    proc.write(msg)
  })

  ws.on('close', () => {
    proc.kill()
    shells.delete(ws)
  })
}

export function shutdownAll() {
  for (const [, proc] of shells) proc.kill()
  shells.clear()
}
