// @ts-nocheck — Plugin files are bundled by Vite, not type-checked by the frontend tsc config.
/**
 * Demo plugin — showcases the pi-dashboard plugin system.
 *
 * Exports:
 *   DemoSettings     → settings-section slot (general tab)
 *   DemoToolRenderer → tool-renderer slot (toolName: "DashboardDemo")
 */
import { usePluginConfig, usePluginLogger } from '../../../frontend/src/plugins/plugin-context'

// ── Settings section ─────────────────────────────────────────────────────────

export function DemoSettings() {
  const config = usePluginConfig<{ greeting?: string }>()
  const log = usePluginLogger()

  log.info('DemoSettings rendered', config)

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-[14px] font-semibold text-text mb-2">🧩 Demo Plugin</h3>
      <p className="text-[13px] text-muted mb-3">
        This section is rendered by the demo plugin via the <code className="font-mono text-accent">settings-section</code> slot.
      </p>
      <div className="text-[12px] text-muted/70 font-mono bg-bg-hover rounded-md px-3 py-2">
        Plugin config: {JSON.stringify(config, null, 2) || '{}'}
      </div>
    </div>
  )
}

// ── Tool renderer ────────────────────────────────────────────────────────────

export function DemoToolRenderer({
  toolName,
  toolInput,
}: {
  toolName: string
  toolInput: Record<string, unknown>
  sessionId: string
}) {
  return (
    <div className="bg-card border border-accent/30 rounded-lg p-4 animate-scale-in">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[16px]">🧩</span>
        <span className="text-[14px] font-semibold text-accent">{toolName}</span>
      </div>
      <p className="text-[13px] text-muted mb-2">
        This card is rendered by the demo plugin via the <code className="font-mono text-accent">tool-renderer</code> slot.
      </p>
      {Object.keys(toolInput).length > 0 && (
        <pre className="text-[12px] font-mono text-text/70 bg-bg-hover rounded-md px-3 py-2 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(toolInput, null, 2)}
        </pre>
      )}
    </div>
  )
}
