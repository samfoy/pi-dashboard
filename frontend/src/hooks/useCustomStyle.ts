import { useState, useEffect, useCallback } from 'react'

const STYLE_ID = 'pidash-custom-style'

/** Sanitize user CSS — block @import, url() (except data:/# ), expression(), </style breakout */
function sanitize(css: string): string {
  // Normalize unicode escapes before matching
  const norm = css.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  return norm
    .replace(/@import\b[^;]*;?/gi, '/* @import blocked */')
    .replace(/expression\s*\(/gi, '/* expression blocked */(')
    .replace(/<\/style/gi, '/* closing tag blocked */')
    .replace(/url\(\s*(?!['"]?(?:data:|#))([^)]*)\)/gi, 'url(/* blocked */)')
}

function inject(css: string) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!css) { el?.remove(); return }
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = sanitize(css)
}

export function useCustomStyle() {
  const [active, setActive] = useState('')
  const [styles, setStyles] = useState<string[]>([])
  const [css, setCss] = useState('')

  // Skip injection if ?reset-css=true
  const resetCss = new URLSearchParams(window.location.search).get('reset-css') === 'true'

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/styles')
      const d = await r.json()
      setStyles(d.styles || [])
      setActive(d.active || '')
      if (d.active && !resetCss) {
        const r2 = await fetch(`/api/styles/${encodeURIComponent(d.active)}`)
        const d2 = await r2.json()
        setCss(d2.css || '')
      } else {
        setCss('')
      }
    } catch { /* ignore */ }
  }, [resetCss])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { if (!resetCss) inject(css); else inject('') }, [css, resetCss])

  const activate = useCallback(async (name: string) => {
    await fetch('/api/styles-active', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
    await refresh()
  }, [refresh])

  const save = useCallback(async (name: string, newCss: string) => {
    await fetch(`/api/styles/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ css: newCss }) })
    await refresh()
  }, [refresh])

  const remove = useCallback(async (name: string) => {
    await fetch(`/api/styles/${encodeURIComponent(name)}`, { method: 'DELETE' })
    await refresh()
  }, [refresh])

  return { active, styles, css, activate, save, remove, refresh }
}
