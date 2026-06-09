/**
 * Auth stub — token auth removed (single-user, Tailscale-protected server).
 * Kept as a module so call sites don't need updating.
 */

export function initToken(): void {}
export function getToken(): string | null { return null }
export function withToken(url: string): string { return url }
export function authHeader(): Record<string, string> { return {} }
