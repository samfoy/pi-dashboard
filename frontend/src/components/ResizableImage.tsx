import { useRef, useState, useCallback } from 'react'

export default function ResizableImage({ src, alt }: { src: string; alt?: string }) {
  const [width, setWidth] = useState<number | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = true
    startX.current = e.clientX
    startW.current = imgRef.current?.offsetWidth || 200
    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return
      setWidth(Math.max(80, startW.current + ev.clientX - startX.current))
    }
    const onUp = () => {
      dragging.current = false
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [])

  return (
    <div className="relative inline-block my-2 group" style={width ? { width } : undefined}>
      <img
        ref={imgRef}
        src={src}
        alt={alt || ''}
        className="rounded-md border border-border block"
        style={{ width: width ? '100%' : undefined, maxWidth: width ? undefined : '100%' }}
        loading="lazy"
        draggable={false}
      />
      <div
        className="absolute top-0 right-0 w-2 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 bg-accent/30 rounded-r-md transition-opacity"
        onPointerDown={onPointerDown}
      />
    </div>
  )
}
