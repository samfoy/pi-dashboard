import { memo, useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense, type ChangeEvent } from 'react'
import TextRenderer, { stripMd, CommentInput } from './renderers/TextRenderer'
import DiffView from './DiffView'
import { detectFileType, type Comment } from '../hooks/usePanelState'

const PdfRenderer = lazy(() => import('./renderers/PdfRenderer'))
const DocxRenderer = lazy(() => import('./renderers/DocxRenderer'))
const SpreadsheetRenderer = lazy(() => import('./renderers/SpreadsheetRenderer'))
const ImageRenderer = lazy(() => import('./renderers/ImageRenderer'))
const HtmlRenderer = lazy(() => import('./renderers/HtmlRenderer'))

const LOADING_FALLBACK = <div className="flex items-center justify-center h-full text-muted text-sm">Loading...</div>

interface VersionMeta { version: number; timestamp: string; size: number }

interface Props {
  filePath: string
  content: string
  onContentChange: (c: string) => void
  onSave: (filePath: string, content: string) => Promise<void>
  onClose: () => void
  dirty: boolean
  versions: VersionMeta[]
  selectedVersion: number | null
  conflictContent: string | null
  onSelectVersion: (v: number | null) => void
  onResolveConflict: (action: 'reload' | 'keep' | 'diff') => void
  diffMode: boolean
  onToggleDiff: () => void
  comments: Comment[]
  onAddComment: (startLine: number, endLine: number, content: string) => void
  onEditComment: (id: string, content: string) => void
  onDeleteComment: (id: string) => void
  onReviewComments?: () => void
}

