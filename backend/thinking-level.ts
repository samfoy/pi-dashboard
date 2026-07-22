/**
 * Resolve the user's configured defaultThinkingLevel the same way pi does:
 * project settings (<cwd>/.pi/settings.json) override global
 * ($PI_CODING_AGENT_DIR or ~/.pi/agent/settings.json). pi's own model
 * resolver IGNORES defaultThinkingLevel whenever a model is passed (CLI --model
 * on the RPC path, or the resolved `model` option on the SDK path) — it
 * short-circuits to the hardcoded "medium" default. Because the dashboard
 * always drives slots with an explicit model, every slot would otherwise be
 * stuck on medium regardless of settings.json — so both transports re-apply the
 * resolved default (RPC via set_thinking_level after spawn; SDK via the runtime
 * factory's thinkingLevel option).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import os from 'os'

function readThinkingLevelFrom(file: string): string | null {
  try {
    const s = JSON.parse(readFileSync(file, 'utf-8'))
    const lvl = s?.defaultThinkingLevel
    return typeof lvl === 'string' ? lvl : null
  } catch { return null }
}

export function resolveDefaultThinkingLevel(cwd?: string | null): string | null {
  // 1. Project-scoped settings take precedence
  if (cwd) {
    const projectLvl = readThinkingLevelFrom(join(cwd, '.pi', 'settings.json'))
    if (projectLvl) return projectLvl
  }
  // 2. Global agent settings
  const agentDir = process.env.PI_CODING_AGENT_DIR
    ? process.env.PI_CODING_AGENT_DIR.replace(/^~(?=$|\/)/, os.homedir())
    : join(os.homedir(), '.pi', 'agent')
  return readThinkingLevelFrom(join(agentDir, 'settings.json'))
}
