import { useState, useCallback, useRef, useEffect } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface PdfRendererProps {
  filePath: string
}

const BTN = 'px-2 py-1 rounded-md text-[12px] font-medium border border-border text-muted hover:text-text cursor-pointer disabled:opacity-40'

export default function PdfRenderer({ filePath }: PdfRendererProps) {
  const [numPages, setNumPages] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [scale, setScale] = useState(1.0)
  const [containerWidth, setContainerWidth] = useState(600)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const w = containerRef.current.clientWidth
    if (w > 0) setContainerWidth(w)
  }, [])

  const url = `/api/local-file?path=${encodeURIComponent(filePath)}`

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n)
    setPageNumber(1)
  }, [])

  const goPage = useCallback((p: number) => {
    setPageNumber(Math.max(1, Math.min(p, numPages)))
  }, [numPages])

  const zoom = useCallback((delta: number) => {
    setScale(s => Math.round(Math.max(0.5, Math.min(s + delta, 3.0)) * 100) / 100)
  }, [])

  return (
    <div className="flex flex-col w-full h-full">
      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-chrome text-[12px] shrink-0">
        <button className={BTN} disabled={pageNumber <= 1} onClick={() => goPage(pageNumber - 1)}>← Prev</button>
        <span className="text-muted">
          Page{' '}
          <input
            type="number"
            className="w-10 text-center bg-bg border border-border rounded px-1 py-0.5 text-[12px] text-text"
            value={pageNumber}
            min={1}
            max={numPages || 1}
            onChange={e => {
              const v = parseInt(e.target.value, 10)
              if (!isNaN(v)) goPage(v)
            }}
          />
          {' '}of {numPages}
        </span>
        <button className={BTN} disabled={pageNumber >= numPages} onClick={() => goPage(pageNumber + 1)}>Next →</button>
        <span className="mx-2 border-l border-border h-5" />
        <button className={BTN} disabled={scale <= 0.5} onClick={() => zoom(-0.25)}>−</button>
        <span className="text-muted w-12 text-center">{Math.round(scale * 100)}%</span>
        <button className={BTN} disabled={scale >= 3.0} onClick={() => zoom(0.25)}>+</button>
        <button className={BTN} onClick={() => setScale(1.0)}>Reset</button>
      </div>
      {/* Page container */}
      <div ref={containerRef} className="flex-1 overflow-auto flex justify-center p-4 bg-bg-elevated">
        <Document
          file={url}
          onLoadSuccess={onLoadSuccess}
          loading={<div className="flex items-center justify-center h-32 text-muted text-sm">Loading PDF...</div>}
          error={<div className="flex items-center justify-center h-32 text-danger text-sm">Failed to load PDF</div>}
        >
          <Page
            pageNumber={pageNumber}
            width={containerWidth * scale}
            renderAnnotationLayer
            renderTextLayer
          />
        </Document>
      </div>
    </div>
  )
}
