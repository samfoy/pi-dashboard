import DOMPurify from 'dompurify'

export function esc(s: string | null | undefined | number): string {
  if (s == null) return ''
  const str = String(s)
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function md(t: string): string {
  let h = esc(t)
  h = h.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>')
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>')
  return DOMPurify.sanitize(h)
}

/** Sanitize pre-escaped HTML (e.g. tool output passed through esc()). */
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html)
}

export function fmtSpeed(kbs: number): string {
  return kbs >= 1024 ? (kbs / 1024).toFixed(1) + ' MB/s' : Math.round(kbs) + ' KB/s'
}
