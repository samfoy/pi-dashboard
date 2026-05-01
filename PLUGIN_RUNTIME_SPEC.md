# Plugin Runtime for pi-dashboard

## Objective

Implement a plugin runtime system for ~/pi-dashboard that allows external packages to contribute React components to named UI slots. Port the architecture from BlackBeltTechnology/pi-agent-dashboard (cloned at ~/scratch/bbt-pi-dash-probe/pi-agent-dashboard/) but adapt it to our simpler project structure.

## Project Structure

- `~/pi-dashboard/frontend/` — Vite + React frontend
- `~/pi-dashboard/backend/` — Express + tsx backend (5 files: server.ts, pi-manager.ts, pi-env.ts, pty-manager.ts, session-store.ts)
- `~/pi-dashboard/shared/src/` — Shared types (already set up with @shared/* path alias)
- Frontend tsconfig: `frontend/tsconfig.app.json` (paths: `@shared/*` → `../shared/src/*`)
- Backend tsconfig: `backend/tsconfig.json` (paths: `@shared/*` → `../shared/src/*`)
- Vite config: `frontend/vite.config.ts` (alias: `@shared` → `../shared/src`)
- Build: `cd frontend && npm run build` (runs `tsc -b && vite build`)
- Backend runs via: `tsx backend/server.ts`

## Reference Implementation

Study these files from ~/scratch/bbt-pi-dash-probe/pi-agent-dashboard/:
- `packages/dashboard-plugin-runtime/src/slot-registry.ts` — SlotRegistry
- `packages/dashboard-plugin-runtime/src/plugin-context.tsx` — PluginContextProvider
- `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` — Slot consumer components
- `packages/dashboard-plugin-runtime/src/slot-error-boundary.tsx` — Error boundary
- `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts` — Vite codegen plugin
- `packages/dashboard-plugin-runtime/src/server/loader.ts` — Server-side plugin discovery
- `packages/demo-plugin/` — Example plugin

## What to Build

### Phase 1: Core Runtime (shared + frontend)

1. **Slot types** — `shared/src/plugin-types.ts`
   - `SlotId` union type: `'tool-renderer' | 'settings-section' | 'command-route' | 'session-card-badge' | 'content-header'`
   - `ClaimEntry` interface
   - `PluginManifest` interface (matches package.json `pi-dashboard-plugin` field)

2. **Slot Registry** — `frontend/src/plugins/slot-registry.ts`
   - `createSlotRegistry()` returning `{ getClaims, getAllClaims, addClaim, removeClaims }`
   - Claims sorted by (priority asc, pluginId asc)
   - Filter helpers: `forToolName()`, `forTab()`, `forCommand()`

3. **Plugin Context** — `frontend/src/plugins/plugin-context.tsx`
   - `PluginContextProvider` wrapping the app
   - `CurrentPluginLayer` for per-contribution scoping
   - Hooks: `usePluginConfig<T>()`, `usePluginLogger()`, `usePluginSend()`, `useSlotRegistry()`
   - Config store with subscribe/update pattern

4. **Slot Error Boundary** — `frontend/src/plugins/slot-error-boundary.tsx`
   - Catches errors in plugin components, shows plugin ID + slot ID + error message
   - Does NOT crash the rest of the dashboard

5. **Slot Consumers** — `frontend/src/plugins/slot-consumers.tsx`
   - `ToolRendererSlot` — renders custom tool call UI, accepts `FallbackComponent`
   - `SettingsSectionSlot` — renders plugin settings in a tab
   - `CommandRouteSlot` — renders full-page views for slash commands
   - Each wraps contributions in SlotErrorBoundary + CurrentPluginLayer

6. **Barrel export** — `frontend/src/plugins/index.ts`

### Phase 2: Integration

7. **Wrap App** — In `frontend/src/App.tsx`, wrap the router in `<PluginContextProvider registry={...}>`

8. **Wire ToolRendererSlot into ToolCallBlock** — In `frontend/src/pages/chat/ToolCallBlock.tsx`:
   - Before the existing hardcoded rendering, check `<ToolRendererSlot toolName={...} toolInput={...} sessionId={...} FallbackComponent={ExistingToolCallRenderer} />`
   - If no plugin claims the tool, fall back to existing rendering

9. **Wire SettingsSectionSlot into SettingsPage** — In `frontend/src/pages/SettingsPage.tsx`:
   - Add `<SettingsSectionSlot tab="general" />` at the bottom of the general settings section

### Phase 3: Plugin Loading

10. **Vite plugin** — `frontend/vite-plugins/dashboard-plugins.ts`
    - On build/dev start, scan `~/pi-dashboard/plugins/*/package.json` for `pi-dashboard-plugin` manifests
    - Generate `frontend/src/generated/plugin-registry.tsx` with named imports per claim
    - Register into vite.config.ts

11. **Plugin directory** — Create `~/pi-dashboard/plugins/` directory

### Phase 4: Demo Plugin

12. **Demo plugin** — `~/pi-dashboard/plugins/demo-plugin/`
    - `package.json` with `pi-dashboard-plugin` manifest
    - `src/client.tsx` exporting `DemoSettings` and `DemoToolRenderer`
    - DemoSettings: simple form showing plugin config works
    - DemoToolRenderer: renders a styled card for toolName "DashboardDemo"

## Constraints

- Do NOT modify the backend server for this feature (plugin runtime is frontend-only for now)
- Do NOT add new npm dependencies — use only React APIs (createContext, useState, useEffect, etc.)
- Match existing code style: functional components, Tailwind-style utility classes via CSS variables (bg-bg, text-text, border-border, etc.)
- All new files go under `frontend/src/plugins/` except the Vite plugin and generated registry
- The build MUST pass: `cd frontend && npm run build` (tsc -b && vite build)
- Backend typecheck must still pass: `cd ~/pi-dashboard && npm run typecheck` (2 preexisting SQL errors are OK)
- Keep the existing tool call rendering as the fallback — plugins enhance, never break existing UI

## Verification

After implementation:
1. `cd ~/pi-dashboard/frontend && npm run build` must succeed
2. `cd ~/pi-dashboard && npm run typecheck` must have no new errors
3. The demo plugin's DemoSettings should appear in the Settings page
4. The existing chat UI must work unchanged (no regressions)
