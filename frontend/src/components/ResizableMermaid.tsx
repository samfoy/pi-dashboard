import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'

/** Lazily loaded mermaid instance — only fetched when first mermaid diagram is rendered. */
let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(m => m.default)
  }
  return mermaidPromise
}

function isDarkTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark'
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

/** After insertion, let CSS control the SVG size so the container width is authoritative. */
function makeSvgResponsive(container: HTMLElement): SVGSVGElement | null {
  const svg = container.querySelector('svg') as SVGSVGElement | null
  if (!svg) return null
  // Keep the viewBox (mermaid already sets one); drop the fixed pixel dims.
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  svg.style.width = '100%'
  svg.style.height = 'auto'
  svg.style.maxWidth = '100%'
  svg.style.display = 'block'
  return svg
}

function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  // Ensure XML namespace for standalone files.
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  if (!clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  // Inline computed background color so the downloaded file doesn't render on a transparent canvas.
  const bg = getComputedStyle(document.body).backgroundColor
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
    clone.style.background = bg
  }
  return new XMLSerializer().serializeToString(clone)
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const source = serializeSvg(svg)
  const svgBlob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Failed to load SVG for rasterization'))
      img.src = url
    })
    const vb = svg.viewBox.baseVal
    const w = (vb && vb.width) || svg.clientWidth || 800
    const h = (vb && vb.height) || svg.clientHeight || 600
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    // Fill with theme background so exported PNG isn't transparent.
    const bg = getComputedStyle(document.body).backgroundColor
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

type Props = { code: string }

const MIN_WIDTH = 160
const DEFAULT_MAX_WIDTH = 2000

export const ResizableMermaid = memo(function ResizableMermaid({ code }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const id = useId().replace(/:/g, '_')
  const renderedRef = useRef('')
  const [width, setWidth] = useState<number | null>(null)
  const [busy, setBusy] = useState<'svg' | 'png' | 'copy' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current || renderedRef.current === code) return
    renderedRef.current = code
    let cancelled = false
    getMermaid()
      .then(m => {
        if (cancelled || !containerRef.current) return undefined
        initMermaid(m)
        return m.render(`mermaid-${id}`, code)
      })
      .then((result) => {
        if (cancelled || !containerRef.current || !result) return
        const range = document.createRange()
        range.selectNodeContents(containerRef.current)
        range.deleteContents()
        containerRef.current.appendChild(range.createContextualFragment(result.svg))
        svgRef.current = makeSvgResponsive(containerRef.current)
        setError(null)
      })
      .catch(() => {
        if (cancelled || !containerRef.current) return
        svgRef.current = null
        const pre = document.createElement('pre')
        pre.className = 'text-danger text-[13px]'
        pre.textContent = code
        containerRef.current.textContent = ''
        containerRef.current.appendChild(pre)
        setError('Failed to render diagram')
      })
    return () => { cancelled = true }
  }, [code, id])

  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const host = containerRef.current?.parentElement
    const startX = e.clientX
    const startW = host?.offsetWidth ?? MIN_WIDTH
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(MIN_WIDTH, Math.min(DEFAULT_MAX_WIDTH, startW + (ev.clientX - startX)))
      setWidth(next)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [])

  const resetSize = useCallback(() => setWidth(null), [])

  const handleDownloadSvg = useCallback(() => {
    const svg = svgRef.current
    if (!svg) return
    setBusy('svg')
    try {
      const source = serializeSvg(svg)
      const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
      downloadBlob(blob, `diagram-${id}.svg`)
    } finally {
      setBusy(null)
    }
  }, [id])

  const handleDownloadPng = useCallback(async () => {
    const svg = svgRef.current
    if (!svg) return
    setBusy('png')
    try {
      const blob = await svgToPngBlob(svg, 2)
      downloadBlob(blob, `diagram-${id}.png`)
    } catch {
      setError('PNG export failed')
    } finally {
      setBusy(null)
    }
  }, [id])

  const handleCopySource = useCallback(async () => {
    setBusy('copy')
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      /* ignore */
    } finally {
      setTimeout(() => setBusy(null), 600)
    }
  }, [code])

  return (
    <div
      className="relative group my-3"
      style={width ? { width, maxWidth: '100%' } : undefined}
    >
      <div
        ref={containerRef}
        className="flex justify-center overflow-x-auto min-h-[60px] rounded-md border border-transparent group-hover:border-border/60 transition-colors"
      />

      {/* Right-edge drag handle — rendered before toolbar so toolbar stacks on top */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize diagram"
        className="absolute top-0 right-0 w-2 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 bg-accent/30 rounded-r-md transition-opacity"
        onPointerDown={onResizePointerDown}
      />

      {/* Toolbar — appears on hover */}
      <div
        className="absolute top-1 right-3 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
        aria-label="Diagram tools"
      >
        <ToolbarButton
          onClick={handleDownloadSvg}
          disabled={!svgRef.current || !!busy}
          title="Download as SVG"
        >
          {busy === 'svg' ? '…' : 'SVG'}
        </ToolbarButton>
        <ToolbarButton
          onClick={handleDownloadPng}
          disabled={!svgRef.current || !!busy}
          title="Download as PNG (2x)"
        >
          {busy === 'png' ? '…' : 'PNG'}
        </ToolbarButton>
        <ToolbarButton
          onClick={handleCopySource}
          disabled={!!busy}
          title="Copy mermaid source"
        >
          {busy === 'copy' ? '✓' : 'Copy'}
        </ToolbarButton>
        {width !== null && (
          <ToolbarButton onClick={resetSize} title="Reset size">
            Reset
          </ToolbarButton>
        )}
      </div>

      {error && (
        <div className="text-[12px] text-danger mt-1">{error}</div>
      )}
    </div>
  )
})

function ToolbarButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-2 py-0.5 text-[11px] font-medium rounded bg-bg-elevated/95 border border-border text-muted hover:text-text hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer backdrop-blur-sm"
    >
      {children}
    </button>
  )
}

export default ResizableMermaid
