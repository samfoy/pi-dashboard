/**
 * THROWAWAY OPS SCRIPT — NOT PRODUCT CODE. Slice 9 of the SDK-migration plan.
 *
 * Fixture-fidelity validation — closes the "fixtures are hand-built, not
 * live-relative" gap the 7a critic flagged. This is THE thing that must PASS
 * before the slice-10 flip (flip bar item 1).
 *
 * The golden-transcript test (backend/__tests__/golden-transcript.test.js) pins
 * that `PiSdkSession._translate` produces byte-identical output to
 * `PiRpcSession._handleEvent` for a HAND-BUILT sequence of `AgentSessionEvent`s.
 * That proves the two translators agree — but only if the hand-built fixtures
 * actually match what a REAL live SDK session emits. This script runs a live SDK
 * slot, captures the REAL `AgentSessionEvent`s, and diffs their `type` names +
 * field shapes against the fixture SHAPE CATALOG below (mirrored from the golden
 * fixtures + the `session_info_changed` / `thinking_level_changed` shapes the
 * translator reads).
 *
 * ── REQUIRES A LIVE LLM PROVIDER ──
 * Runs live (user machine, pi auth configured); it does NOT fake results.
 * Output: PASS (every live event type is in the catalog and carries at least
 * the fields the translator reads) or a PRECISE diff (unknown event types, or
 * known types missing an expected field). A trivially-prompt that never emits a
 * tool event will report those catalog entries as "not exercised" (not a fail);
 * pass a prompt that runs a tool (e.g. asks to list a directory) for full
 * coverage.
 *
 * Run (example):
 *   PI_DASH_MODEL_PROVIDER=anthropic PI_DASH_MODEL_ID=claude-sonnet-4 \
 *   PI_FIX_PROMPT="Run: list the files in the current directory using a tool, then summarize." \
 *   npx tsx scripts/validate-event-fixtures.ts
 *
 * Env:
 *   PI_FIX_PROMPT  prompt to send (default exercises a tool call)
 *   PI_FIX_CWD     slot cwd (default process.cwd())
 *   PI_DASH_MODEL_PROVIDER / PI_DASH_MODEL_ID / PI_DASH_THINKING_LEVEL
 */
import { PiSdkSession } from '../backend/pi-sdk-session.js'

const PROMPT = process.env.PI_FIX_PROMPT ||
  'Use a tool to list the files in the current directory, then tell me how many there are in one sentence.'
const CWD = process.env.PI_FIX_CWD || process.cwd()
const MODEL_PROVIDER = process.env.PI_DASH_MODEL_PROVIDER || null
const MODEL_ID = process.env.PI_DASH_MODEL_ID || null
const THINKING = process.env.PI_DASH_THINKING_LEVEL || null

/**
 * SHAPE CATALOG — the AgentSessionEvent `type`s the translator handles, each
 * with the fields `PiSdkSession._translate` READS (see backend/pi-sdk-session.ts
 * switch). Kept in lockstep with the golden-transcript fixtures
 * (backend/__tests__/golden-transcript.test.js `transcript()`). If a live event
 * type is absent here, `_translate` routes it to the generic `event` emission —
 * flagged as "unknown/unmapped" so we notice a new SDK event before the flip.
 */
const CATALOG: Record<string, { fields: string[]; note?: string }> = {
  agent_start: { fields: [] },
  agent_end: { fields: ['willRetry', 'messages'], note: 'willRetry optional; messages is the final splice source' },
  message_update: { fields: ['assistantMessageEvent'], note: 'assistantMessageEvent.{type,contentIndex,delta|content}' },
  message_start: { fields: [] },
  message_end: { fields: ['message'], note: 'message.role; custom messages routed specially' },
  tool_execution_start: { fields: ['toolCallId', 'toolName', 'args'] },
  tool_execution_update: { fields: ['toolCallId', 'toolName', 'args', 'partialResult'] },
  tool_execution_end: { fields: ['toolCallId', 'toolName', 'result', 'isError'] },
  turn_start: { fields: [] },
  turn_end: { fields: ['message', 'toolResults'] },
  extension_error: { fields: [] },
  extension_ui: { fields: ['method'] },
  queue_update: { fields: ['steering', 'followUp'], note: 'both optional arrays' },
  auto_retry_start: { fields: ['attempt', 'maxAttempts', 'delayMs'] },
  auto_retry_end: { fields: ['success'] },
  session_info_changed: { fields: ['name'] },
  thinking_level_changed: { fields: ['level'] },
}

