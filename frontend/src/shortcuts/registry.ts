export type ActionCategory = 'navigation' | 'general' | 'editing'

export interface ActionDef {
  id: string
  keys?: string           // 'mod+k', 'mod+shift+e', 'Escape', etc. "mod" = Cmd on Mac, Ctrl elsewhere
  defaultKeys?: string    // original default (for reset)
  description: string
  paletteLabel?: string
  category: ActionCategory
  callback?: () => void
  when?: () => boolean
}

interface ParsedKey {
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

const isMac = typeof navigator !== 'undefined' && (navigator.platform?.includes('Mac') ?? false)

// Parse 'mod+shift+k' into structured form — cached per string
const parseCache = new Map<string, ParsedKey>()
function parseKeys(keys: string): ParsedKey {
  const cached = parseCache.get(keys)
  if (cached) return cached
  const parts = keys.toLowerCase().split('+')
  const parsed: ParsedKey = {
    ctrl: parts.includes('mod') || parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    key: parts.filter(p => p !== 'mod' && p !== 'ctrl' && p !== 'shift' && p !== 'alt')[0] || '',
  }
  parseCache.set(keys, parsed)
  return parsed
}

// Central action definitions — callbacks registered at runtime by components
export const ACTIONS: Record<string, ActionDef> = {
  commandPalette:  { id: 'commandPalette',  keys: 'mod+shift+p', description: 'Command palette',       category: 'general' },
  sessionPicker:   { id: 'sessionPicker',    keys: 'mod+p',       description: 'Session picker',        category: 'general' },
  goChat:          { id: 'goChat',           keys: 'mod+1',       description: 'Go to Chat',            category: 'navigation' },
  goSystem:        { id: 'goSystem',         keys: 'mod+2',       description: 'Go to System',          category: 'navigation' },
  goLogs:          { id: 'goLogs',           keys: 'mod+3',       description: 'Go to Logs',            category: 'navigation' },
  goSettings:      { id: 'goSettings',       keys: 'mod+4',       description: 'Go to Settings',        category: 'navigation' },
  toggleSidebar:   { id: 'toggleSidebar',    keys: 'mod+\\',      description: 'Toggle sidebar',        category: 'general' },
  showShortcuts:   { id: 'showShortcuts',    keys: '/',            description: 'Show shortcuts',        category: 'general' },
  escape:          { id: 'escape',           keys: 'Escape',       description: 'Close / Stop',          category: 'general' },
  closeSession:    { id: 'closeSession',     keys: 'mod+w',        description: 'Close session',         category: 'general' },
  newSession:      { id: 'newSession',       keys: 'mod+n',        description: 'New session',           category: 'general' },
  focusInput:      { id: 'focusInput',       keys: 'mod+l',        description: 'Focus input',           category: 'editing' },
  searchMessages:  { id: 'searchMessages',   keys: 'mod+f',        description: 'Search messages',       category: 'editing' },
  themePicker:     { id: 'themePicker',      keys: 'mod+shift+t',  description: 'Theme picker',          category: 'general' },
  systemPrompt:    { id: 'systemPrompt',     keys: 'mod+shift+i',  description: 'Show system prompt',    category: 'general' },
  resumeSession:   { id: 'resumeSession',    keys: 'mod+shift+h',  description: 'Resume session…',       category: 'general' },
}

// Store default keys on init + load overrides from localStorage
const STORAGE_KEY = 'pidash-shortcut-overrides'

function initDefaults() {
  for (const a of Object.values(ACTIONS)) {
    a.defaultKeys = a.keys
  }
  loadOverrides()
}

function loadOverrides() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const overrides: Record<string, string> = JSON.parse(raw)
    for (const [id, keys] of Object.entries(overrides)) {
      if (ACTIONS[id]) {
        ACTIONS[id].keys = keys || undefined
        parseCache.delete(keys) // ensure fresh parse
      }
    }
  } catch { /* ignore corrupt data */ }
}

