/**
 * Plugin context provider and hooks for dashboard plugins.
 *
 * The PluginContextProvider wraps the entire React app. Each slot consumer
 * pushes a nested CurrentPluginContext layer when rendering a contribution,
 * scoping hooks like usePluginConfig<T>() and logger to the contributing plugin.
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import { createSlotRegistry, type SlotRegistry } from './slot-registry'

// ── Logger ───────────────────────────────────────────────────────────────────

export interface PluginLogger {
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}

function createPluginLogger(pluginId: string): PluginLogger {
  const prefix = `[plugin:${pluginId}]`
  return {
    info: (msg, ...args) => console.info(prefix, msg, ...args),
    warn: (msg, ...args) => console.warn(prefix, msg, ...args),
    error: (msg, ...args) => console.error(prefix, msg, ...args),
  }
}

// ── Plugin context (outer) ───────────────────────────────────────────────────

interface PluginContextValue {
  registry: SlotRegistry
  getPluginConfig(pluginId: string): Record<string, unknown>
  subscribePluginConfig(
    pluginId: string,
    cb: (config: Record<string, unknown>) => void,
  ): () => void
  send(message: unknown): void
}

const PluginReactContext = createContext<PluginContextValue | null>(null)

// ── Per-plugin context (nested, pushed by slot consumers) ────────────────────

interface CurrentPluginContextValue {
  pluginId: string
}
const CurrentPluginContext = createContext<CurrentPluginContextValue | null>(null)

// ── Public hooks (called from plugin component code) ─────────────────────────

/** @public — called only from plugin slot contributions */
export function usePluginConfig<T = Record<string, unknown>>(): T {
  const outer = useContext(PluginReactContext)
  const current = useContext(CurrentPluginContext)
  if (!current) {
    throw new Error('usePluginConfig must be called from a plugin slot contribution')
  }
  if (!outer) throw new Error('usePluginConfig requires <PluginContextProvider>')

  const { pluginId } = current
  const [config, setConfig] = useState<Record<string, unknown>>(
    () => outer.getPluginConfig(pluginId),
  )

  useEffect(() => {
    return outer.subscribePluginConfig(pluginId, setConfig)
  }, [outer, pluginId])

  return config as T
}

/** @public — namespaced logger for the current plugin contribution */
export function usePluginLogger(): PluginLogger {
  const current = useContext(CurrentPluginContext)
  if (!current) {
    throw new Error('usePluginLogger must be called from a plugin slot contribution')
  }
  return useMemo(() => createPluginLogger(current.pluginId), [current.pluginId])
}

/** @public — dispatch a message (future: over WebSocket) */
export function usePluginSend(): (message: unknown) => void {
  const ctx = useContext(PluginReactContext)
  if (!ctx) throw new Error('usePluginSend requires <PluginContextProvider>')
  return ctx.send
}

/** Returns the slot registry, or null when outside a PluginContextProvider. */
export function useSlotRegistryOrNull(): SlotRegistry | null {
  const ctx = useContext(PluginReactContext)
  return ctx ? ctx.registry : null
}

/** Returns the slot registry. Throws when outside a PluginContextProvider. */
export function useSlotRegistry(): SlotRegistry {
  const ctx = useContext(PluginReactContext)
  if (!ctx) throw new Error('useSlotRegistry requires <PluginContextProvider>')
  return ctx.registry
}

// ── Config store (in-memory, keyed by plugin id) ─────────────────────────────

const pluginConfigs = new Map<string, Record<string, unknown>>()
const configSubscribers = new Map<string, Set<(c: Record<string, unknown>) => void>>()

function getConfig(pluginId: string): Record<string, unknown> {
  return pluginConfigs.get(pluginId) ?? {}
}

function subscribeConfig(
  pluginId: string,
  cb: (config: Record<string, unknown>) => void,
): () => void {
  if (!configSubscribers.has(pluginId)) configSubscribers.set(pluginId, new Set())
  configSubscribers.get(pluginId)!.add(cb)
  return () => configSubscribers.get(pluginId)?.delete(cb)
}

// ── Provider ─────────────────────────────────────────────────────────────────

export interface PluginContextProviderProps {
  children: ReactNode
  registry?: SlotRegistry
  send?: (message: unknown) => void
}

export function PluginContextProvider({
  children,
  registry,
  send: sendFn,
}: PluginContextProviderProps) {
  const resolvedRegistry = registry ?? createSlotRegistry()

  const send = useCallback(
    (message: unknown) => {
      if (sendFn) sendFn(message)
    },
    [sendFn],
  )

  const value: PluginContextValue = {
    registry: resolvedRegistry,
    getPluginConfig: getConfig,
    subscribePluginConfig: subscribeConfig,
    send,
  }

  return <PluginReactContext.Provider value={value}>{children}</PluginReactContext.Provider>
}

// ── Slot consumer wrapper ─────────────────────────────────────────────────────

/**
 * Wraps a single contribution's component in the nested CurrentPluginContext
 * layer so that usePluginConfig<T>() and usePluginLogger() resolve to the
 * correct plugin's namespace.
 */
export function CurrentPluginLayer({
  pluginId,
  children,
}: {
  pluginId: string
  children: ReactNode
}) {
  return (
    <CurrentPluginContext.Provider value={{ pluginId }}>
      {children}
    </CurrentPluginContext.Provider>
  )
}

// Re-export types consumers need
export type { SlotRegistry }