const OPTIONAL_FIELDS = new Set(['willRetry', 'partialResult', 'steering', 'followUp'])

interface Finding { type: string; kind: 'unknown-type' | 'missing-field'; detail: string }

async function main() {
  console.log('=== Fixture-fidelity validation (flip bar item 1) ===')
  console.log(`prompt=${JSON.stringify(PROMPT)} cwd=${CWD}`)
  console.log(`model=${MODEL_PROVIDER ?? '(default)'} / ${MODEL_ID ?? '(default)'} thinking=${THINKING ?? '(default)'}\n`)

  const pi = new PiSdkSession('fixture-sdk', {
    cwd: CWD, modelProvider: MODEL_PROVIDER, modelId: MODEL_ID, thinkingLevel: THINKING, transport: 'sdk',
  })
  pi.start()
  const anyPi = pi as any
  if (anyPi._initPromise) await anyPi._initPromise
  const deadline = Date.now() + 30000
  while (!pi.ready && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
  if (!anyPi._session) { console.error('FAIL: live session never came up — check auth/model.'); process.exit(1) }

  // Attach an EXTRA raw subscriber to the live AgentSession to capture the REAL
  // events (alongside the translator's own subscription — additive, no interference).
  const seen = new Map<string, Set<string>>() // type -> observed field names (union)
  const order: string[] = []
  const unsub = anyPi._session.subscribe((ev: any) => {
    const t = ev?.type
    if (!t) return
    if (!seen.has(t)) { seen.set(t, new Set()); order.push(t) }
    const fields = seen.get(t)!
    for (const k of Object.keys(ev)) if (k !== 'type') fields.add(k)
  })

  await new Promise<void>((resolve, reject) => {
    pi.once('agent_end', () => resolve())
    pi.once('error', reject)
    pi.once('exit', () => resolve())
    void pi.prompt(PROMPT)
  })
  try { unsub?.() } catch { /* ignore */ }
  try { await pi.gracefulShutdown(5000) } catch { pi.kill() }

  // ── Diff live events against the catalog ──
  const findings: Finding[] = []
  for (const t of order) {
    const cat = CATALOG[t]
    if (!cat) {
      findings.push({ type: t, kind: 'unknown-type', detail: `live event type "${t}" is NOT in the shape catalog — _translate routes it to generic \`event\`. Confirm the FE ignores it or add a mapping before the flip.` })
      continue
    }
    const observed = seen.get(t)!
    for (const f of cat.fields) {
      if (OPTIONAL_FIELDS.has(f)) continue
      if (!observed.has(f)) {
        findings.push({ type: t, kind: 'missing-field', detail: `event "${t}" is missing field "${f}" the translator reads (observed: [${[...observed].join(', ')}])` })
      }
    }
  }

  console.log('Live event types observed (in order of first appearance):')
  for (const t of order) console.log(`  ${t.padEnd(24)} fields: [${[...seen.get(t)!].join(', ')}]`)

  const catalogTypes = Object.keys(CATALOG)
  const notExercised = catalogTypes.filter(t => !seen.has(t))
  if (notExercised.length) {
    console.log(`\nCatalog types NOT exercised by this prompt (not a failure — use a richer prompt for full coverage):\n  ${notExercised.join(', ')}`)
  }

  console.log('')
  if (findings.length === 0) {
    console.log('FLIP BAR ITEM 1 (fixture fidelity): PASS — every live event type is in the catalog and carries the fields the translator reads.')
    console.log('Record PASS + the observed-types list in docs/spikes/sdk-ab-measurement.md (item 1 row).')
    process.exit(0)
  } else {
    console.log(`FLIP BAR ITEM 1 (fixture fidelity): FAIL — ${findings.length} finding(s):`)
    for (const f of findings) console.log(`  [${f.kind}] ${f.detail}`)
    console.log('\nThe golden fixtures no longer match live reality. Update the fixtures + CATALOG, re-run the golden-transcript test, then re-run this script. Do NOT flip until PASS.')
    process.exit(2)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