function saveOverrides() {
  const overrides: Record<string, string> = {}
  for (const a of Object.values(ACTIONS)) {
    if (a.keys !== a.defaultKeys) overrides[a.id] = a.keys || ''
  }
  if (Object.keys(overrides).length) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

initDefaults()

/** Set a custom key binding for an action. Pass empty string to unbind. */
export function setShortcut(id: string, keys: string) {
  const action = ACTIONS[id]
  if (!action) return
  action.keys = keys || undefined
  saveOverrides()
  _notifyListeners()
}

/** Reset a single shortcut to its default */
export function resetShortcut(id: string) {
  const action = ACTIONS[id]
  if (!action) return
  action.keys = action.defaultKeys
  saveOverrides()
  _notifyListeners()
}

/** Reset all shortcuts to defaults */
export function resetAllShortcuts() {
  for (const a of Object.values(ACTIONS)) a.keys = a.defaultKeys
  localStorage.removeItem(STORAGE_KEY)
  _notifyListeners()
}

/** Check if any shortcuts have been customized */
export function hasCustomShortcuts(): boolean {
  return Object.values(ACTIONS).some(a => a.keys !== a.defaultKeys)
}

// Change listeners — so the Settings UI can re-render
type Listener = () => void
const _listeners = new Set<Listener>()
export function subscribeShortcuts(fn: Listener): () => void {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}
function _notifyListeners() { _listeners.forEach(fn => fn()) }

/** Convert a KeyboardEvent to a key string like 'mod+shift+k' */
export function eventToKeyString(e: KeyboardEvent): string | null {
  const key = e.key
  // Ignore bare modifier presses
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(key)) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  // Normalize key name
  const normalized = key === ' ' ? 'space' : key.length === 1 ? key.toLowerCase() : key
  parts.push(normalized)
  return parts.join('+')
}

/** Register a runtime callback (and optional `when` guard) for an action. Returns unregister fn. */
export function registerAction(id: string, opts: { callback: () => void, when?: () => boolean }): () => void {
  const action = ACTIONS[id]
  if (!action) return () => {}
  action.callback = opts.callback
  action.when = opts.when
  return () => {
    if (action.callback === opts.callback) action.callback = undefined
    if (action.when === opts.when) action.when = undefined
  }
}

/** Format key string for display: 'mod+shift+p' → '⌘⇧P' on Mac, 'Ctrl+Shift+P' on PC */
export function formatKey(keys: string): string {
  const parts = keys.split('+')
  return parts.map(p => {
    const lp = p.toLowerCase()
    if (lp === 'mod' || lp === 'ctrl') return isMac ? '⌘' : 'Ctrl'
    if (lp === 'shift') return isMac ? '⇧' : 'Shift'
    if (lp === 'alt') return isMac ? '⌥' : 'Alt'
    if (lp === 'escape') return 'Esc'
    if (lp === 'space') return 'Space'
    if (p === '\\') return '\\'
    return p.toUpperCase()
  }).join(isMac ? '' : '+')
}

/** Get actions suitable for command palette display */
export function getActionsForPalette(): ActionDef[] {
  return Object.values(ACTIONS).filter(a => {
    if (a.when && !a.when()) return false
    return !!a.callback
  })
}

/** Get actions grouped by category — for shortcuts help modal */
export function getShortcutsByCategory(): Record<ActionCategory, ActionDef[]> {
  const result: Record<ActionCategory, ActionDef[]> = { navigation: [], general: [], editing: [] }
  for (const a of Object.values(ACTIONS)) {
    if (a.keys) result[a.category].push(a)
  }
  return result
}

/** Match a KeyboardEvent against the registry. Returns the matching action or undefined. */
export function matchEvent(e: KeyboardEvent): ActionDef | undefined {
  for (const action of Object.values(ACTIONS)) {
    if (!action.keys || !action.callback) continue
    const parsed = parseKeys(action.keys)
    const modOk = parsed.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey)
    const shiftOk = parsed.shift ? e.shiftKey : !e.shiftKey
    const keyOk = e.key.toLowerCase() === parsed.key.toLowerCase()
    if (keyOk && modOk && shiftOk) return action
  }
  return undefined
}
