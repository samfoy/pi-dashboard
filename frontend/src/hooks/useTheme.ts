import { useState, useEffect, useCallback } from 'react'

type ThemePreference = 'dark' | 'light' | 'system'
type ResolvedTheme = 'dark' | 'light'

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? getSystemTheme() : pref
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(
    () => (localStorage.getItem('mc-theme') as ThemePreference) || 'system'
  )
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference))

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  useEffect(() => {
    if (preference !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setResolved(getSystemTheme())
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [preference])

  const setTheme = useCallback((pref: ThemePreference) => {
    localStorage.setItem('mc-theme', pref)
    setPreference(pref)
    setResolved(resolveTheme(pref))
  }, [])

  const cycle = useCallback(() => {
    const next: ThemePreference =
      preference === 'system' ? 'light' : preference === 'light' ? 'dark' : 'system'
    setTheme(next)
  }, [preference, setTheme])

  return { theme: resolved, preference, cycle, setTheme }
}
