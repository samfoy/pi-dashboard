import { useEffect, useRef, useCallback } from 'react'

export function useLogSSE(onMessage: (data: { level: string; msg: string }) => void) {
  const ref = useRef<EventSource | null>(null)
  const cb = useRef(onMessage)
  cb.current = onMessage

  const start = useCallback(() => {
    if (ref.current) return
    const sse = new EventSource('/api/logs')
    ref.current = sse
    sse.onmessage = (e) => {
      try { cb.current(JSON.parse(e.data)) } catch { /* ignore */ }
    }
    sse.onerror = () => {
      sse.close()
      ref.current = null
      setTimeout(start, 3000)
    }
  }, [])

  const stop = useCallback(() => {
    ref.current?.close()
    ref.current = null
  }, [])

  useEffect(() => {
    start()
    return stop
  }, [start, stop])
}
