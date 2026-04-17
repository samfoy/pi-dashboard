import { useMemo } from 'react'
import type { ChatMessage } from '../types'

export interface ReferencedFile {
  path: string
  /** How the file was referenced */
  source: 'tool' | 'assistant' | 'user'
  /** Which tool referenced it (read, edit, write, etc.) */
  toolName?: string
  /** Index of first message that referenced this file */
  firstIndex: number
}

/** Match absolute or ~-relative paths — must have at least one slash and end with a file-like segment. */
const PATH_RE = /(?:^|\s|`)((?:\/|~\/)[^\s`'"(){}\[\]<>]+\.[\w]+)/g

/** Additional pattern for bare relative paths like src/foo/Bar.tsx */
const REL_PATH_RE = /(?:^|\s|`)((?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w@.-]+\.[\w]+)/g

/** Match bare filenames with known extensions (no slashes required). */
const BARE_FILE_RE = /(?:^|\s|`)([\w@.-]+\.(?:pdf|docx?|xlsx?|csv|png|jpe?g|gif|webp|svg|md|txt|tsx?|jsx?|py|rs|java|go|rb|sh|json|ya?ml|toml|css|html?|xml|sql))(?=\s|`|$|[,;:!?)])/gi

/** Extract file path from tool args JSON. */
function extractToolPath(args: string | undefined): string | null {
  if (!args) return null
  try {
    const parsed = JSON.parse(args)
    return parsed.path || null
  } catch {
    return null
  }
}

/** Tools that reference file paths in their args. */
const FILE_TOOLS = new Set([
  'read', 'edit', 'write', 'lsp_diagnostics', 'lsp_hover', 'lsp_definition',
  'lsp_references', 'lsp_symbols', 'lsp_rename', 'lsp_completions',
  'code_search', 'code_rewrite', 'code_overview',
])

export function useReferencedFiles(messages: ChatMessage[]): ReferencedFile[] {
  return useMemo(() => {
    const seen = new Map<string, ReferencedFile>()

    function add(path: string, source: ReferencedFile['source'], index: number, toolName?: string) {
      // Normalize: trim trailing punctuation, skip obviously not-file paths
      let p = path.replace(/[,;:!?)]+$/, '').trim()
      if (p.length < 3 || p.endsWith('/')) return
      // Skip glob patterns
      if (p.includes('*')) return
      // Skip URLs
      if (p.startsWith('http://') || p.startsWith('https://')) return

      if (!seen.has(p)) {
        seen.set(p, { path: p, source, toolName, firstIndex: index })
      }
    }

    messages.forEach((msg, i) => {
      // Tool calls — extract from meta.args
      if (msg.role === 'tool' && msg.meta) {
        const toolName = msg.meta.toolName as string | undefined
        if (toolName && FILE_TOOLS.has(toolName)) {
          const p = extractToolPath(msg.meta.args as string | undefined)
          if (p && p !== '*') add(p, 'tool', i, toolName)
        }
      }

      // Assistant/streaming messages — scan for paths in backticks and bare paths
      if (msg.role === 'assistant' || msg.role === 'streaming') {
        const content = msg.content || ''
        for (const m of content.matchAll(PATH_RE)) add(m[1], 'assistant', i)
        for (const m of content.matchAll(REL_PATH_RE)) add(m[1], 'assistant', i)
        for (const m of content.matchAll(BARE_FILE_RE)) add(m[1], 'assistant', i)
      }

      // User messages — scan for paths
      if (msg.role === 'user') {
        const content = msg.content || ''
        for (const m of content.matchAll(PATH_RE)) add(m[1], 'user', i)
        for (const m of content.matchAll(REL_PATH_RE)) add(m[1], 'user', i)
        for (const m of content.matchAll(BARE_FILE_RE)) add(m[1], 'user', i)
      }

      // Bash tool results — scan output for file references
      if (msg.role === 'tool' && msg.meta) {
        const toolName = msg.meta.toolName as string | undefined
        if (toolName === 'bash') {
          const result = (msg.meta.result as string) || ''
          for (const m of result.matchAll(PATH_RE)) add(m[1], 'tool', i, 'bash')
          for (const m of result.matchAll(REL_PATH_RE)) add(m[1], 'tool', i, 'bash')
          for (const m of result.matchAll(BARE_FILE_RE)) add(m[1], 'tool', i, 'bash')
        }
      }
    })

    // Sort: most recently referenced first
    return Array.from(seen.values()).sort((a, b) => b.firstIndex - a.firstIndex)
  }, [messages])
}
