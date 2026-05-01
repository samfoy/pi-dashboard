/**
 * One slot consumer component per slot id.
 *
 * Each consumer:
 * 1. Reads the slot registry via PluginContextProvider.
 * 2. Filters claims for its slot id (and any additional prop-based filter).
 * 3. Renders each contribution wrapped in a per-claim SlotErrorBoundary
 *    and a CurrentPluginLayer (so plugin hooks work correctly).
 * 4. Renders nothing when zero claims match.
 */
import type { ClaimEntry } from '@shared/plugin-types'
import { useSlotRegistryOrNull, CurrentPluginLayer } from './plugin-context'
import { forTab, forToolName } from './slot-registry'
import { SlotErrorBoundary } from './slot-error-boundary'

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderClaim(
  claim: ClaimEntry,
  slotId: string,
  props: Record<string, unknown>,
) {
  if (!claim.Component) return null
  const Comp = claim.Component
  return (
    <SlotErrorBoundary key={`${claim.pluginId}:${slotId}`} pluginId={claim.pluginId} slotId={slotId}>
      <CurrentPluginLayer pluginId={claim.pluginId}>
        <Comp {...props} />
      </CurrentPluginLayer>
    </SlotErrorBoundary>
  )
}

// ── Slot consumers ────────────────────────────────────────────────────────────

export function ToolRendererSlot({
  toolName,
  toolInput,
  toolResult,
  isError,
  sessionId,
  FallbackComponent,
}: {
  toolName: string
  toolInput: Record<string, unknown>
  toolResult?: string
  isError?: boolean
  sessionId: string
  FallbackComponent?: React.ComponentType<{
    toolName: string
    toolInput: Record<string, unknown>
    toolResult?: string
    isError?: boolean
    sessionId: string
  }>
}) {
  const registry = useSlotRegistryOrNull()
  if (!registry) {
    return FallbackComponent
      ? <FallbackComponent toolName={toolName} toolInput={toolInput} toolResult={toolResult} isError={isError} sessionId={sessionId} />
      : null
  }
  const claims = forToolName(registry.getClaims('tool-renderer'), toolName)
  if (!claims.length) {
    return FallbackComponent
      ? <FallbackComponent toolName={toolName} toolInput={toolInput} toolResult={toolResult} isError={isError} sessionId={sessionId} />
      : null
  }
  const claim = claims[0]
  return renderClaim(claim, 'tool-renderer', { toolName, toolInput, toolResult, isError, sessionId })
}

export function SettingsSectionSlot({ tab = 'general' }: { tab?: string }) {
  const registry = useSlotRegistryOrNull()
  if (!registry) return null
  const claims = forTab(registry.getClaims('settings-section'), tab)
  if (!claims.length) return null
  return (
    <>
      {claims.map(c => renderClaim(c, 'settings-section', { tab }))}
    </>
  )
}

export function CommandRouteSlot({
  command,
  routeParams,
  onClose,
}: {
  command: string
  routeParams: Record<string, string>
  onClose: () => void
}) {
  const registry = useSlotRegistryOrNull()
  if (!registry) return null
  const allClaims = registry.getClaims('command-route')
  const claims = allClaims.filter(c => c.command === command)
  if (!claims.length) return null
  const claim = claims[0]
  return renderClaim(claim, 'command-route', { routeParams, onClose })
}

export function SidebarPanelSlot() {
  const registry = useSlotRegistryOrNull()
  if (!registry) return null
  const claims = registry.getClaims('sidebar-panel')
  if (!claims.length) return null
  return (
    <>
      {claims.map(c => renderClaim(c, 'sidebar-panel', {}))}
    </>
  )
}

export function StatusBarSlot() {
  const registry = useSlotRegistryOrNull()
  if (!registry) return null
  const claims = registry.getClaims('status-bar')
  if (!claims.length) return null
  return (
    <>
      {claims.map(c => renderClaim(c, 'status-bar', {}))}
    </>
  )
}
