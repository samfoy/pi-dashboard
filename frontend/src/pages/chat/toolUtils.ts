/** Generate a unified diff string from edits array. */
export function generateEditDiff(filePath: string, edits: { oldText: string; newText: string }[]): string {
  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`]
  for (const edit of edits) {
    const oldLines = edit.oldText.split('\n')
    const newLines = edit.newText.split('\n')
    lines.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`)
    for (const line of oldLines) lines.push(`-${line}`)
    for (const line of newLines) lines.push(`+${line}`)
  }
  return lines.join('\n')
}

/** Try to parse edit tool args into { path, edits }. */
export function parseEditArgs(args: string): { path: string; edits: { oldText: string; newText: string }[] } | null {
  try {
    const parsed = JSON.parse(args)
    if (!parsed.path) return null
    // New format: { path, edits: [{ oldText, newText }] }
    if (Array.isArray(parsed.edits) && parsed.edits.length > 0 && typeof parsed.edits[0].oldText === 'string') {
      return { path: parsed.path, edits: parsed.edits }
    }
    // Legacy format: { path, oldText, newText }
    if (typeof parsed.oldText === 'string' && typeof parsed.newText === 'string') {
      return { path: parsed.path, edits: [{ oldText: parsed.oldText, newText: parsed.newText }] }
    }
  } catch { /* not JSON or missing fields */ }
  return null
}

/** Try to parse write tool args into { path, content }. */
export function parseWriteArgs(args: string): { path: string; content: string } | null {
  try {
    const parsed = JSON.parse(args)
    if (parsed.path && typeof parsed.content === 'string') {
      return { path: parsed.path, content: parsed.content }
    }
  } catch { /* ignore */ }
  return null
}

/** Guess a language from a file extension for syntax highlighting. */
export function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', java: 'java', json: 'json', yaml: 'yaml',
    yml: 'yaml', css: 'css', html: 'xml', xml: 'xml', sql: 'sql',
    md: 'markdown', sh: 'bash', bash: 'bash', zsh: 'bash',
  }
  return map[ext] || ''
}
