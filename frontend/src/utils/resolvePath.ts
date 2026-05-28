/**
 * Resolve a file path the user clicked / typed against a workspace cwd.
 *
 * The dashboard backend's file-serving endpoints (`/api/file-read`,
 * `/api/local-file`, etc.) `readFile` the path as-is. When a path is
 * relative the OS resolves it against `process.cwd()` of the dashboard
 * process — which is the install dir, not the user's workspace — so any
 * relative path 404s. Inline references in assistant messages and the
 * referenced-files panel routinely produce relative paths
 * (e.g. `docs/design/1-pager.md`); we resolve them here against the
 * active slot's cwd before they hit the wire.
 *
 * Rules:
 *   - empty input → empty (caller will short-circuit / 400)
 *   - `/abs/...` → returned unchanged
 *   - `~/...` or `~` → returned unchanged (backend's `expandHome` handles it)
 *   - relative + cwd → joined onto cwd (and `./` collapsed)
 *   - relative + no cwd → returned unchanged (preserves prior behaviour)
 */
export function resolvePath(path: string, cwd?: string | null): string {
  if (!path) return path
  if (path.startsWith('/') || path.startsWith('~')) return path
  if (!cwd) return path
  // Strip leading ./ — `cwd/./foo` is fine on POSIX but ugly in tooltips.
  const cleaned = path.replace(/^\.\//, '')
  const base = cwd.endsWith('/') ? cwd.slice(0, -1) : cwd
  return `${base}/${cleaned}`
}
