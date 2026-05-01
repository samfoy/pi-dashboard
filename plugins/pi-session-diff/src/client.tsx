// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Pi Session Diff plugin — sidebar panel showing files modified in the current session.
 *
 * Scans chat messages for edit/write tool calls and extracts file paths.
 * Groups by directory, shows counts, and links to open files.
 * Returns null when no files modified — sidebar hides entirely.
 */
import { useState, useMemo } from 'react'
import { useAppSelector } from '../../../frontend/src/store'

function shortenPath(p: string): string {
  return p.replace(/^\/local\/home\/[^/]+\//, '~/').replace(/^\/home\/[^/]+\//, '~/')
}

function dirName(p: string): string {
  const parts = p.split('/')
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '.'
}

function fileName(p: string): string {
  return p.split('/').pop() || p
}

interface ModifiedFile {
  path: string
  tool: 'edit' | 'write'
  isError: boolean
}

function extractModifiedFiles(messages: { role: string; meta?: Record<string, unknown> }[]): ModifiedFile[] {
  const seen = new Map<string, ModifiedFile>()

  for (const msg of messages) {
    if (msg.role !== 'tool') continue
    const toolName = msg.meta?.toolName as string
    if (toolName !== 'edit' && toolName !== 'write') continue

    const args = msg.meta?.args as string
    if (!args) continue

    let path: string | undefined
    try {
      const parsed = JSON.parse(args)
      path = parsed.path
    } catch { continue }

    if (!path) continue
    const isError = !!(msg.meta?.isError)

    seen.set(path, { path, tool: toolName as 'edit' | 'write', isError })
  }

  return Array.from(seen.values())
}

export function SessionDiffPanel() {
  const messages = useAppSelector(s => s.chat.messages)
  const [open, setOpen] = useState(false)

  const files = useMemo(() => extractModifiedFiles(messages), [messages])

  if (files.length === 0) return null

  // Group by directory
  const grouped = useMemo(() => {
    const map = new Map<string, ModifiedFile[]>()
    for (const f of files) {
      const dir = dirName(f.path)
      if (!map.has(dir)) map.set(dir, [])
      map.get(dir)!.push(f)
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [files])

  const errorCount = files.filter(f => f.isError).length

  // Collapsed: just a thin clickable strip
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex-none w-8 border-l border-border bg-bg hover:bg-bg-hover flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
        title={`${files.length} file${files.length !== 1 ? 's' : ''} changed — click to expand`}
      >
        <span className="text-[12px]">✎</span>
        <span className="text-[11px] text-accent font-mono font-bold">{files.length}</span>
      </button>
    )
  }

  return (
    <div className="h-full flex flex-col border-l border-border bg-bg" style={{ flex: '0 0 240px' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-bg-hover/30 shrink-0">
        <span className="text-[13px]">✎</span>
        <span className="text-[13px] font-semibold text-text">Changed Files</span>
        <span className="text-[11px] text-muted ml-auto">
          {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
        {errorCount > 0 && (
          <span className="text-[10px] text-danger font-medium">{errorCount} err</span>
        )}
        <button
          onClick={() => setOpen(false)}
          className="text-[11px] text-muted hover:text-text bg-transparent border-none cursor-pointer"
          title="Collapse"
        >
          ✕
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {grouped.map(([dir, dirFiles]) => (
          <div key={dir} className="mb-1.5">
            <div className="text-[10px] text-muted font-mono px-2 py-1 truncate" title={dir}>
              {shortenPath(dir)}
            </div>
            {dirFiles.map(f => (
              <div
                key={f.path}
                className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-bg-hover/50 text-[12px] cursor-default group"
                title={f.path}
              >
                <span className={`text-[10px] shrink-0 ${f.isError ? 'text-danger' : f.tool === 'write' ? 'text-ok' : 'text-accent'}`}>
                  {f.isError ? '✗' : f.tool === 'write' ? '+' : '~'}
                </span>
                <span className={`font-mono truncate flex-1 ${f.isError ? 'text-danger/70' : 'text-text/80'}`}>
                  {fileName(f.path)}
                </span>
                <span className="text-[10px] text-muted/50 shrink-0 opacity-0 group-hover:opacity-100">
                  {f.tool}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
