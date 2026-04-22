/**
 * Track directory usage frequency for sorting recent/frequent directories.
 * Stored in localStorage as { [path]: count }.
 */

const LS_KEY = 'mc-dir-frequency'

export interface DirFreq {
  path: string
  count: number
  lastUsed: number
}

interface FreqStore {
  [path: string]: { count: number; lastUsed: number }
}

function load(): FreqStore {
  try {
    const saved = localStorage.getItem(LS_KEY)
    return saved ? JSON.parse(saved) : {}
  } catch { return {} }
}

function save(store: FreqStore) {
  localStorage.setItem(LS_KEY, JSON.stringify(store))
}

/** Record a directory being used (session created in it). */
export function recordDirUsage(path: string) {
  const store = load()
  const existing = store[path] || { count: 0, lastUsed: 0 }
  store[path] = { count: existing.count + 1, lastUsed: Date.now() }
  save(store)
}

/** Get all tracked directories sorted by frequency (descending), then recency. */
export function getFrequentDirs(): DirFreq[] {
  const store = load()
  return Object.entries(store)
    .map(([path, { count, lastUsed }]) => ({ path, count, lastUsed }))
    .sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed)
}

/** Remove a directory from frequency tracking. */
export function removeDirFreq(path: string) {
  const store = load()
  delete store[path]
  save(store)
}

// Migrate pinned dirs to frequency store on first load
const PINNED_LS_KEY = 'mc-pinned-dirs'
const MIGRATED_KEY = 'mc-pinned-migrated'

export function migratePinnedDirs() {
  if (localStorage.getItem(MIGRATED_KEY)) return
  try {
    const pinned = localStorage.getItem(PINNED_LS_KEY)
    if (pinned) {
      const dirs: string[] = JSON.parse(pinned)
      const store = load()
      for (const dir of dirs) {
        if (!store[dir]) {
          store[dir] = { count: 1, lastUsed: Date.now() }
        }
      }
      save(store)
    }
  } catch {}
  localStorage.setItem(MIGRATED_KEY, '1')
}
