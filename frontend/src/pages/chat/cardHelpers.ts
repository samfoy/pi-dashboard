export const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n) + '…' : s

export function parseToolArgs(args: string | undefined): Record<string, unknown> {
  try { return args ? JSON.parse(args) : {} } catch { return {} }
}
