import { memo, useEffect, useRef, useId, useCallback, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import DOMPurify from 'dompurify'
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
import { api } from '../api/client'
import { useBlockAssembler } from '../hooks/useBlockAssembler'
import DiffBlock from './DiffBlock'
import type { ContentBlock } from '../types'

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

const PATH_RE = /^~?(?:\.{0,2}\/)?[\w.@~/ -]*\/[\w.@~ -]*[\w.]$/

function isDarkTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

/** Lazily loaded mermaid instance — only fetched when first mermaid diagram is rendered. */
let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(m => m.default)
  }
  return mermaidPromise
}

function initMermaid(instance: { initialize: (config: object) => void }): void {
  const dark = isDarkTheme()
  instance.initialize({
    startOnLoad: false,
    theme: dark ? 'dark' : 'default',
    themeVariables: dark ? {
      primaryColor: '#f59e32',
      primaryTextColor: '#e8e6e3',
      primaryBorderColor: '#3a3a3a',
      lineColor: '#888',
      secondaryColor: '#2a2a2a',
      tertiaryColor: '#1a1a1a',
    } : {
      primaryColor: '#f59e32',
      primaryTextColor: '#1a1a1a',
      primaryBorderColor: '#ccc',
      lineColor: '#666',
      secondaryColor: '#fff3e0',
      tertiaryColor: '#f5f5f5',
    },
    securityLevel: 'loose',
    fontFamily: 'inherit',
  })
}

function setSanitizedHTML(el: Element, html: string): void {
  const clean = DOMPurify.sanitize(html)
  const range = document.createRange()
  range.selectNodeContents(el)
  range.deleteContents()
  el.appendChild(range.createContextualFragment(clean))
}

const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId().replace(/:/g, '_')
  const renderedRef = useRef('')

  useEffect(() => {
    if (!ref.current || renderedRef.current === code) return
    renderedRef.current = code
    getMermaid().then(m => {
      if (!ref.current) return
      initMermaid(m)
      return m.render(`mermaid-${id}`, code)
    }).then((result) => {
      if (!ref.current || !result) return
      const range = document.createRange()
      range.selectNodeContents(ref.current)
      range.deleteContents()
      ref.current.appendChild(range.createContextualFragment(result.svg))
    }).catch(() => {
      if (!ref.current) return
      const pre = document.createElement('pre')
      pre.className = 'text-danger text-[13px]'
      pre.textContent = code
      ref.current.textContent = ''
      ref.current.appendChild(pre)
    })
  }, [code, id])

  return <div ref={ref} className="my-3 flex justify-center overflow-x-auto min-h-[60px]" />
})

function HighlightedCode({ code, lang, className }: { code: string; lang: string | undefined; className: string }) {
  const ref = useRef<HTMLElement>(null)
  const renderedRef = useRef('')

  useEffect(() => {
    if (!ref.current || renderedRef.current === code) return
    renderedRef.current = code
    let highlighted = code
    if (lang && hljs.getLanguage(lang)) {
      try { highlighted = hljs.highlight(code, { language: lang }).value } catch { /* fallback */ }
    } else if (!lang) {
      try { highlighted = hljs.highlightAuto(code).value } catch { /* fallback */ }
    }
    setSanitizedHTML(ref.current, highlighted)
  }, [code, lang])

  return <code ref={ref} className={`hljs text-[13px] font-mono leading-relaxed ${className}`} />
}

const CodeBlock = memo(function CodeBlock({ code, lang, complete }: { code: string; lang?: string; complete: boolean }) {
  return (
    <div className="relative group my-2">
      <div className="flex items-center justify-between bg-bg-elevated border border-border rounded-t-md px-3 py-1.5">
        <span className="text-muted text-[12px] font-mono uppercase">{lang || 'code'}</span>
        <button className="text-muted text-[12px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-text" onClick={() => navigator.clipboard.writeText(code)}>Copy</button>
      </div>
      <pre className="bg-bg-elevated border border-t-0 border-border rounded-b-md p-3 overflow-x-auto">
        <HighlightedCode code={code} lang={lang} className={lang ? `language-${lang}` : ''} />
        {!complete && <span className="text-muted text-[12px] italic animate-pulse ml-2">generating…</span>}
      </pre>
    </div>
  )
})

