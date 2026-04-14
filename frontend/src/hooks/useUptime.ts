import { useState, useEffect } from 'react'
import { useAppSelector } from '../store'

function fmt(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`
}

/** Returns a live uptime string that ticks every second. */
export function useUptime(): string {
  const startTime = useAppSelector(s => s.dashboard.status?.start_time)
  const [display, setDisplay] = useState('—')

  useEffect(() => {
    if (!startTime) return
    const tick = () => setDisplay(fmt(Math.floor(Date.now() / 1000 - startTime)))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [startTime])

  return display
}
