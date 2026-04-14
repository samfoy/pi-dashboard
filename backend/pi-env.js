/**
 * Pi environment data — reads real data from the pi setup, vault, crontab, etc.
 * Uses sqlite3 CLI for memory DB access (avoids native module compilation).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { extractText } from './session-store.js'

const HOME = homedir()
const PI_DIR = join(HOME, '.pi', 'agent')
const MEMORY_DB = join(HOME, '.pi', 'memory', 'memory.db')
const VAULT_DIR = join(HOME, 'vault')
const SESSIONS_DIR = join(PI_DIR, 'sessions')

// ── SQLite helper (via CLI) ──

function sqliteQuery(sql) {
  if (!existsSync(MEMORY_DB)) return []
  try {
    const raw = execSync(
      `sqlite3 -json "${MEMORY_DB}" ${JSON.stringify(sql)}`,
      { encoding: 'utf-8', timeout: 5000 }
    )
    return JSON.parse(raw)
  } catch { return [] }
}

// ── Memory ──

export function getLessons(limit = 100) {
  return sqliteQuery(
    `SELECT id, rule, category, negative, created_at FROM lessons WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ${limit}`
  )
}

export function getFacts() {
  return sqliteQuery(
    'SELECT key, value, confidence, source, updated_at FROM semantic ORDER BY updated_at DESC'
  )
}

export function getMemoryStats() {
  const r = (sql) => { const rows = sqliteQuery(sql); return rows[0]?.c || 0 }
  return {
    facts: r('SELECT count(*) as c FROM semantic'),
    lessons: r('SELECT count(*) as c FROM lessons WHERE is_deleted = 0'),
    events: r('SELECT count(*) as c FROM events'),
    episodic: r('SELECT count(*) as c FROM episodic_memories'),
  }
}

// ── Sessions ──

export function getRecentSessions(limit = 30) {
  const sessions = []
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
        let title = f.replace('.jsonl', '')
        try {
          const head = readFileSync(filePath, 'utf-8').slice(0, 8000)
          const lines = head.split('\n').filter(Boolean)
          for (const line of lines) {
            try {
              const obj = JSON.parse(line)
              if (obj.sessionName) { title = obj.sessionName; break }
              if (obj.type === 'message' && obj.message?.role === 'user') {
                const text = extractText(obj.message.content, ' ')
                if (text) { title = text.slice(0, 100).replace(/\n/g, ' '); break }
              }
            } catch {}
          }
        } catch {}
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
  } catch {}
  // Exclude hook-generated sessions (e.g. memory extraction on session close)
  const EXCLUDED_PREFIXES = ['You are a memory extraction system']

  return sessions
    .filter(s => !EXCLUDED_PREFIXES.some(p => s.title.startsWith(p)))
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .slice(0, limit)
}

// ── Skills ──

export function getSkills() {
  const skillsDir = join(PI_DIR, 'skills')
  if (!existsSync(skillsDir)) return []
  const skills = []
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
  } catch {}
  return skills
}

// ── Extensions ──

export function getExtensions() {
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

export function getCrontab() {
  try {
    const raw = execSync('crontab -l 2>/dev/null', { encoding: 'utf-8' })
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

export function getVaultStats() {
  const stats = { dailyNotes: 0, taskNotes: 0, meetingNotes: 0, persons: 0, recentDaily: '' }
  try {
    const dn = join(VAULT_DIR, 'Daily Notes')
    if (existsSync(dn)) {
      const files = readdirSync(dn).filter(f => f.endsWith('.md')).sort()
      stats.dailyNotes = files.length
      stats.recentDaily = files[files.length - 1]?.replace('.md', '') || ''
    }
    const tn = join(VAULT_DIR, 'TaskNotes', 'Tasks')
    if (existsSync(tn)) stats.taskNotes = readdirSync(tn).filter(f => f.endsWith('.md')).length
    const mn = join(VAULT_DIR, 'Meeting Notes')
    if (existsSync(mn)) stats.meetingNotes = readdirSync(mn).filter(f => f.endsWith('.md')).length
    const pn = join(VAULT_DIR, 'Person')
    if (existsSync(pn)) stats.persons = readdirSync(pn).filter(f => f.endsWith('.md')).length
  } catch {}
  return stats
}

export function getDailyNote(date) {
  const file = join(VAULT_DIR, 'Daily Notes', `${date}.md`)
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf-8')
}

export function getRecentDailyNotes(limit = 7) {
  const dn = join(VAULT_DIR, 'Daily Notes')
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
