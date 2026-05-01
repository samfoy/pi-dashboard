/**
 * Session diff — git diff enrichment for files changed by a session.
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, relative, isAbsolute } from 'path'
import { execSync } from 'child_process'
import type { FileDiffEntry } from '@shared/diff-types.js'

/**
 * Get git diffs for a list of file paths relative to cwd.
 * Returns only files that have actual changes.
 */
export function getFileDiffs(cwd: string, paths: string[]): { files: FileDiffEntry[]; isGitRepo: boolean } {
  if (!isGitRepo(cwd)) return { files: [], isGitRepo: false }

  const files: FileDiffEntry[] = []
  for (const filePath of paths) {
    const norm = normalizePath(filePath, cwd)
    if (!norm) continue
    const gitDiff = getGitDiff(cwd, norm)
    if (gitDiff) files.push({ path: norm, changes: [], gitDiff })
  }
  return { files, isGitRepo: true }
}

function getGitDiff(cwd: string, filePath: string): string | null {
  try {
    // Try tracked file diff first
    const diff = execSync(`git diff HEAD -- ${JSON.stringify(filePath)}`, {
      cwd, encoding: 'utf-8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    if (diff) return diff

    // Check for untracked/new files
    const status = execSync(`git status --porcelain -- ${JSON.stringify(filePath)}`, {
      cwd, encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    if (status.startsWith('??') || status.startsWith('A')) {
      const absPath = resolve(cwd, filePath)
      if (!existsSync(absPath)) return null
      const content = readFileSync(absPath, 'utf-8')
      const lines = content.split('\n')
      return [
        `diff --git a/${filePath} b/${filePath}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${filePath}`,
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map(l => `+${l}`),
      ].join('\n')
    }

    return null
  } catch {
    return null
  }
}

function normalizePath(rawPath: string, cwd: string): string | null {
  const absPath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath)
  const rel = relative(cwd, absPath)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return rel
}

function isGitRepo(cwd: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd, encoding: 'utf-8', timeout: 3_000, stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch { return false }
}
