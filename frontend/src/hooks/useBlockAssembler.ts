import { useMemo } from 'react'
import type { ContentBlock } from '../types'

const FENCE_OPEN = /^(`{3,})(\w*)\s*$/
const FENCE_CLOSE_RE = (tick: string) => new RegExp(`^${tick}\\s*$`)
const DIFF_LINE = /^@@|^[+-]\d+:|^[+-][^+-\s]/

/** Classify whether code content looks like a unified diff. */
function isDiffContent(code: string, lang?: string): boolean {
  const lines = code.split('\n')
  const count = lines.filter(l => DIFF_LINE.test(l)).length
  return count >= 2 || (lang === 'diff' && count >= 1)
}

/**
 * Parse raw text into structured content blocks.
 * Handles fenced code blocks (```) as a state machine — content inside
 * an open fence is accumulated as a code/diff/mermaid block. Everything
 * else is grouped into markdown blocks.
 *
 * When `streaming` is true, an unclosed fence produces a block with
 * `complete: false` so the renderer can show a provisional code view.
 */
export function parseBlocks(raw: string, streaming: boolean): ContentBlock[] {
  const lines = raw.split('\n')
  const blocks: ContentBlock[] = []
  let mdBuf: string[] = []
  let codeBuf: string[] = []
  let fenceTick = ''
  let fenceLang = ''
  let inFence = false

  const flushMd = () => {
    if (mdBuf.length === 0) return
    const text = mdBuf.join('\n')
    if (text.trim()) blocks.push({ type: 'markdown', content: text, complete: true })
    mdBuf = []
  }

  const flushCode = (complete: boolean) => {
    const code = codeBuf.join('\n')
    const lang = fenceLang || undefined
    let type: ContentBlock['type'] = 'code'
    if (lang === 'mermaid') type = 'mermaid'
    else if (isDiffContent(code, lang)) type = 'diff'
    blocks.push({ type, content: code, language: lang, complete })
    codeBuf = []
    fenceTick = ''
    fenceLang = ''
    inFence = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (inFence) {
      if (FENCE_CLOSE_RE(fenceTick).test(line)) {
        flushCode(true)
      } else {
        codeBuf.push(line)
      }
    } else {
      const m = FENCE_OPEN.exec(line)
      if (m) {
        flushMd()
        fenceTick = m[1].replace(/`/g, '\\`')
        fenceLang = m[2] || ''
        inFence = true
      } else {
        mdBuf.push(line)
      }
    }
  }

  // Flush remaining
  if (inFence) {
    flushCode(!streaming) // incomplete only during streaming
  }
  flushMd()

  return blocks
}

/**
 * Hook that parses raw message text into content blocks.
 * During streaming, unclosed fences produce provisional blocks.
 * On completion (streaming=false), does a clean full reparse.
 */
export function useBlockAssembler(rawText: string, streaming: boolean): ContentBlock[] {
  return useMemo(() => parseBlocks(rawText, streaming), [rawText, streaming])
}
