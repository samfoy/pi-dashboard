/**
 * Typed slot registry for the dashboard plugin system.
 *
 * The registry holds a Map<SlotId, ClaimEntry[]> pre-sorted by
 * (priority asc, pluginId asc) for deterministic render order.
 */
import type { SlotId, ClaimEntry } from '@shared/plugin-types'

export interface SlotRegistry {
  /** All claims for the given slot, pre-sorted. */
  getClaims(slotId: SlotId): ClaimEntry[]
  /** All claims across all slots. */
  getAllClaims(): ClaimEntry[]
  /** Add a claim. Inserts in sorted order. */
  addClaim(claim: ClaimEntry): void
  /** Remove all claims belonging to a plugin. */
  removeClaims(pluginId: string): void
}

function compareClaims(a: ClaimEntry, b: ClaimEntry): number {
  const pa = a.priority ?? 1000
  const pb = b.priority ?? 1000
  if (pa !== pb) return pa - pb
  return a.pluginId.localeCompare(b.pluginId)
}

export function createSlotRegistry(): SlotRegistry {
  const store = new Map<SlotId, ClaimEntry[]>()

  function getBucket(slotId: SlotId): ClaimEntry[] {
    if (!store.has(slotId)) store.set(slotId, [])
    return store.get(slotId)!
  }

  return {
    getClaims(slotId: SlotId): ClaimEntry[] {
      return store.get(slotId) ?? []
    },

    getAllClaims(): ClaimEntry[] {
      const all: ClaimEntry[] = []
      for (const claims of store.values()) all.push(...claims)
      return all
    },

    addClaim(claim: ClaimEntry): void {
      const bucket = getBucket(claim.slot)
      bucket.push(claim)
      bucket.sort(compareClaims)
    },

    removeClaims(pluginId: string): void {
      for (const [, claims] of store.entries()) {
        const filtered = claims.filter(c => c.pluginId !== pluginId)
        store.set(claims[0]?.slot ?? 'tool-renderer', filtered)
      }
    },
  }
}

// ── Filter helpers ───────────────────────────────────────────────────────────

/** Filter tool-renderer claims by tool name. */
export function forToolName(claims: ClaimEntry[], toolName: string): ClaimEntry[] {
  return claims.filter(c => c.toolName === toolName)
}

/** Filter settings-section claims by tab. */
export function forTab(claims: ClaimEntry[], tab: string): ClaimEntry[] {
  return claims.filter(c => (c.tab ?? 'general') === tab)
}

/** Filter command-route claims by command string. */
export function forCommand(claims: ClaimEntry[], command: string): ClaimEntry[] {
  return claims.filter(c => c.command === command)
}
