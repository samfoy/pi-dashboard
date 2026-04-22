import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Fragment } from 'react'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import markdown from 'highlight.js/lib/languages/markdown'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('jsx', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('zsh', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
import DOMPurify from 'dompurify'
import MarkdownRenderer from '../MarkdownRenderer'
import type { Comment } from '../../hooks/usePanelState'

export const MD_EXTS = new Set(['.md', '.markdown', '.mdx', '.txt', ''])
export function extOf(fp: string) { const i = fp.lastIndexOf('.'); return i >= 0 ? fp.slice(i).toLowerCase() : '' }
export function wrapCode(content: string, ext: string) { const lang = ext.replace('.', ''); return '~~~' + lang + '\n' + content + '\n~~~' }

/** Strip markdown formatting for fuzzy text matching */
export function stripMd(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')              // headings
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1') // bold/italic
    .replace(/`([^`]+)`/g, '$1')            // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images (must precede link rule)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links
    .replace(/^[-*+]\s+/, '')                // unordered list items
    .replace(/^\d+\.\s+/, '')                // ordered list items
    .replace(/^>\s+/, '')                    // blockquotes
    .trim()
}
export function langFor(ext: string): string {
  const map: Record<string, string> = { '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript', '.py': 'python', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.sh': 'bash', '.css': 'css', '.html': 'html', '.md': 'markdown', '.rs': 'rust', '.go': 'go', '.java': 'java', '.kt': 'kotlin', '.rb': 'ruby', '.sql': 'sql', '.xml': 'xml', '.toml': 'ini', '.cfg': 'ini' }
  return map[ext] || 'plaintext'
}

/** Syntax-highlighted code editor with transparent textarea overlay */
export function CodeEditor({ content, lang, lineNums, onChange, readOnly, commentedLines }: { content: string; lang: string; lineNums: boolean; onChange: (v: string) => void; readOnly?: boolean; commentedLines?: Set<number> }) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const highlighted = useMemo(() => {
    try { return DOMPurify.sanitize(hljs.highlight(content, { language: lang }).value) }
    catch { return DOMPurify.sanitize(hljs.highlightAuto(content).value) }
  }, [content, lang])

  const lineCount = content.split('\n').length

  const syncScroll = useCallback(() => {
    if (taRef.current) {
      if (preRef.current) { preRef.current.scrollTop = taRef.current.scrollTop; preRef.current.scrollLeft = taRef.current.scrollLeft }
      if (gutterRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop
    }
  }, [])

  return (
    <div className="relative w-full h-full font-mono text-sm leading-[1.5] bg-bg-elevated border border-border rounded-md overflow-hidden">
      {lineNums && (
        <div ref={gutterRef} data-testid="gutter" className="absolute left-0 top-0 bottom-0 w-[3em] bg-chrome border-r border-border text-right pr-2 pt-3 text-[11px] text-muted select-none overflow-hidden z-10 leading-[1.5]" style={{ fontFamily: 'inherit' }}>
          {Array.from({ length: lineCount }, (_, i) => <div key={i} className={commentedLines?.has(i + 1) ? 'text-cyan-400' : ''}>{commentedLines?.has(i + 1) ? '💬' : i + 1}</div>)}
        </div>
      )}
      <pre ref={preRef} className="absolute inset-0 p-3 m-0 overflow-auto whitespace-pre-wrap break-words pointer-events-none" style={{ paddingLeft: lineNums ? 'calc(3em + 12px)' : undefined }} aria-hidden dangerouslySetInnerHTML={{ __html: highlighted + '\n' }} />
      <textarea ref={taRef} className="absolute inset-0 p-3 m-0 bg-transparent text-transparent caret-text outline-none resize-none overflow-auto whitespace-pre-wrap break-words" style={{ paddingLeft: lineNums ? 'calc(3em + 12px)' : undefined, WebkitTextFillColor: 'transparent' }} value={content} onChange={e => onChange(e.target.value)} onScroll={syncScroll} spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={readOnly} />
    </div>
  )
}

/** Inline comment input */
export function CommentInput({ range, onSave, onCancel }: { range: { start: number; end: number }; onSave: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="ml-[3em] pl-3 py-1.5 border-l-2 border-cyan-400 bg-cyan-500/5">
      <div className="text-[10px] text-muted mb-1">Comment on {range.start === range.end ? `line ${range.start}` : `lines ${range.start}–${range.end}`}</div>
      <textarea ref={ref} className="w-full bg-bg border border-border rounded px-2 py-1 text-[12px] text-text outline-none focus:border-accent resize-none" rows={2} placeholder="Add a comment..." value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (value.trim()) onSave(value.trim()) } if (e.key === 'Escape') onCancel() }} />
      <div className="flex gap-1 mt-1">
        <button className="px-2 py-0.5 rounded border border-accent text-accent text-[11px] cursor-pointer hover:bg-accent-subtle" onClick={() => { if (value.trim()) onSave(value.trim()) }}>Save</button>
        <button className="px-2 py-0.5 rounded border border-border text-muted text-[11px] cursor-pointer hover:bg-bg-hover" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

/** Inline comment widget — editable and deletable */
function InlineCommentWidget({ comment, onEdit, onDelete }: { comment: Comment; onEdit?: (id: string, content: string) => void; onDelete?: (id: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(comment.content)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])
  const save = () => { if (value.trim() && onEdit) { onEdit(comment.id, value.trim()); setEditing(false) } }
  const lineLabel = comment.startLine === comment.endLine ? `L${comment.startLine}` : `L${comment.startLine}–${comment.endLine}`

  return (
    <div className="my-1 mx-2 pl-2 py-1 border-l-2 border-cyan-400 bg-cyan-500/5 rounded-r text-[12px]">
      {editing ? (
        <>
          <textarea ref={ref} className="w-full bg-bg border border-border rounded px-2 py-1 text-[12px] text-text outline-none resize-none" rows={2} value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() } if (e.key === 'Escape') { setValue(comment.content); setEditing(false) } }} />
          <div className="flex gap-1 mt-1">
            <button className="px-2 py-0.5 rounded border border-accent text-accent text-[11px] cursor-pointer" onClick={save}>Save</button>
            <button className="px-2 py-0.5 rounded border border-border text-muted text-[11px] cursor-pointer" onClick={() => { setValue(comment.content); setEditing(false) }}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className={onEdit ? 'cursor-pointer hover:bg-cyan-500/10 rounded px-1 -mx-1 transition-colors' : ''} onClick={onEdit ? () => setEditing(true) : undefined}>
            <span className="text-[10px] text-cyan-400 font-mono mr-1.5">{lineLabel}</span><span className="text-text">{comment.content}</span>
          </div>
          {onDelete && <button className="text-[10px] text-muted hover:text-danger cursor-pointer shrink-0" onClick={() => onDelete(comment.id)} title="Delete">✕</button>}
        </div>
      )}
    </div>
  )
}

/** Build map of endLine -> comments sorted by line */
function buildCommentMap(comments: Comment[]) {
  const map = new Map<number, Comment[]>()
  for (const c of comments) {
    const arr = map.get(c.endLine) || []
    arr.push(c)
    map.set(c.endLine, arr)
  }
  return map
}

/** Code preview with line-by-line rendering and interleaved comments */
function CodePreviewWithComments({ content, ext, comments, onEdit, onDelete }: { content: string; ext: string; comments: Comment[]; onEdit?: (id: string, content: string) => void; onDelete?: (id: string) => void }) {
  const lang = langFor(ext)
  const highlighted = useMemo(() => {
    try { return DOMPurify.sanitize(hljs.highlight(content, { language: lang }).value) }
    catch { return DOMPurify.sanitize(hljs.highlightAuto(content).value) }
  }, [content, lang])
  const htmlLines = highlighted.split('\n')
  const commentMap = useMemo(() => buildCommentMap(comments), [comments])

  // Collect lines that are within any comment's startLine..endLine range
  const commentedLines = useMemo(() => {
    const set = new Set<number>()
    for (const c of comments) for (let l = c.startLine; l <= c.endLine; l++) set.add(l)
    return set
  }, [comments])

  return (
    <div className="font-mono text-sm leading-[1.5] bg-bg-elevated border border-border rounded-md overflow-auto p-3">
      {htmlLines.map((html, i) => (
        <Fragment key={i}>
          <div className="flex">
            <span className={`w-[3em] text-right pr-3 text-[11px] select-none shrink-0 ${commentedLines.has(i + 1) ? 'text-cyan-400' : 'text-muted'}`}>{i + 1}</span>
            <code className="hljs" dangerouslySetInnerHTML={{ __html: html || '\u00a0' }} />
          </div>
          {commentMap.get(i + 1)?.map(c => <InlineCommentWidget key={c.id} comment={c} onEdit={onEdit} onDelete={onDelete} />)}
        </Fragment>
      ))}
    </div>
  )
}

interface TextRendererProps {
  content: string
  filePath: string
  mode: 'preview' | 'edit'
  lineNums: boolean
  onChange: (v: string) => void
  readOnly: boolean
  comments?: Comment[]
  onEditComment?: (id: string, content: string) => void
  onDeleteComment?: (id: string) => void
}

export default function TextRenderer({ content, filePath, mode, lineNums, onChange, readOnly, comments = [], onEditComment, onDeleteComment }: TextRendererProps) {
  const ext = extOf(filePath)
  const isMarkdown = MD_EXTS.has(ext)
  const lang = langFor(ext)
  const displayContent = isMarkdown ? content : wrapCode(content, ext)
  const hasComments = comments.length > 0

  // Preserve scroll position across comment add/edit/delete re-renders
  const scrollRef = useRef<HTMLDivElement>(null)
  const savedScroll = useRef(0)
  const onScroll = useCallback(() => { savedScroll.current = scrollRef.current?.scrollTop ?? 0 }, [])
  useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = savedScroll.current }, [comments])

  if (mode === 'edit') {
    // Edit mode: CodeEditor with 💬 gutter markers + comment list below
    const commentedLines = useMemo(() => {
      const set = new Set<number>()
      for (const c of comments) for (let l = c.startLine; l <= c.endLine; l++) set.add(l)
      return set
    }, [comments])

    return (
      <div className="w-full h-full flex flex-col">
        <div className="flex-1 min-h-0">
          <CodeEditor content={content} lang={lang} lineNums={lineNums} onChange={onChange} readOnly={readOnly} commentedLines={commentedLines} />
        </div>
        {hasComments && (
          <div className="border-t border-border overflow-auto max-h-[200px] py-1">
            {[...comments].sort((a, b) => a.startLine - b.startLine).map(c => <InlineCommentWidget key={c.id} comment={c} onEdit={onEditComment} onDelete={onDeleteComment} />)}
          </div>
        )}
      </div>
    )
  }

  // Preview mode
  if (hasComments && !isMarkdown) {
    return (
      <div ref={scrollRef} className="w-full h-full overflow-auto" onScroll={onScroll}>
        <CodePreviewWithComments content={content} ext={ext} comments={comments} onEdit={onEditComment} onDelete={onDeleteComment} />
      </div>
    )
  }

  // Markdown preview with comments: chunk-based rendering
  if (hasComments && isMarkdown) {
    const lines = content.split('\n')
    const commentMap = buildCommentMap(comments)
    const breakpoints = [...commentMap.keys()].sort((a, b) => a - b)
    const elements: JSX.Element[] = []
    let start = 0

    for (const bp of breakpoints) {
      const lineIdx = Math.min(bp, lines.length)
      const chunk = lines.slice(start, lineIdx).join('\n')
      if (chunk.trim()) elements.push(<MarkdownRenderer key={`md-${start}`} content={chunk} />)
      for (const c of commentMap.get(bp)!) elements.push(<InlineCommentWidget key={c.id} comment={c} onEdit={onEditComment} onDelete={onDeleteComment} />)
      start = lineIdx
    }
    const remaining = lines.slice(start).join('\n')
    if (remaining.trim()) elements.push(<MarkdownRenderer key={`md-${start}`} content={remaining} />)

    return <div ref={scrollRef} className="msg-content text-sm leading-relaxed h-full overflow-auto" onScroll={onScroll}>{elements}</div>
  }

  // No comments — render normally
  return (
    <div className="w-full h-full">
      <div className="msg-content text-sm leading-relaxed h-full overflow-auto">
        <MarkdownRenderer content={displayContent} />
      </div>
    </div>
  )
}
