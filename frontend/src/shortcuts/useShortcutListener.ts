import { useEffect } from 'react'
import { matchEvent } from './registry'

/**
 * Single global keydown listener that dispatches to the action registry.
 * Call once in App — components register callbacks via registerAction().
 */
export function useShortcutListener() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable

      // Let native text-editing shortcuts through when focused in an input
      if (isInput && (e.ctrlKey || e.metaKey)) {
        const k = e.key.toLowerCase()
        if (k === 'a' || k === 'c' || k === 'v' || k === 'x' || k === 'z') return
      }

      const action = matchEvent(e)
      if (!action) return

      // In input fields, only allow Escape and mod+ combos
      if (isInput && e.key !== 'Escape' && !(e.ctrlKey || e.metaKey)) return

      if (action.when && !action.when()) return

      e.preventDefault()
      action.callback!()
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])
}
