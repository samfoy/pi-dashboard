/**
 * Plugin system types shared between frontend and backend.
 *
 * Keep this file dependency-free (no Node-only or DOM-only imports) so that
 * both build targets can consume it without extra config.
 */

// ── Slot IDs ─────────────────────────────────────────────────────────────────

/** Named UI slots that plugins can contribute components to. */
export type SlotId =
  | 'tool-renderer'
  | 'settings-section'
  | 'command-route'
  | 'sidebar-panel'
  | 'status-bar'
  | 'session-card-badge'
  | 'content-header'
  | 'system-message-renderer'

// ── Claim entry ──────────────────────────────────────────────────────────────

/** A resolved slot claim entry held in the registry. */
export interface ClaimEntry {
  pluginId: string
  priority: number
  slot: SlotId
  componentName?: string
  command?: string
  trigger?: string
  toolName?: string
  tab?: string
  customType?: string
  config?: Record<string, unknown>
  predicate?: (props: unknown) => boolean
  /** The resolved React component (set at registration time by generated code). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component?: any
}

// ── Plugin manifest ──────────────────────────────────────────────────────────

/** Shape of the `pi-dashboard-plugin` field in a plugin's package.json. */
export interface PluginManifest {
  id: string
  name: string
  version?: string
  description?: string
  client?: string
  claims: Array<{
    slot: SlotId
    componentName: string
    priority?: number
    toolName?: string
    tab?: string
    command?: string
    trigger?: string
    customType?: string
    config?: Record<string, unknown>
  }>
}
