/** Barrel export for the plugin runtime. */

export { createSlotRegistry, forToolName, forTab, forCommand } from './slot-registry'
export type { SlotRegistry } from './slot-registry'

export {
  PluginContextProvider,
  CurrentPluginLayer,
  usePluginConfig,
  usePluginLogger,
  usePluginSend,
  useSlotRegistry,
  useSlotRegistryOrNull,
} from './plugin-context'
export type { PluginContextProviderProps, PluginLogger } from './plugin-context'

export { SlotErrorBoundary } from './slot-error-boundary'

export { ToolRendererSlot, SettingsSectionSlot, CommandRouteSlot } from './slot-consumers'

// Re-export shared types for convenience
export type { SlotId, ClaimEntry, PluginManifest } from '@shared/plugin-types'
