/**
 * Pi Dashboard Desktop — Electron wrapper
 * Connects to a local or remote pi-dashboard server.
 * For remote servers, manages an SSH tunnel automatically.
 */
const { app, BrowserWindow, Tray, Menu, dialog, nativeImage, shell } = require('electron')
const { spawn, execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const Store = require('electron-store')

const store = new Store({
  defaults: {
    host: process.env.PI_DASH_HOST || 'localhost',
    user: process.env.USER || 'user',
    remotePort: 7777,
    localPort: 7777,
  }
})

let win = null
let tray = null
let tunnelAlive = false
let healthInterval = null

const HOST = store.get('host')
const USER = store.get('user')
const REMOTE_PORT = store.get('remotePort')
const LOCAL_PORT = store.get('localPort')
const DASH_URL = `http://localhost:${LOCAL_PORT}`
const IS_LOCAL = HOST === 'localhost' || HOST === '127.0.0.1'

// ── SSH Tunnel (remote only) ──

function isTunnelAlive() {
  if (IS_LOCAL) return true
  try {
    execSync(`lsof -i :${LOCAL_PORT} -sTCP:LISTEN -t 2>/dev/null`, { encoding: 'utf-8' })
    return true
  } catch { return false }
}

function killStaleTunnel() {
  try {
    const pids = execSync(`lsof -i :${LOCAL_PORT} -sTCP:LISTEN -t 2>/dev/null`, { encoding: 'utf-8' }).trim()
    if (pids) {
      for (const pid of pids.split('\n')) {
        try { process.kill(parseInt(pid)) } catch {}
      }
    }
  } catch {}
}

function startTunnel() {
  return new Promise((resolve) => {
    killStaleTunnel()
    setTimeout(() => {
      const proc = spawn('ssh', [
        '-f', '-N',
        '-L', `${LOCAL_PORT}:localhost:${REMOTE_PORT}`,
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ConnectTimeout=10',
        '-o', 'StrictHostKeyChecking=accept-new',
        `${USER}@${HOST}`
      ], { stdio: 'ignore', detached: true })

      proc.unref()
      proc.on('close', (code) => {
        if (code === 0) {
          tunnelAlive = true
          resolve(true)
        } else {
          tunnelAlive = false
          resolve(false)
        }
      })
      proc.on('error', () => { tunnelAlive = false; resolve(false) })

      // ssh -f forks to background and exits 0 quickly
      setTimeout(() => {
        tunnelAlive = isTunnelAlive()
        resolve(tunnelAlive)
      }, 3000)
    }, 500)
  })
}

function ensureTunnel() {
  if (isTunnelAlive()) {
    tunnelAlive = true
    return Promise.resolve(true)
  }
  return startTunnel()
}

// ── Dashboard health ──

async function isDashboardUp() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const resp = await fetch(`${DASH_URL}/api/status`, { signal: controller.signal })
    clearTimeout(timeout)
    return resp.ok
  } catch { return false }
}

// ── Window ──

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Pi Dashboard',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    trafficLightPosition: { x: 12, y: 16 },
    backgroundColor: '#12141a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { win = null })

  // Open external links in browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.startsWith(DASH_URL)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
}

function loadDashboard() {
  if (!win) return
  win.loadURL(DASH_URL).catch(() => {
    // Dashboard not ready — show overlay
    win.loadFile(path.join(__dirname, 'overlay.html'))
  })
}

function showOverlay() {
  if (!win) return
  win.loadFile(path.join(__dirname, 'overlay.html'))
}

// ── Tray ──

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png')
  let image
  if (fs.existsSync(iconPath)) {
    image = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
    image.setTemplateImage(true)
  } else {
    image = nativeImage.createEmpty()
  }
  tray = new Tray(image)
  updateTrayMenu()
}

function updateTrayMenu() {
  if (!tray) return
  const statusLabel = IS_LOCAL
    ? (tunnelAlive ? '✅ Local' : '❌ Not Responding')
    : (tunnelAlive ? '✅ Tunnel Connected' : '❌ Tunnel Down')
  const menu = Menu.buildFromTemplate([
    { label: 'Pi Dashboard', enabled: false },
    { type: 'separator' },
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    { label: 'Open Dashboard', click: () => { if (win) { win.show(); win.focus() } else { createWindow(); loadDashboard() } } },
    ...(!IS_LOCAL ? [{ label: 'Reconnect Tunnel', click: () => reconnect() }] : []),
    { type: 'separator' },
    {
      label: 'Settings',
      submenu: [
        { label: `Host: ${HOST}`, enabled: false },
        ...(!IS_LOCAL ? [{ label: `User: ${USER}`, enabled: false }] : []),
        { label: `Port: ${LOCAL_PORT}${!IS_LOCAL ? ` → ${REMOTE_PORT}` : ''}`, enabled: false },
        { type: 'separator' },
        { label: 'Edit Settings…', click: () => editSettings() },
      ]
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { cleanup(); app.quit() } },
  ])
  tray.setContextMenu(menu)
  tray.setToolTip(tunnelAlive ? 'Pi Dashboard — Connected' : 'Pi Dashboard — Disconnected')
}

async function editSettings() {
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Pi Dashboard Settings',
    message: `Host: ${HOST}\n${!IS_LOCAL ? `User: ${USER}\n` : ''}Local Port: ${LOCAL_PORT}\n${!IS_LOCAL ? `Remote Port: ${REMOTE_PORT}\n` : ''}\nSettings stored in: ${store.path}`,
    buttons: ['OK', 'Open Config File'],
  })
  if (response === 1) shell.openPath(store.path)
}

// ── Flows ──

async function reconnect() {
  if (win) showOverlay()
  tunnelAlive = false
  updateTrayMenu()

  const ok = await startTunnel()
  tunnelAlive = ok
  updateTrayMenu()

  if (ok && win) {
    setTimeout(() => loadDashboard(), 1000)
  }
}

async function initialConnect() {
  showOverlay()

  if (IS_LOCAL) {
    tunnelAlive = true
  } else {
    tunnelAlive = await ensureTunnel()
  }
  updateTrayMenu()

  if (!tunnelAlive) return

  const up = await isDashboardUp()
  if (up) loadDashboard()
}

// ── Health watchdog ──

function startHealthCheck() {
  healthInterval = setInterval(async () => {
    const alive = IS_LOCAL ? true : isTunnelAlive()
    // For local mode, check dashboard directly
    if (IS_LOCAL) {
      const up = await isDashboardUp()
      if (up !== tunnelAlive) {
        tunnelAlive = up
        updateTrayMenu()
        if (up && win && !win.isDestroyed()) loadDashboard()
        else if (!up && win && !win.isDestroyed()) showOverlay()
      }
      return
    }
    if (alive !== tunnelAlive) {
      tunnelAlive = alive
      updateTrayMenu()
      if (!alive && win && !win.isDestroyed()) {
        showOverlay()
        setTimeout(() => reconnect(), 2000)
      } else if (alive && win && !win.isDestroyed()) {
        const up = await isDashboardUp()
        if (up) loadDashboard()
      }
    }
  }, 10000)
}

function cleanup() {
  if (healthInterval) clearInterval(healthInterval)
}

// ── App lifecycle ──

app.whenReady().then(() => {
  createTray()
  createWindow()
  initialConnect()
  startHealthCheck()

  app.on('activate', () => {
    if (!win) { createWindow(); loadDashboard() }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { cleanup(); app.quit() }
})

app.on('before-quit', cleanup)