export default memo(function DocumentPanel({ filePath, content, onContentChange, onSave, onClose, dirty, versions, selectedVersion, conflictContent, onSelectVersion, onResolveConflict, diffMode, onToggleDiff, comments, onAddComment, onEditComment, onDeleteComment, onReviewComments }: Props) {
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lineNums, setLineNums] = useState(true)
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('mc-docpanel-width')
    const n = saved ? parseInt(saved, 10) : NaN
    return !isNaN(n) && n >= 300 ? n : 480
  })
  const [activeInputRange, setActiveInputRange] = useState<{ start: number; end: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; startLine: number; endLine: number } | null>(null)
  const fileName = filePath.split('/').pop() || filePath
  const ref = useRef<HTMLDivElement>(null)
  const isOldVersion = selectedVersion !== null
  const fileType = detectFileType(filePath)
  // html is NOT binary — it keeps Save, the Preview/Source toggle, versions,
  // and Source-mode commenting enabled.
  const isBinary = fileType !== 'text' && fileType !== 'html'

  // Cheap rolling hash of content — bumps the iframe key on live-reload so the
  // artifact's scripts reliably re-execute when the file changes on disk.
  const htmlReloadKey = useMemo(() => {
    if (fileType !== 'html') return 0
    let h = 5381
    for (let i = 0; i < content.length; i++) h = ((h << 5) + h + content.charCodeAt(i)) | 0
    return h
  }, [fileType, content])

  const handleSave = useCallback(async () => {
    setSaving(true); setSaveError(null)
    try { await onSave(filePath, content) }
    catch (err) { setSaveError(err instanceof Error ? err.message : 'Save failed') }
    finally { setSaving(false) }
  }, [filePath, content, onSave])

  const handleSaveRef = useRef(handleSave)
  useEffect(() => { handleSaveRef.current = handleSave }, [handleSave])

  const guardedClose = useCallback(() => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    onClose()
  }, [dirty, onClose])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') guardedClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && mode === 'edit' && dirty) { e.preventDefault(); handleSaveRef.current() }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [guardedClose, mode, dirty])

  const handleChange = useCallback((v: string) => { onContentChange(v) }, [onContentChange])

  // Reverse-map selected rendered text back to source line numbers.
  // Shared by the Source-mode right-click path and the HTML-preview iframe bridge.
  const resolveTextToLines = useCallback((selText: string) => {
    const lines = content.split('\n')
    let startLine = 1, endLine = 1
    const needle = selText.split('\n').map(l => l.trim()).filter(Boolean)[0]?.toLowerCase() || ''
    if (needle.length > 0) {
      // Strategy 1: exact substring match in raw content
      const idx = content.toLowerCase().indexOf(needle)
      if (idx >= 0) {
        startLine = content.slice(0, idx).split('\n').length
      } else {
        // Strategy 2: match against markdown-stripped source lines
        for (let i = 0; i < lines.length; i++) {
          const stripped = stripMd(lines[i]).toLowerCase()
          if (stripped.length > 0 && (stripped.includes(needle) || needle.includes(stripped))) {
            startLine = i + 1
            break
          }
        }
      }
      const selLineCount = selText.split('\n').filter(l => l.trim()).length
      endLine = Math.min(startLine + Math.max(0, selLineCount - 1), lines.length)
    }
    return { startLine, endLine }
  }, [content])

  // HTML preview: an in-frame selection arrives (via postMessage bridge) as text.
  // Reverse-map it and open the same floating comment input the Source path uses.
  const handleIframeSelect = useCallback((text: string) => {
    const { startLine, endLine } = resolveTextToLines(text)
    setActiveInputRange({ start: startLine, end: endLine })
  }, [resolveTextToLines])

  // Right-click context menu for adding comments on selected text
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return // no selection → default browser menu
    e.preventDefault()

    let startLine = 1, endLine = 1

    // Edit mode: precise line from textarea selection
    const ta = (e.currentTarget as HTMLElement).querySelector('textarea')
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      startLine = content.slice(0, ta.selectionStart).split('\n').length
      endLine = content.slice(0, ta.selectionEnd).split('\n').length
    } else {
      // Preview mode: match selected text back to source lines
      ;({ startLine, endLine } = resolveTextToLines(sel.toString()))
    }

    setContextMenu({ x: e.clientX, y: e.clientY, startLine, endLine })
  }, [content, resolveTextToLines])

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [contextMenu])

  const filteredComments = useMemo(() => {
    // When viewing a specific historical version, filter to that version's comments.
    // When viewing the current (live) version, show all comments regardless of version
    // to prevent them from disappearing when the file is modified and version increments.
    if (selectedVersion !== null) return comments.filter(c => c.version === selectedVersion)
    return comments
  }, [comments, selectedVersion])

  const handleVersionChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    onSelectVersion(val === 'current' ? null : Number(val))
  }, [onSelectVersion])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const onMove = (ev: MouseEvent) => { setWidth(Math.max(300, Math.min(startW + (startX - ev.clientX), window.innerWidth * 0.8))) }
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); setWidth(w => { localStorage.setItem('mc-docpanel-width', String(w)); return w }) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [width])

  return (
    <div ref={ref} className="fixed inset-0 z-30 flex flex-col bg-bg md:relative md:inset-auto md:z-auto md:border-l md:border-border" style={typeof window !== 'undefined' && window.innerWidth >= 768 ? { width, minWidth: 300 } : undefined}>
      <div className="hidden md:flex absolute left-[-2px] top-0 bottom-0 w-[5px] cursor-col-resize z-20 group/drag items-center justify-center" onMouseDown={onDragStart}>
        <div className="w-[2px] h-full bg-transparent group-hover/drag:bg-orange-400 group-active/drag:bg-orange-500 transition-colors duration-200" />
      </div>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-chrome">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-mono font-semibold text-text truncate" title={filePath}>{fileName}</span>
          {versions.length > 0 && (
            <select aria-label="version" className="text-[11px] bg-bg border border-border rounded px-1 py-0.5 text-muted" value={selectedVersion ?? 'current'} onChange={handleVersionChange}>
              {versions.map(v => <option key={v.version} value={v.version}>v{v.version}</option>)}
              <option value="current">Current</option>
            </select>
          )}
          {isOldVersion && <span className="text-[11px] text-warning font-medium">Read-only</span>}
        </div>
        <div className="flex gap-1.5 shrink-0">
          {mode === 'edit' && (
            <button className={`px-2 py-1 rounded-md text-[12px] font-medium border cursor-pointer transition-all ${lineNums ? 'border-accent text-accent bg-accent-subtle' : 'border-border text-muted hover:text-text'}`} onClick={() => setLineNums(!lineNums)} title="Toggle line numbers">#</button>
          )}
          {!isBinary && (['preview', 'edit'] as const).map(m => (
            <button key={m} className={`px-2 py-1 rounded-md text-[12px] font-medium border cursor-pointer transition-all ${mode === m ? 'border-accent text-accent bg-accent-subtle' : 'border-border text-muted hover:text-text hover:border-border-strong'}`} onClick={() => setMode(m)}>{m === 'edit' ? (fileType === 'html' ? 'Source' : 'Edit') : 'Preview'}</button>
          ))}
          {!isBinary && versions.length > 0 && (
            <button className={`px-2 py-1 rounded-md text-[12px] font-medium border cursor-pointer transition-all ${diffMode ? 'border-accent text-accent bg-accent-subtle' : 'border-border text-muted hover:text-text hover:border-border-strong'}`} onClick={onToggleDiff} aria-label="Diff">Diff</button>
          )}
          {!isBinary && <button className={`px-2 py-1 rounded-md text-[12px] font-medium border transition-all disabled:opacity-40 ${dirty ? 'border-accent text-white bg-accent cursor-pointer hover:bg-accent-hover' : 'border-border text-muted cursor-default'}`} disabled={saving || !dirty} onClick={handleSave}>{saving ? 'Saving…' : 'Save'}</button>}
          <a href={`/api/local-file/download?path=${encodeURIComponent(filePath)}`} download={fileName} className="px-2 py-1 rounded-md text-[12px] text-muted border border-border hover:text-accent hover:border-accent transition-all cursor-pointer no-underline" title="Download">⬇</a>
          <button className="px-2 py-1 rounded-md text-[12px] text-muted border border-border hover:text-danger hover:border-danger transition-all cursor-pointer" onClick={guardedClose}>✕</button>
        </div>
      </div>
      {saveError && <div className="px-3 py-1 text-[11px] text-danger bg-bg-elevated border-b border-border">{saveError}</div>}
      {!isBinary && conflictContent != null && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-warning/10 text-warning text-[12px]">
          <span className="font-medium">File changed on disk</span>
          <div className="flex gap-1 ml-auto">
            <button className="px-2 py-0.5 rounded border border-warning/40 hover:bg-warning/20 cursor-pointer" onClick={() => onResolveConflict('reload')}>Reload</button>
            <button className="px-2 py-0.5 rounded border border-warning/40 hover:bg-warning/20 cursor-pointer" onClick={() => onResolveConflict('keep')}>Keep Mine</button>
            <button className="px-2 py-0.5 rounded border border-warning/40 hover:bg-warning/20 cursor-pointer" onClick={() => onResolveConflict('diff')}>Show Diff</button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-hidden p-4" onContextMenu={!diffMode && !isBinary ? handleContextMenu : undefined}>
        {diffMode ? (
          <DiffView oldContent={conflictContent ?? ''} newContent={content} oldLabel={conflictContent != null ? 'Disk' : 'Previous'} newLabel="Current" onClose={onToggleDiff} />
        ) : fileType === 'pdf' ? (
          <Suspense fallback={LOADING_FALLBACK}><PdfRenderer filePath={filePath} /></Suspense>
        ) : fileType === 'docx' ? (
          <Suspense fallback={LOADING_FALLBACK}><DocxRenderer filePath={filePath} /></Suspense>
        ) : fileType === 'spreadsheet' ? (
          <Suspense fallback={LOADING_FALLBACK}><SpreadsheetRenderer filePath={filePath} /></Suspense>
        ) : fileType === 'image' ? (
          <Suspense fallback={LOADING_FALLBACK}><ImageRenderer filePath={filePath} /></Suspense>
        ) : fileType === 'html' && mode === 'preview' ? (
          <Suspense fallback={LOADING_FALLBACK}><HtmlRenderer content={content} onSelect={handleIframeSelect} reloadKey={htmlReloadKey} /></Suspense>
        ) : (
          <TextRenderer
            content={content}
            filePath={filePath}
            mode={isBinary ? 'preview' : mode}
            lineNums={lineNums}
            onChange={handleChange}
            readOnly={isOldVersion || isBinary}
            comments={filteredComments}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
          />
        )}
      </div>
      {/* Review Comments button — visible when comments exist */}
      {filteredComments.length > 0 && !diffMode && onReviewComments && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-chrome text-[11px] text-muted">
          <span>💬 {filteredComments.length} comment{filteredComments.length !== 1 ? 's' : ''}</span>
          <button className="px-2 py-0.5 rounded border border-accent text-accent text-[11px] cursor-pointer hover:bg-accent-subtle ml-auto" onClick={onReviewComments}>Review Comments</button>
        </div>
      )}
      {/* Floating comment input triggered by right-click → Add Comment */}
      {activeInputRange && !diffMode && (
        <div className="border-t border-border">
          <CommentInput
            range={activeInputRange}
            onSave={text => { onAddComment(activeInputRange.start, activeInputRange.end, text); setActiveInputRange(null) }}
            onCancel={() => setActiveInputRange(null)}
          />
        </div>
      )}
      {/* Right-click context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-bg-elevated border border-border rounded-md shadow-lg py-1 min-w-[160px]"
          style={{ top: Math.min(contextMenu.y, window.innerHeight - 60), left: Math.min(contextMenu.x, window.innerWidth - 180) }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-[13px] text-text hover:bg-bg-hover cursor-pointer bg-transparent border-none font-body flex items-center gap-2"
            onClick={() => { setActiveInputRange({ start: contextMenu.startLine, end: contextMenu.endLine }); setContextMenu(null) }}
          >💬 Add Comment</button>
        </div>
      )}
      <div className="px-3 py-1.5 border-t border-border text-[11px] text-muted font-mono truncate" title={filePath}>{filePath}</div>
    </div>
  )
})
