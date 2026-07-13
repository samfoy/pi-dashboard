/**
 * THROWAWAY OPS SCRIPT — NOT PRODUCT CODE. Slice 10 gate of the SDK-migration plan.
 *
 * Live 2-slot cross-talk isolation probe (flip bar ITEM 5, the last HARD GATE).
 *
 * The unit test `backend/__tests__/sdk-isolation.test.js` covers
 * construction-level isolation with injected fakes (per-instance state + one
 * shared-ModelRegistry cross-talk case). Design §4 flags the REAL risk as the
 * process-shared `ModelRegistry` / `AuthStorage` under two CONCURRENT LIVE SDK
 * sessions — which fakes cannot exercise. This script closes that gap: it stands
 * up two live `PiSdkSession`s with DIFFERENT models, runs a real turn on each
 * concurrently, mutates slot A, and asserts slot B is untouched and each slot
 * actually used ITS OWN model.
 *
 * ── REQUIRES A LIVE LLM PROVIDER ──
 * Output: `ITEM 5 (2-slot isolation): PASS` (exit 0) or a precise FAIL diff
 * (exit 2). If item 5 FAILs, the slice-10 flip MUST NOT proceed.
 *
 * Run (example):
 *   PI_A_MODEL_ID=anthropic.claude-haiku-4-5-20251001-v1:0 \
 *   PI_B_MODEL_ID=anthropic.claude-sonnet-4-5-20250929-v1:0 \
 *   PI_ISO_PROMPT="Reply with exactly the word: pong." \
 *   npx tsx scripts/probe-2slot-isolation.ts
 *
 * Env:
 *   PI_ISO_PROMPT   turn prompt for both slots (default a tiny deterministic one)
 *   PI_ISO_PROVIDER model provider for both slots (default amazon-bedrock)
 *   PI_A_MODEL_ID / PI_B_MODEL_ID   the two DISTINCT model ids
 *   PI_A_MUTATE_MODEL_ID            model A is switched TO in the mutation step
 *                                   (default: a third distinct model)
 */
import * as os from 'node:os'
import { PiSdkSession } from '../backend/pi-sdk-session.js'

const PROMPT = process.env.PI_ISO_PROMPT || 'Reply with exactly the word: pong.'
const PROVIDER = process.env.PI_ISO_PROVIDER || 'amazon-bedrock'
const A_MODEL = process.env.PI_A_MODEL_ID || 'anthropic.claude-haiku-4-5-20251001-v1:0'
const B_MODEL = process.env.PI_B_MODEL_ID || 'anthropic.claude-sonnet-4-5-20250929-v1:0'
const A_MUTATE_MODEL = process.env.PI_A_MUTATE_MODEL_ID || 'anthropic.claude-opus-4-5-20251101-v1:0'
const A_MUTATE_THINKING = process.env.PI_A_MUTATE_THINKING || 'high'

const fails: string[] = []
function check(cond: boolean, ok: string, bad: string) {
  if (cond) console.log(`  ✓ ${ok}`)
  else { console.log(`  ✗ ${bad}`); fails.push(bad) }
}

async function boot(key: string, modelId: string, cwd: string): Promise<PiSdkSession> {
  const pi = new PiSdkSession(key, { cwd, modelProvider: PROVIDER, modelId, transport: 'sdk' })
  pi.start()
  const anyPi = pi as any
  if (anyPi._initPromise) await anyPi._initPromise
  const deadline = Date.now() + 30000
  while (!pi.ready && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
  if (!anyPi._session) throw new Error(`slot ${key}: live session never came up — check auth/model`)
  return pi
}

function stateModel(pi: PiSdkSession): { provider?: string; id?: string } {
  const st: any = (pi as any)._session?.state
  const m = st?.model
  return { provider: m?.provider, id: m?.id }
}

async function runTurn(pi: PiSdkSession): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    pi.once('agent_end', () => resolve())
    pi.once('error', reject)
    pi.once('exit', () => resolve())
    void pi.prompt(PROMPT)
  })
}

