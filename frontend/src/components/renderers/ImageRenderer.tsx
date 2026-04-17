import { useState, useCallback } from 'react'

interface ImageRendererProps {
  filePath: string
}

const BTN = 'px-2 py-1 rounded-md text-[12px] font-medium border border-border text-muted hover:text-text cursor-pointer disabled:opacity-40'

export default function ImageRenderer({ filePath }: ImageRendererProps) {
  const [scale, setScale] = useState(0) // 0 = fit mode
  const [error, setError] = useState(false)

  const url = `/api/local-file?path=${encodeURIComponent(filePath)}`
  const fileName = filePath.split('/').pop() || filePath

  const zoom = useCallback((delta: number) => {
    setScale(s => {
      const current = s === 0 ? 1.0 : s
      return Math.round(Math.max(0.25, Math.min(current + delta, 5.0)) * 100) / 100
    })
  }, [])

  return (
    <div className="flex flex-col w-full h-full">
      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-chrome text-[12px] shrink-0">
        <button className={BTN} disabled={scale !== 0 && scale <= 0.25} onClick={() => zoom(-0.25)}>−</button>
        <span className="text-muted w-12 text-center">{scale === 0 ? 'Fit' : `${Math.round(scale * 100)}%`}</span>
        <button className={BTN} disabled={scale >= 5.0} onClick={() => zoom(0.25)}>+</button>
        <button className={BTN} onClick={() => setScale(1.0)}>Actual Size</button>
        <button className={BTN} onClick={() => setScale(0)}>Fit</button>
      </div>
      {/* Image container */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-bg-elevated">
        {error ? (
          <div className="text-danger text-sm">Failed to load image</div>
        ) : (
          <img
            src={url}
            alt={fileName}
            onError={() => setError(true)}
            draggable={false}
            style={scale > 0
              ? { width: `${scale * 100}%` }
              : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' as const }
            }
          />
        )}
      </div>
    </div>
  )
}
