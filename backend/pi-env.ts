/**
 * Pi environment data — reads real data from the pi setup, vault, crontab, etc.
 * Uses sqlite3 CLI for memory DB access (avoids native module compilation).
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { extractText } from './session-store.js'

const HOME = homedir()
const PI_DIR = join(HOME, '.pi', 'agent')
const MEMORY_DB = join(HOME, '.pi', 'memory', 'memory.db')
const SESSIONS_DIR = join(PI_DIR, 'sessions')
const DASH_CONFIG_PATH = join(HOME, '.pi', 'dashboard.json')

// ── Interfaces ──

interface VaultDirs {
  daily: string
  tasks: string
  meetings: string
  people: string
  recipes: string
}

interface VaultConfig {
  path: string
  dirs: VaultDirs
}

interface DashConfig {
  vault: VaultConfig
  [key: string]: unknown
}

interface MemoryStats {
  facts: number
  lessons: number
  events: number
}

interface Lesson {
  id: string
  rule: string
  category: string
  negative: number
  created_at: string
}

interface Fact {
  key: string
  value: string
  confidence: number
  source: string
  updated_at: string
}

interface SessionSummary {
  key: string
  title: string
  project: string
  created: string
  modified: string
  size: number
}

interface Skill {
  name: string
  description: string
}

interface Extension {
  name: string
  file: string
  description: string
}

interface CrontabEntry {
  schedule: string
  command: string
  raw: string
}

interface VaultStats {
  path: string
  dailyNotes: number
  taskNotes: number
  meetingNotes: number
  persons: number
  recipes: number
  recentDaily: string
}

interface DailyNoteSummary {
  date: string
  size: number
}

// ── Dashboard config (vault path etc.) ──

const DEFAULT_DASH_CONFIG: DashConfig = {
  vault: {
    path: '',  // empty = disabled
    dirs: {
      daily: 'Daily',
      tasks: 'TaskNotes/Tasks',
      meetings: 'Meeting Notes',
      people: 'People',
      recipes: 'Recipes',
    },
  },
}

let _dashConfig: DashConfig | null = null

export function getDashConfig(): DashConfig {
  if (_dashConfig) return _dashConfig
  try {
    if (existsSync(DASH_CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(DASH_CONFIG_PATH, 'utf-8')) as Partial<DashConfig> & { vault?: Partial<VaultConfig> & { dirs?: Partial<VaultDirs> } }
      _dashConfig = { ...DEFAULT_DASH_CONFIG, ...raw, vault: { ...DEFAULT_DASH_CONFIG.vault, ...raw.vault, dirs: { ...DEFAULT_DASH_CONFIG.vault.dirs, ...(raw.vault?.dirs || {}) } } }
    } else {
      _dashConfig = DEFAULT_DASH_CONFIG
    }
  } catch {
    _dashConfig = DEFAULT_DASH_CONFIG
  }
  return _dashConfig!
}

export function saveDashConfig(config: Partial<DashConfig> & { vault?: Partial<VaultConfig> & { dirs?: Partial<VaultDirs> } }): DashConfig {
  _dashConfig = { ...DEFAULT_DASH_CONFIG, ...config, vault: { ...DEFAULT_DASH_CONFIG.vault, ...config.vault, dirs: { ...DEFAULT_DASH_CONFIG.vault.dirs, ...(config.vault?.dirs || {}) } } }
  const dir = join(HOME, '.pi')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(DASH_CONFIG_PATH, JSON.stringify(_dashConfig, null, 2) + '\n')
  return _dashConfig
}

function getVaultDir(): string {
  const cfg = getDashConfig()
  return cfg.vault?.path || ''
}

function getVaultSubdir(key: keyof VaultDirs): string {
  const cfg = getDashConfig()
  return cfg.vault?.dirs?.[key] || DEFAULT_DASH_CONFIG.vault.dirs[key]
}

// ── SQLite helper (via CLI) ──

function sqliteQuery(sql: string): unknown[] {
  if (!existsSync(MEMORY_DB)) return []
  try {
    const raw: string = execSync(
      `sqlite3 -json "${MEMORY_DB}" ${JSON.stringify(sql)}`,
      { encoding: 'utf-8', timeout: 5000 }
    )
    return JSON.parse(raw) as unknown[]
  } catch { return [] }
}

// ── Memory ──

export function getLessons(limit: number = 100): Lesson[] {
  return sqliteQuery(
    `SELECT id, rule, category, negative, created_at FROM lessons WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ${limit}`
  ) as Lesson[]
}

export function getFacts(): Fact[] {
  return sqliteQuery(
    'SELECT key, value, confidence, source, updated_at FROM semantic ORDER BY updated_at DESC'
  ) as Fact[]
}

export function getMemoryStats(): MemoryStats {
  const r = (sql: string): number => { try { const rows = sqliteQuery(sql) as Array<{ c: number }>; return rows[0]?.c || 0 } catch { return 0 } }
  return {
    facts: r('SELECT count(*) as c FROM semantic'),
    lessons: r('SELECT count(*) as c FROM lessons WHERE is_deleted = 0'),
    events: r('SELECT count(*) as c FROM events'),
  }
}

// ── Sessions ──

export function getRecentSessions(limit: number = 30): SessionSummary[] {
  const sessions: SessionSummary[] = []
  try {
    const dirs = readdirSync(SESSIONS_DIR).filter(d => d.startsWith('--'))
    for (const dir of dirs) {
      const full = join(SESSIONS_DIR, dir)
      if (!statSync(full).isDirectory()) continue
      const files = readdirSync(full)
        .filter(f => f.endsWith('.jsonl'))
        .sort()
        .reverse()
      for (const f of files.slice(0, 5)) {
        const filePath = join(full, f)
        const stat = statSync(filePath)
        let title: string = f.replace('.jsonl', '')
        try {
          const head = readFileSync(filePath, 'utf-8').slice(0, 8000)
          const lines = head.split('\n').filter(Boolean)
          for (const line of lines) {
            try {
              const obj = JSON.parse(line) as { sessionName?: string; type?: string; message?: { role?: string; content?: unknown } }
              if (obj.sessionName) { title = obj.sessionName; break }
              if (obj.type === 'message' && obj.message?.role === 'user') {
                const text = extractText(obj.message.content as string | null, ' ')
                if (text) { title = text.slice(0, 100).replace(/\n/g, ' '); break }
              }
            } catch { /* skip malformed lines */ }
          }
        } catch { /* skip unreadable files */ }
        sessions.push({
          key: f.replace('.jsonl', ''),
          title,
          project: dir.replace(/^--/, '').replace(/--$/, '').replace(/--/g, '/'),
          created: stat.birthtime.toISOString(),
          modified: stat.mtime.toISOString(),
          size: stat.size,
        })
      }
    }
  } catch { /* skip if sessions dir missing */ }
  // Exclude hook-generated sessions (e.g. memory extraction on session close)
  const EXCLUDED_PREFIXES: string[] = ['You are a memory extraction system']

  return sessions
    .filter(s => !EXCLUDED_PREFIXES.some(p => s.title.startsWith(p)))
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .slice(0, limit)
}

