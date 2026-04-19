import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import MarkdownRenderer from '../MarkdownRenderer'

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
export function CodeEditor({ content, lang, lineNums, onChange, readOnly }: { content: string; lang: string; lineNums: boolean; onChange: (v: string) => void; readOnly?: boolean }) {
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
          {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
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

interface TextRendererProps {
  content: string
  filePath: string
  mode: 'preview' | 'edit'
  lineNums: boolean
  onChange: (v: string) => void
  readOnly: boolean
}

export default function TextRenderer({ content, filePath, mode, lineNums, onChange, readOnly }: TextRendererProps) {
  const ext = extOf(filePath)
  const isMarkdown = MD_EXTS.has(ext)
  const lang = langFor(ext)
  const displayContent = isMarkdown ? content : wrapCode(content, ext)

  return (
    <div className="w-full h-full">
      {mode === 'edit' ? (
        <CodeEditor content={content} lang={lang} lineNums={lineNums} onChange={onChange} readOnly={readOnly} />
      ) : (
        <div className="msg-content text-sm leading-relaxed h-full overflow-auto">
          <MarkdownRenderer content={displayContent} />
        </div>
      )}
    </div>
  )
}
