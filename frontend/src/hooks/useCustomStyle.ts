import { useState, useEffect, useCallback } from 'react'

/** Extract CSS custom property values from a CSS string */
export function parseVars(css: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const m of css.matchAll(/--(\w[\w-]*)\s*:\s*([^;]+)/g)) {
    vars[m[1]] = m[2].trim()
  }
  return vars
}

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
  }
  el.textContent = sanitize(css)
  // Always append last so custom styles win over theme styles
  document.head.appendChild(el)
}

export function useCustomStyle() {
  const [active, setActive] = useState('')
  const [styles, setStyles] = useState<string[]>([])
  const [css, setCss] = useState('')
  const [styleContents, setStyleContents] = useState<Record<string, string>>({})

  // Skip injection if ?reset-css=true
  const resetCss = new URLSearchParams(window.location.search).get('reset-css') === 'true'

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/styles')
      const d = await r.json()
      setStyles(d.styles || [])
      setActive(d.active || '')
      // Fetch all style contents for preview
      const contents: Record<string, string> = {}
      await Promise.all((d.styles || []).map(async (name: string) => {
        try {
          const r2 = await fetch(`/api/styles/${encodeURIComponent(name)}`)
          const d2 = await r2.json()
          contents[name] = d2.css || ''
        } catch {}
      }))
      setStyleContents(contents)
      if (d.active && !resetCss) {
        setCss(contents[d.active] || '')
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

  return { active, styles, css, styleContents, activate, save, remove, refresh }
}
