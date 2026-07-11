/**
 * THROWAWAY OPS SCRIPT — NOT PRODUCT CODE. Slice 9 of the SDK-migration plan.
 *
 * Measures streaming-delta latency for an in-process SDK slot vs an RPC-child
 * slot for the SAME prompt, and prints a side-by-side comparison. This is flip
 * bar item (6): "streaming-delta latency SDK <= RPC" (design §8).
 *
 * ── REQUIRES A LIVE LLM PROVIDER ──
 * This cannot run headless in an unattended session (no provider auth). The
 * USER runs it live, on a machine with pi auth configured, and records the
 * numbers into docs/spikes/sdk-ab-measurement.md. It does NOT fake results.
 *
 * What it measures, per transport, over N runs of the same prompt:
 *   - TTFD  time-to-first-delta: prompt dispatch -> first `message_update` /
 *           `thinking_update` internal emission (the FE's first visible token).
 *   - TURN  total turn time: prompt dispatch -> `agent_end`.
 *   - N     number of streaming-delta emissions in the turn.
 *   - GAP   mean inter-delta gap (TURN-ish / N), a coarse smoothness proxy.
 * SDK is EXPECTED to win TTFD (no JSONL serialization / no child round-trip).
 *
 * Run (example):
 *   PI_DASH_MODEL_PROVIDER=anthropic PI_DASH_MODEL_ID=claude-sonnet-4 \
 *   PI_AB_PROMPT="Say hello in one short sentence." PI_AB_RUNS=3 \
 *   npx tsx scripts/measure-sdk-latency.ts
 *
 * Env:
 *   PI_AB_PROMPT   prompt to send (default: a tiny deterministic one)
 *   PI_AB_RUNS     runs per transport (default 3)
 *   PI_AB_CWD      slot cwd (default process.cwd())
 *   PI_DASH_MODEL_PROVIDER / PI_DASH_MODEL_ID   model to pin on BOTH slots
 *   PI_DASH_THINKING_LEVEL                       thinking level for both
 */
import { PiRpcSession } from '../backend/pi-manager.js'
import { PiSdkSession } from '../backend/pi-sdk-session.js'
import type { PiSession } from '../backend/pi-session.js'

const PROMPT = process.env.PI_AB_PROMPT || 'Reply with exactly the word: pong.'
const RUNS = Math.max(1, parseInt(process.env.PI_AB_RUNS || '3', 10))
const CWD = process.env.PI_AB_CWD || process.cwd()
const MODEL_PROVIDER = process.env.PI_DASH_MODEL_PROVIDER || null
const MODEL_ID = process.env.PI_DASH_MODEL_ID || null
const THINKING = process.env.PI_DASH_THINKING_LEVEL || null

interface RunResult { ttfd: number; turn: number; deltas: number }

function mean(xs: number[]): number {
  if (!xs.length) return NaN
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Wait until a slot's session is live (SDK `_initPromise`, RPC `ready`). */
async function waitReady(pi: PiSession, timeoutMs = 30000): Promise<void> {
  const sdk = pi as any
  if (sdk._initPromise) { try { await sdk._initPromise } catch { /* surfaced via startup_error */ } }
  const deadline = Date.now() + timeoutMs
  while (!pi.ready && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
}

/** Run ONE prompt against a slot and time the streaming deltas. */
async function timeOnePrompt(pi: PiSession): Promise<RunResult> {
  return await new Promise<RunResult>((resolve, reject) => {
    let firstDelta = 0
    let deltas = 0
    const start = Date.now()
    const onDelta = () => { if (!firstDelta) firstDelta = Date.now(); deltas++ }
    const onEnd = () => {
      cleanup()
      resolve({ ttfd: (firstDelta || Date.now()) - start, turn: Date.now() - start, deltas })
    }
    const onErr = (e: any) => { cleanup(); reject(e instanceof Error ? e : new Error(String(e))) }
    const cleanup = () => {
      pi.off('message_update', onDelta); pi.off('thinking_update', onDelta)
      pi.off('agent_end', onEnd); pi.off('error', onErr); pi.off('exit', onErr as any)
    }
    pi.on('message_update', onDelta)
    pi.on('thinking_update', onDelta)
    pi.once('agent_end', onEnd)
    pi.once('error', onErr)
    pi.once('exit', onErr as any)
    void pi.prompt(PROMPT)
  })
}

async function measure(label: string, make: () => PiSession): Promise<RunResult[]> {
  const results: RunResult[] = []
  for (let i = 0; i < RUNS; i++) {
    const pi = make()
    pi.start()
    await waitReady(pi)
    try {
      const r = await timeOnePrompt(pi)
      results.push(r)
      console.log(`  [${label}] run ${i + 1}/${RUNS}: TTFD=${r.ttfd}ms TURN=${r.turn}ms deltas=${r.deltas}`)
    } catch (e) {
      console.error(`  [${label}] run ${i + 1}/${RUNS} FAILED:`, e)
    } finally {
      try { await pi.gracefulShutdown(5000) } catch { pi.kill() }
    }
  }
  return results
}

function summary(label: string, rs: RunResult[]): { label: string; ttfd: number; turn: number; deltas: number } {
  return { label, ttfd: mean(rs.map(r => r.ttfd)), turn: mean(rs.map(r => r.turn)), deltas: mean(rs.map(r => r.deltas)) }
}

async function main() {
  console.log('=== SDK vs RPC streaming-delta latency (flip bar item 6) ===')
  console.log(`prompt=${JSON.stringify(PROMPT)} runs=${RUNS} cwd=${CWD}`)
  console.log(`model=${MODEL_PROVIDER ?? '(default)'} / ${MODEL_ID ?? '(default)'} thinking=${THINKING ?? '(default)'}\n`)

  const opts = { cwd: CWD, modelProvider: MODEL_PROVIDER, modelId: MODEL_ID, thinkingLevel: THINKING }

  console.log('RPC slot:')
  const rpc = await measure('rpc', () => new PiRpcSession('ab-rpc', { ...opts, transport: 'rpc' }))
  console.log('\nSDK slot:')
  const sdk = await measure('sdk', () => new PiSdkSession('ab-sdk', { ...opts, transport: 'sdk' }))

  const sr = summary('RPC', rpc)
  const ss = summary('SDK', sdk)
  console.log('\n=== SUMMARY (mean) ===')
  console.log('transport   TTFD(ms)   TURN(ms)   deltas')
  for (const s of [sr, ss]) {
    console.log(`${s.label.padEnd(10)}  ${String(Math.round(s.ttfd)).padStart(8)}  ${String(Math.round(s.turn)).padStart(8)}  ${String(Math.round(s.deltas)).padStart(6)}`)
  }
  const verdict = ss.ttfd <= sr.ttfd
  console.log(`\nFLIP BAR ITEM 6 (latency SDK <= RPC): ${verdict ? 'PASS' : 'FAIL'} — SDK TTFD ${Math.round(ss.ttfd)}ms vs RPC ${Math.round(sr.ttfd)}ms`)
  console.log('Record these numbers in docs/spikes/sdk-ab-measurement.md (item 6 row).')
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