const MD_COMPONENTS: Record<string, React.ComponentType<any>> = {
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '')
    const lang = match?.[1]
    const codeStr = String(children).replace(/\n$/, '')

    if (lang === 'mermaid') return <MermaidBlock code={codeStr} />

    if (!className) {
      if (PATH_RE.test(codeStr)) {
        return <code className="bg-bg-elevated px-1.5 py-0.5 rounded text-accent text-sm font-mono cursor-pointer hover:underline" title="Click to open / Shift+click to reveal in Finder" {...props}>{children}</code>
      }
      return <code className="bg-bg-elevated px-1.5 py-0.5 rounded text-accent text-sm font-mono" {...props}>{children}</code>
    }

    return (
      <div className="relative group my-2">
        <div className="flex items-center justify-between bg-bg-elevated border border-border rounded-t-md px-3 py-1.5">
          <span className="text-muted text-[12px] font-mono uppercase">{lang || 'code'}</span>
          <button className="text-muted text-[12px] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-text" onClick={() => navigator.clipboard.writeText(codeStr)}>Copy</button>
        </div>
        <pre className="bg-bg-elevated border border-t-0 border-border rounded-b-md p-3 overflow-x-auto">
          <HighlightedCode code={codeStr} lang={lang} className={className || ''} />
        </pre>
      </div>
    )
  },
  pre({ children }: any) { return <>{children}</> },
  table({ children }: any) { return <div className="overflow-x-auto my-3"><table className="w-full border-collapse text-sm">{children}</table></div> },
  th({ children }: any) { return <th className="text-left text-muted text-[13px] font-medium px-3 py-2 border-b border-border bg-bg-elevated">{children}</th> },
  td({ children }: any) { return <td className="px-3 py-2 border-b border-border text-sm">{children}</td> },
  a({ href, children }: any) { return <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2 decoration-accent/40 hover:decoration-accent">{children}</a> },
  blockquote({ children }: any) { return <blockquote className="border-l-[3px] border-accent pl-3 my-2 text-muted italic">{children}</blockquote> },
  hr() { return <hr className="border-border my-4" /> },
  h1({ children }: any) { return <h1 className="text-xl font-bold mt-4 mb-2 text-text-strong">{children}</h1> },
  h2({ children }: any) { return <h2 className="text-lg font-bold mt-3 mb-2 text-text-strong">{children}</h2> },
  h3({ children }: any) { return <h3 className="text-base font-semibold mt-3 mb-1.5 text-text-strong">{children}</h3> },
  ul({ children }: any) { return <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul> },
  ol({ children }: any) { return <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol> },
  li({ children }: any) { return <li className="text-sm leading-relaxed">{children}</li> },
  p({ children }: any) { return <p className="my-1.5 leading-relaxed">{children}</p> },
  strong({ children }: any) { return <strong className="font-semibold text-text-strong">{children}</strong> },
  em({ children }: any) { return <em className="italic">{children}</em> },
}

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeRaw]

function fixCodeFences(s: string): string {
  s = s.replace(/([^\n])(\n?)(```\w*\n)/g, (_, pre, nl, fence) =>
    nl ? pre + nl + fence : pre + '\n\n' + fence
  )
  s = s.replace(/```([A-Z])/g, '```\n$1')
  return s
}

const MarkdownBlock = memo(function MarkdownBlock({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MD_COMPONENTS}>
      {fixCodeFences(content)}
    </ReactMarkdown>
  )
})

function BlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'diff':
      return <DiffBlock code={block.content} complete={block.complete} />
    case 'mermaid':
      return block.complete ? <MermaidBlock code={block.content} /> : (
        <div className="my-2 p-3 bg-bg-elevated border border-border rounded-md text-muted text-[12px] italic animate-pulse">generating diagram…</div>
      )
    case 'code':
      return <CodeBlock code={block.content} lang={block.language} complete={block.complete} />
    case 'markdown':
      return <MarkdownBlock content={block.content} />
  }
}

export default memo(function MarkdownRenderer({ content, streaming = false, onFileOpen }: { content: string; streaming?: boolean; onFileOpen?: (path: string) => void }) {
  const blocks = useBlockAssembler(content, streaming)
  const [showRaw, setShowRaw] = useState(false)

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement
    if (el.tagName === 'CODE' && PATH_RE.test(el.textContent || '')) {
      e.preventDefault()
      if (onFileOpen && !e.shiftKey) onFileOpen(el.textContent!.trim())
      else api.revealPath(el.textContent!.trim())
    }
  }, [onFileOpen])

  if (showRaw) {
    return (
      <div>
        <button className="text-muted text-[12px] hover:text-text mb-1 cursor-pointer" onClick={() => setShowRaw(false)}>← rendered view</button>
        <pre className="text-[13px] font-mono whitespace-pre-wrap break-words leading-relaxed text-muted">{content}</pre>
      </div>
    )
  }

  return (
    <div className="group" onClick={handleClick}>
      {blocks.map((block, i) => <BlockRenderer key={`${block.type}-${i}`} block={block} />)}
      {!streaming && content.length > 20 && (
        <button className="text-muted text-[12px] opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-pointer mt-1" onClick={() => setShowRaw(true)}>raw</button>
      )}
    </div>
  )
})
