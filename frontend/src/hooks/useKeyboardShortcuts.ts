import { useEffect, useCallback } from 'react'

type Shortcut = {
  /** Key to match (e.g. 'k', 'n', 'Escape') */
  key: string
  /** Require Ctrl (Cmd on Mac) */
  ctrl?: boolean
  /** Require Shift */
  shift?: boolean
  /** Description for help display */
  label: string
  /** Handler */
  action: () => void
}

/**
 * Register global keyboard shortcuts.
 * Shortcuts requiring Ctrl use Cmd on Mac automatically.
 * Ignores events when user is typing in an input/textarea (unless the key is Escape).
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  const handler = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable

    // Let native text-editing shortcuts through when focused in an input
    if (isInput && (e.ctrlKey || e.metaKey)) {
      const k = e.key.toLowerCase()
      if (k === 'a' || k === 'c' || k === 'v' || k === 'x' || k === 'z') return
    }

    for (const s of shortcuts) {
      // Match modifiers — treat Meta (Cmd) and Ctrl the same
      const ctrlOk = s.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey)
      const shiftOk = s.shift ? e.shiftKey : !e.shiftKey
      const keyOk = e.key.toLowerCase() === s.key.toLowerCase()

      if (keyOk && ctrlOk && shiftOk) {
        // Allow Escape and Ctrl/Cmd combos when focused in an input; skip plain keys
        if (isInput && s.key !== 'Escape' && !s.ctrl) continue
        e.preventDefault()
        s.action()
        return
      }
    }
  }, [shortcuts])

  useEffect(() => {
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handler])
}

export type { Shortcut }
