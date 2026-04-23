import { useState, useEffect, useCallback } from 'react'
import { BUILTIN_THEMES } from '../themes'

export const THEMES = [
  { id: 'dark', label: '🌙 Dark', group: 'base' },
  { id: 'light', label: '☀️ Light', group: 'base' },
  { id: 'rose-pine', label: '🌸 Rosé Pine', group: 'rosé pine' },
  { id: 'rose-pine-moon', label: '🌙 Rosé Pine Moon', group: 'rosé pine' },
  { id: 'rose-pine-dawn', label: '🌅 Rosé Pine Dawn', group: 'rosé pine' },
] as const

export type ThemeId = typeof THEMES[number]['id']

const LS_KEY = 'mc-theme'
const STYLE_ID = 'pidash-theme'

function getSystemScheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolve(pref: ThemeId | 'system'): ThemeId {
  if (pref === 'system') return getSystemScheme()
  return pref
}

function injectTheme(themeId: ThemeId) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = BUILTIN_THEMES[themeId] || BUILTIN_THEMES.dark
  // Keep data-theme for any remaining selectors (tailwind config, etc.)
  document.documentElement.dataset.theme = themeId
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemeId | 'system'>(
    () => (localStorage.getItem(LS_KEY) as ThemeId | 'system') || 'system'
  )
  const [resolved, setResolved] = useState<ThemeId>(() => resolve(preference))

  useEffect(() => { injectTheme(resolved) }, [resolved])

  useEffect(() => {
    if (preference !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setResolved(resolve('system'))
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [preference])

  const setTheme = useCallback((pref: ThemeId | 'system') => {
    localStorage.setItem(LS_KEY, pref)
    setPreference(pref)
    setResolved(resolve(pref))
  }, [])

  const cycle = useCallback(() => {
    const order: (ThemeId | 'system')[] = ['system', ...THEMES.map(t => t.id)]
    const idx = order.indexOf(preference)
    const next = order[(idx + 1) % order.length]
    setTheme(next)
  }, [preference, setTheme])

  return { theme: resolved, preference, cycle, setTheme }
}
