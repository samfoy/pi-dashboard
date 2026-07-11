/**
 * Golden-transcript parity guardrail (A2/A3).
 *
 * For a FIXED sequence of core events, assert that `PiSdkSession._translate`
 * produces byte-identical output to `PiRpcSession._handleEvent`:
 *   1. the ordered list of internal emissions (name + payload), and
 *   2. the final `messages[]` array (the partial→final splice + rebuild).
 *
 * The internal emissions are the frozen-FE parity boundary (design §1/§2):
 * `_wireSlotEvents` maps them to WS frames by a pure function, so identical
 * internal emissions ⇒ identical WS frames. This test enforces that boundary
 * without a live LLM provider — synthetic `AgentSessionEvent`-shaped objects
 * are fed straight through each impl's translation seam (RPC `_handleEvent`,
 * SDK `_translate`).
 *
 * Determinism notes:
 *   - Every fixture message carries an explicit `timestamp` so derived `ts`
 *     values don't depend on wall-clock `Date.now()`.
 *   - No base64 image parts in tool results (those mint random filenames — that
 *     path is exercised elsewhere; it can't be byte-identical across two runs).
 */
import { describe, it, expect } from 'vitest'
import { PiRpcSession } from '../pi-manager.js'
import { PiSdkSession } from '../pi-sdk-session.js'

/** Record every internal emission (name + payload), preserving order. */
function capture(pi) {
  const events = []
  const orig = pi.emit.bind(pi)
  pi.emit = (name, ...args) => {
    events.push({ name, payload: args.length <= 1 ? args[0] : args })
    return orig(name, ...args)
  }
  return events
}

// A fixed, realistic single-turn transcript. The `agent_end.messages` array
// exercises the interleaved assistant content (thinking + toolCall + text),
// a toolResult attaching to its tool message, and a custom message.
const TS = '2026-07-11T00:00:00.000Z'
function transcript() {
  return [
    { type: 'agent_start' },
    { type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } },
    { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'let me think' } },
    { type: 'message_update', assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: 'let me think' } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'Hello' } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: ' world' } },
    { type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'bash', args: { command: 'ls -la' } },
    { type: 'tool_execution_update', toolCallId: 'tc-1', toolName: 'bash', args: { command: 'ls -la' }, partialResult: 'file1\n' },
    { type: 'tool_execution_end', toolCallId: 'tc-1', toolName: 'bash', result: 'file1\nfile2\n', isError: false },
    { type: 'turn_start' },
    { type: 'turn_end', message: { role: 'assistant', content: [] }, toolResults: [] },
    { type: 'message_end', message: { role: 'custom', customType: 'note', content: 'a custom note', timestamp: TS } },
    {
      type: 'agent_end',
      willRetry: false, // SDK-only field; 7a ignores it (mirrors RPC terminal handling)
      messages: [
        {
          role: 'assistant',
          timestamp: TS,
          content: [
            { type: 'thinking', thinking: 'let me think' },
            { type: 'toolCall', id: 'tc-1', name: 'bash', arguments: { command: 'ls -la' } },
            { type: 'text', text: 'Hello world' },
          ],
        },
        {
          role: 'toolResult',
          toolCallId: 'tc-1',
          isError: false,
          content: [{ type: 'text', text: 'file1\nfile2\n' }],
        },
        {
          role: 'custom',
          customType: 'note',
          timestamp: TS,
          content: 'a custom note',
        },
      ],
    },
  ]
}

describe('golden transcript: SDK _translate === RPC _handleEvent', () => {
  it('produces byte-identical internal emissions and messages for a core turn', () => {
    const rpc = new PiRpcSession('golden-rpc', {})
    const sdk = new PiSdkSession('golden-sdk', {})

    const rpcEvents = capture(rpc)
    const sdkEvents = capture(sdk)

    // Feed independent deep clones so neither impl mutates the other's input.
    for (const ev of transcript()) rpc._handleEvent(structuredClone(ev))
    for (const ev of transcript()) sdk._translate(structuredClone(ev))

    // (1) Internal emission stream — identical name+payload, identical order.
    expect(sdkEvents).toEqual(rpcEvents)

    // (2) Final rebuilt messages[] — identical splice + content rebuild.
    expect(sdk.messages).toEqual(rpc.messages)

    // Guard: the transcript actually produced the emissions we care about
    // (so an all-empty match can't pass vacuously).
    const names = rpcEvents.map(e => e.name)
    expect(names).toContain('agent_start')
    expect(names).toContain('thinking_update')
    expect(names).toContain('message_update')
    expect(names).toContain('tool_start')
    expect(names).toContain('tool_update')
    expect(names).toContain('tool_end')
    expect(names).toContain('agent_end')
    // And the rebuilt transcript has the interleaved assistant content + tool result.
    expect(rpc.messages.length).toBeGreaterThan(0)
    const toolMsg = rpc.messages.find(m => m.role === 'tool')
    expect(toolMsg?.meta?.result).toBe('file1\nfile2\n')
  })

  it('agent_end splice replaces partial streaming messages with the final set', () => {
    const rpc = new PiRpcSession('golden-rpc-2', {})
    const sdk = new PiSdkSession('golden-sdk-2', {})

    // agent_start marks _streamIdx; a stray partial gets spliced away at agent_end.
    for (const pi of [rpc, sdk]) {
      pi._streamIdx = -1
    }
    rpc._handleEvent({ type: 'agent_start' })
    sdk._translate({ type: 'agent_start' })
    // simulate a partial assistant chunk landing in messages during streaming
    rpc.messages.push({ role: 'assistant', content: 'partial…', ts: TS })
    sdk.messages.push({ role: 'assistant', content: 'partial…', ts: TS })

    const endEv = {
      type: 'agent_end',
      messages: [{ role: 'assistant', timestamp: TS, content: [{ type: 'text', text: 'final answer' }] }],
    }
    rpc._handleEvent(structuredClone(endEv))
    sdk._translate(structuredClone(endEv))

    expect(sdk.messages).toEqual(rpc.messages)
    // partial removed, final present
    expect(rpc.messages.map(m => m.content)).toEqual(['final answer'])
  })
})