// ── Skills ──

export function getSkills(): Skill[] {
  const skillsDir = join(PI_DIR, 'skills')
  if (!existsSync(skillsDir)) return []
  const skills: Skill[] = []
  try {
    for (const name of readdirSync(skillsDir)) {
      const skillFile = join(skillsDir, name, 'SKILL.md')
      if (!existsSync(skillFile)) continue
      const content = readFileSync(skillFile, 'utf-8').slice(0, 500)
      let description = ''
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (fmMatch) {
        const descMatch = fmMatch[1].match(/description:\s*(.+)/)
        if (descMatch) description = descMatch[1].trim()
      }
      skills.push({ name, description })
    }
  } catch { /* skip on error */ }
  return skills
}

// ── Extensions ──

export function getExtensions(): Extension[] {
  const extDir = join(PI_DIR, 'extensions')
  if (!existsSync(extDir)) return []
  try {
    return readdirSync(extDir)
      .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
      .map(f => {
        const content = readFileSync(join(extDir, f), 'utf-8').slice(0, 500)
        const commentMatch = content.match(/\/\/\s*(.+)/) || content.match(/\/\*\*?\s*\n?\s*\*?\s*(.+)/)
        return {
          name: f.replace(/\.(ts|js)$/, ''),
          file: f,
          description: commentMatch ? commentMatch[1].trim() : '',
        }
      })
  } catch { return [] }
}

// ── Crontab ──

export function getCrontab(): CrontabEntry[] {
  try {
    const raw: string = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' })
    return raw.split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(line => {
        const parts = line.match(/^(@\w+|[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+\s+[\d*\/,-]+)\s+(.+)$/)
        if (!parts) return { schedule: '', command: line, raw: line }
        return { schedule: parts[1], command: parts[2], raw: line }
      })
  } catch { return [] }
}

// ── Vault ──

export function getVaultStats(): VaultStats {
  const VAULT_DIR = getVaultDir()
  const stats: VaultStats = { path: VAULT_DIR, dailyNotes: 0, taskNotes: 0, meetingNotes: 0, persons: 0, recipes: 0, recentDaily: '' }
  if (!VAULT_DIR || !existsSync(VAULT_DIR)) return stats
  try {
    const dn = join(VAULT_DIR, getVaultSubdir('daily'))
    if (existsSync(dn)) {
      const files = readdirSync(dn).filter(f => f.endsWith('.md')).sort()
      stats.dailyNotes = files.length
      stats.recentDaily = files[files.length - 1]?.replace('.md', '') || ''
    }
    const tn = join(VAULT_DIR, getVaultSubdir('tasks'))
    if (existsSync(tn)) stats.taskNotes = readdirSync(tn).filter(f => f.endsWith('.md')).length
    const mn = join(VAULT_DIR, getVaultSubdir('meetings'))
    if (existsSync(mn)) stats.meetingNotes = readdirSync(mn).filter(f => f.endsWith('.md')).length
    const pn = join(VAULT_DIR, getVaultSubdir('people'))
    if (existsSync(pn)) stats.persons = readdirSync(pn).filter(f => f.endsWith('.md')).length
    const rn = join(VAULT_DIR, getVaultSubdir('recipes'))
    if (existsSync(rn)) stats.recipes = readdirSync(rn).filter(f => f.endsWith('.md')).length
  } catch { /* skip on error */ }
  return stats
}

export function getDailyNote(date: string): string | null {
  const VAULT_DIR = getVaultDir()
  if (!VAULT_DIR) return null
  const file = join(VAULT_DIR, getVaultSubdir('daily'), `${date}.md`)
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf-8')
}

export function getRecentDailyNotes(limit: number = 7): DailyNoteSummary[] {
  const VAULT_DIR = getVaultDir()
  if (!VAULT_DIR) return []
  const dn = join(VAULT_DIR, getVaultSubdir('daily'))
  if (!existsSync(dn)) return []
  return readdirSync(dn)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map(f => ({
      date: f.replace('.md', ''),
      size: statSync(join(dn, f)).size,
    }))
}
