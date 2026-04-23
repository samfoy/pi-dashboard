import { useState, useMemo } from 'react'
import DiffBlock from '../../components/DiffBlock'
import ResizableImage from '../../components/ResizableImage'
import SubagentCard from './SubagentCard'
import ProcessCard from './ProcessCard'
import { generateEditDiff, parseEditArgs, parseWriteArgs, langFromPath } from './toolUtils'

/** Expandable tool call block with args and result — shows diff view for edit tool, code preview for write */
export default function ToolCallBlock({ content, meta, onFileOpen }: { content: string; meta?: Record<string, unknown>; onFileOpen?: (path: string) => void }) {
  const toolName = (meta?.toolName as string) || content.replace('🔧 ', '')
  const [expanded, setExpanded] = useState(false)
  const args = meta?.args as string | undefined
  const result = meta?.result as string | undefined
  const isError = meta?.isError as boolean | undefined
  const hasDetails = !!(args || result)

  // For edit tool calls, parse args and generate diff
  const editDiff = useMemo(() => {
    if (toolName !== 'edit' || !args) return null
    const parsed = parseEditArgs(args)
    if (!parsed) return null
    return { diff: generateEditDiff(parsed.path, parsed.edits), path: parsed.path }
  }, [toolName, args])

  // For write tool calls, parse args to show file content nicely
  const writeInfo = useMemo(() => {
    if (toolName !== 'write' || !args) return null
    return parseWriteArgs(args)
  }, [toolName, args])

  // For read tool calls, parse args and use result as file content
  const readInfo = useMemo(() => {
    if (toolName !== 'read' || !args) return null
    try {
      const parsed = JSON.parse(args)
      if (!parsed.path) return null
      return { path: parsed.path as string, offset: parsed.offset as number | undefined, limit: parsed.limit as number | undefined }
    } catch { return null }
  }, [toolName, args])

  // Edit tool calls default to expanded (showing diff)
  const isEdit = !!editDiff
  const isWrite = !!writeInfo
  const isRead = !!readInfo
  const [editExpanded, setEditExpanded] = useState(false)
  const [writeExpanded, setWriteExpanded] = useState(false)
  const [readExpanded, setReadExpanded] = useState(false)

  // Early returns AFTER all hooks (Rules of Hooks compliance)
  if (toolName === 'subagent') return <SubagentCard meta={meta} />
  if (toolName === 'process') return <ProcessCard meta={meta} />

  if (isEdit) {
    return (
      <div className="msg-content bg-card border border-border rounded-md animate-scale-in">
        <button
          className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted font-mono bg-transparent border-none text-left hover:text-text transition-colors cursor-pointer"
          onClick={() => setEditExpanded(!editExpanded)}
        >
          <span className={`text-[11px] transition-transform ${editExpanded ? 'rotate-90' : ''}`}>▶</span>
          <span>✏️ edit</span>
          <span className="text-text/70 text-[12px] font-normal truncate">{editDiff.path}</span>
          {onFileOpen && <button className="text-accent text-[11px] font-medium hover:underline shrink-0 bg-transparent border-none cursor-pointer" onClick={e => { e.stopPropagation(); onFileOpen(editDiff.path) }}>Open</button>}
          {isError && <span className="text-danger text-[12px] ml-auto shrink-0">✗ error</span>}
          {result && !isError && <span className="text-ok text-[12px] ml-auto shrink-0">✓</span>}
        </button>
        {editExpanded && (
          <div className="px-2 pb-2">
            <DiffBlock code={editDiff.diff} complete={true} />
            {isError && result && (
              <div className="mt-1">
                <pre className="bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-danger">{result}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (isRead && result && !isError) {
    const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(readInfo.path)
    if (isImage) {
      const imgUrl = `/api/local-file?path=${encodeURIComponent(readInfo.path)}`
      const match = result.match(/!\[image\]\(([^)]+)\)/)
      const src = match ? match[1] : imgUrl
      return (
        <div className="msg-content bg-card border border-border rounded-md animate-scale-in">
          <button
            className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted font-mono bg-transparent border-none text-left hover:text-text transition-colors cursor-pointer"
            onClick={() => setReadExpanded(!readExpanded)}
          >
            <span className={`text-[11px] transition-transform ${readExpanded ? 'rotate-90' : ''}`}>▶</span>
            <span>🖼️ read</span>
            <span className="text-text/70 text-[12px] font-normal truncate">{readInfo.path.split('/').pop()}</span>
            {onFileOpen && <button className="text-accent text-[11px] font-medium hover:underline shrink-0 bg-transparent border-none cursor-pointer" onClick={e => { e.stopPropagation(); onFileOpen(readInfo.path) }}>Open</button>}
          </button>
          {readExpanded && (
            <div className="px-2 pb-2">
              <ResizableImage src={src} alt={readInfo.path.split('/').pop() || ''} />
            </div>
          )}
        </div>
      )
    }
    const lang = langFromPath(readInfo.path)
    const lineCount = result.split('\n').length
    const rangeLabel = readInfo.offset ? `lines ${readInfo.offset}–${readInfo.offset + (readInfo.limit || lineCount) - 1}` : `${lineCount} lines`
    return (
      <div className="msg-content bg-card border border-border rounded-md animate-scale-in">
        <button
          className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted font-mono bg-transparent border-none text-left hover:text-text transition-colors cursor-pointer"
          onClick={() => setReadExpanded(!readExpanded)}
        >
          <span className={`text-[11px] transition-transform ${readExpanded ? 'rotate-90' : ''}`}>▶</span>
          <span>📖 read</span>
          <span className="text-text/70 text-[12px] font-normal truncate">{readInfo.path}</span>
          {onFileOpen && <button className="text-accent text-[11px] font-medium hover:underline shrink-0 bg-transparent border-none cursor-pointer" onClick={e => { e.stopPropagation(); onFileOpen(readInfo.path) }}>Open</button>}
          <span className="text-muted/50 text-[12px] font-normal ml-auto shrink-0">{rangeLabel}</span>
        </button>
        {readExpanded && (
          <div className="px-2 pb-2">
            <div className="relative group">
              <div className="flex items-center justify-between bg-bg-elevated border border-border rounded-t-md px-3 py-1.5">
                <span className="text-muted text-[12px] font-mono uppercase">{lang || readInfo.path.split('/').pop()}</span>
                <button className="text-muted text-[12px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-text bg-transparent border-none font-body" onClick={() => navigator.clipboard.writeText(result)}>Copy</button>
              </div>
              <pre className="bg-bg-elevated border border-t-0 border-border rounded-b-md p-3 overflow-x-auto max-h-[400px] overflow-y-auto">
                <code className="text-[13px] font-mono leading-relaxed text-text">{result}</code>
              </pre>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (isWrite) {
    const lang = langFromPath(writeInfo.path)
    const lineCount = writeInfo.content.split('\n').length
    return (
      <div className="msg-content bg-card border border-border rounded-md animate-scale-in">
        <button
          className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted font-mono bg-transparent border-none text-left hover:text-text transition-colors cursor-pointer"
          onClick={() => setWriteExpanded(!writeExpanded)}
        >
          <span className={`text-[11px] transition-transform ${writeExpanded ? 'rotate-90' : ''}`}>▶</span>
          <span>📝 write</span>
          <span className="text-text/70 text-[12px] font-normal truncate">{writeInfo.path}</span>
          {onFileOpen && <button className="text-accent text-[11px] font-medium hover:underline shrink-0 bg-transparent border-none cursor-pointer" onClick={e => { e.stopPropagation(); onFileOpen(writeInfo.path) }}>Open</button>}
          <span className="text-muted/50 text-[12px] font-normal ml-auto shrink-0">{lineCount} lines</span>
          {isError && <span className="text-danger text-[12px] shrink-0 ml-1">✗ error</span>}
          {result && !isError && <span className="text-ok text-[12px] shrink-0 ml-1">✓</span>}
        </button>
        {writeExpanded && (
          <div className="px-2 pb-2">
            <div className="relative group">
              <div className="flex items-center justify-between bg-bg-elevated border border-border rounded-t-md px-3 py-1.5">
                <span className="text-muted text-[12px] font-mono uppercase">{lang || writeInfo.path.split('/').pop()}</span>
                <button className="text-muted text-[12px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-text bg-transparent border-none font-body" onClick={() => navigator.clipboard.writeText(writeInfo.content)}>Copy</button>
              </div>
              <pre className="bg-bg-elevated border border-t-0 border-border rounded-b-md p-3 overflow-x-auto max-h-[400px] overflow-y-auto">
                <code className="text-[13px] font-mono leading-relaxed text-text">{writeInfo.content}</code>
              </pre>
            </div>
            {isError && result && (
              <div className="mt-1">
                <pre className="bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-danger">{result}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`pidash-tool-card msg-content bg-card border border-border rounded-md animate-scale-in ${hasDetails ? 'cursor-pointer' : ''}`} data-pidash-tool-name={toolName} data-pidash-tool-status={isError ? 'error' : result ? 'ok' : 'running'}>
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted font-mono bg-transparent border-none text-left hover:text-text transition-colors"
        onClick={() => hasDetails && setExpanded(!expanded)}
        disabled={!hasDetails}
      >
        {hasDetails && <span className={`text-[11px] transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>}
        <span>🔧 {toolName}</span>
        {isError && <span className="text-danger text-[12px]">✗ error</span>}
        {result && !isError && <span className="text-ok text-[12px]">✓</span>}
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border space-y-2">
          {args && (
            <div>
              <div className="text-[11px] text-muted font-medium uppercase tracking-wider mt-2 mb-1">Arguments</div>
              <pre className="bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-text">{args}</pre>
            </div>
          )}
          {result && (
            <div>
              <div className={`text-[11px] font-medium uppercase tracking-wider mt-2 mb-1 ${isError ? 'text-danger' : 'text-muted'}`}>{isError ? 'Error' : 'Result'}</div>
              {/!\[image\]\(/.test(result) ? (
                <div className="space-y-2">
                  {result.split(/\n\n/).map((part, i) => {
                    const imgMatch = part.match(/!\[image\]\(([^)]+)\)/)
                    return imgMatch
                      ? <ResizableImage key={i} src={imgMatch[1]} alt="tool result" />
                      : part.trim() ? <pre key={i} className={`bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto ${isError ? 'text-danger' : 'text-muted'}`}>{part}</pre> : null
                  })}
                </div>
              ) : (
                <pre className={`bg-bg-hover rounded-md px-3 py-2 text-[13px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto ${isError ? 'text-danger' : 'text-muted'}`}>{result}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
