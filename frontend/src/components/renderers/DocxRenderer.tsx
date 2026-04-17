import { useState, useEffect } from 'react'
import mammoth from 'mammoth'
import DOMPurify from 'dompurify'

interface DocxRendererProps {
  filePath: string
}

const DOCX_STYLES = `
.docx-content { font-family: inherit; color: var(--text); line-height: 1.6; max-width: 48rem; margin: 0 auto; }
.docx-content h1, .docx-content h2, .docx-content h3 { color: var(--text-strong); font-weight: 600; margin-top: 1em; margin-bottom: 0.5em; }
.docx-content p { margin: 0.5em 0; }
.docx-content table { border-collapse: collapse; width: 100%; margin: 1em 0; }
.docx-content th, .docx-content td { border: 1px solid var(--border); padding: 0.5em 0.75em; text-align: left; }
.docx-content th { background: var(--bg-elevated); font-weight: 600; }
.docx-content img { max-width: 100%; }
.docx-content ul, .docx-content ol { padding-left: 1.5em; margin: 0.5em 0; }
`

export default function DocxRenderer({ filePath }: DocxRendererProps) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const url = `/api/local-file?path=${encodeURIComponent(filePath)}`
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then(arrayBuffer => mammoth.convertToHtml({ arrayBuffer }))
      .then(result => {
        if (!cancelled) {
          setHtml(DOMPurify.sanitize(result.value))
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load document')
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [filePath])

  if (loading) {
    return <div className="flex items-center justify-center h-full text-muted text-sm">Loading document...</div>
  }

  if (error) {
    return <div className="flex items-center justify-center h-full text-danger text-sm">{error}</div>
  }

  return (
    <div className="w-full h-full overflow-auto p-6 bg-bg-elevated">
      <style>{DOCX_STYLES}</style>
      <div className="docx-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