async function main() {
  console.log('=== Live 2-slot cross-talk isolation probe (flip bar item 5) ===')
  console.log(`provider=${PROVIDER}`)
  console.log(`slot A model=${A_MODEL}`)
  console.log(`slot B model=${B_MODEL}`)
  console.log(`prompt=${JSON.stringify(PROMPT)}\n`)

  const cwdA = process.cwd()
  const cwdB = os.tmpdir()

  console.log('Booting two concurrent live SDK slots...')
  const [a, b] = await Promise.all([boot('iso-A', A_MODEL, cwdA), boot('iso-B', B_MODEL, cwdB)])

  const regA = (a as any)._session?.modelRegistry
  const regB = (b as any)._session?.modelRegistry
  console.log(`\nService isolation: modelRegistry same object? ${regA === regB} (design §4: per-slot cwd-bound services)`)

  // ── Baseline: each slot resolved to its OWN model ──
  console.log('\n[1] per-slot model resolution at boot:')
  const sa0 = stateModel(a), sb0 = stateModel(b)
  console.log(`    A.state.model=${sa0.provider}/${sa0.id}`)
  console.log(`    B.state.model=${sb0.provider}/${sb0.id}`)
  check(sa0.id === A_MODEL, `A resolved its own model (${A_MODEL})`, `A resolved ${sa0.id}, expected ${A_MODEL}`)
  check(sb0.id === B_MODEL, `B resolved its own model (${B_MODEL})`, `B resolved ${sb0.id}, expected ${B_MODEL}`)
  check(sa0.id !== sb0.id, 'A and B have DISTINCT resolved models', `A and B share a model (${sa0.id})`)

  // ── Concurrent real turns ──
  console.log('\n[2] running a real turn on EACH slot concurrently...')
  await Promise.all([runTurn(a), runTurn(b)])
  const sa1 = stateModel(a), sb1 = stateModel(b)
  console.log(`    after turns: A.state.model=${sa1.id}  B.state.model=${sb1.id}`)
  check(sa1.id === A_MODEL, `A still on its own model after concurrent turn`, `A drifted to ${sa1.id} after turn`)
  check(sb1.id === B_MODEL, `B still on its own model after concurrent turn`, `B drifted to ${sb1.id} after turn`)
  check(a.messages.length > 0 && b.messages.length > 0, 'both slots produced messages', 'a slot produced no messages')

  // ── Mutate A, cross-read B ──
  console.log(`\n[3] mutating slot A (setThinkingLevel=${A_MUTATE_THINKING}, setModel=${A_MUTATE_MODEL}), then cross-reading B:`)
  const bBefore = { provider: b.modelProvider, id: b.modelId, thinking: b.thinkingLevel }
  const bStateBefore = stateModel(b)
  await a.setThinkingLevel(A_MUTATE_THINKING)
  await a.setModel(PROVIDER, A_MUTATE_MODEL)
  const bAfter = { provider: b.modelProvider, id: b.modelId, thinking: b.thinkingLevel }
  const bStateAfter = stateModel(b)
  console.log(`    A now: ${a.modelProvider}/${a.modelId} thinking=${a.thinkingLevel}`)
  console.log(`    B before: ${bBefore.id} thinking=${bBefore.thinking} | B after: ${bAfter.id} thinking=${bAfter.thinking}`)
  check(a.modelId === A_MUTATE_MODEL, `A adopted the mutated model (${A_MUTATE_MODEL})`, `A.setModel did not take (got ${a.modelId})`)
  check(bAfter.id === bBefore.id, `B.modelId UNCHANGED by A's mutation`, `B.modelId bled: ${bBefore.id} → ${bAfter.id}`)
  check(bAfter.thinking === bBefore.thinking, `B.thinkingLevel UNCHANGED by A's mutation`, `B.thinkingLevel bled: ${bBefore.thinking} → ${bAfter.thinking}`)
  check(bStateAfter.id === bStateBefore.id, `B.session.state.model UNCHANGED by A's mutation`, `B session model bled: ${bStateBefore.id} → ${bStateAfter.id}`)

  // ── A post-mutation turn does NOT disturb B ──
  console.log('\n[4] one more turn on A (mutated), re-check B untouched:')
  await runTurn(a)
  const sb2 = stateModel(b)
  check(sb2.id === B_MODEL, `B STILL on its own model after A's post-mutation turn`, `B drifted to ${sb2.id}`)

  console.log('\ncleaning up slots...')
  try { a.kill() } catch { /* ignore */ }
  try { b.kill() } catch { /* ignore */ }

  console.log('')
  if (fails.length === 0) {
    console.log('ITEM 5 (2-slot isolation): PASS — two concurrent live SDK slots kept fully isolated model/thinking/session state; A\'s mutations never bled into B.')
    process.exit(0)
  } else {
    console.log(`ITEM 5 (2-slot isolation): FAIL — ${fails.length} finding(s):`)
    for (const f of fails) console.log(`  - ${f}`)
    console.log('\nDO NOT flip the default transport. Shared mutable state bleeds across concurrent SDK slots.')
    process.exit(2)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
