import { describe, it, expect } from 'vitest'
import { parseBlocks } from '../hooks/useBlockAssembler'

describe('parseBlocks', () => {
  it('parses plain markdown', () => {
    const blocks = parseBlocks('Hello **world**', false)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ type: 'markdown', content: 'Hello **world**', complete: true })
  })

  it('parses a fenced code block', () => {
    const blocks = parseBlocks('before\n```js\nconst x = 1\n```\nafter', false)
    expect(blocks).toHaveLength(3)
    expect(blocks[0].type).toBe('markdown')
    expect(blocks[1]).toEqual({ type: 'code', content: 'const x = 1', language: 'js', complete: true })
    expect(blocks[2].type).toBe('markdown')
  })

  it('detects diff content', () => {
    const blocks = parseBlocks('```\n@@ -1,3 +1,4 @@\n-old\n+new\n```', false)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('diff')
  })

  it('detects diff language hint', () => {
    const blocks = parseBlocks('```diff\n+added line\n```', false)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('diff')
    expect(blocks[0].language).toBe('diff')
  })

  it('detects mermaid blocks', () => {
    const blocks = parseBlocks('```mermaid\ngraph TD\nA-->B\n```', false)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('mermaid')
    expect(blocks[0].language).toBe('mermaid')
  })

  it('marks unclosed fence as incomplete during streaming', () => {
    const blocks = parseBlocks('```python\ndef foo():\n  pass', true)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('code')
    expect(blocks[0].complete).toBe(false)
  })

  it('marks unclosed fence as complete when not streaming', () => {
    const blocks = parseBlocks('```python\ndef foo():\n  pass', false)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].complete).toBe(true)
  })

  it('handles multiple code blocks', () => {
    const blocks = parseBlocks('text\n```\ncode1\n```\nmiddle\n```\ncode2\n```', false)
    expect(blocks).toHaveLength(4)
    expect(blocks.filter(b => b.type === 'code')).toHaveLength(2)
    expect(blocks.filter(b => b.type === 'markdown')).toHaveLength(2)
  })

  it('handles empty input', () => {
    const blocks = parseBlocks('', false)
    expect(blocks).toHaveLength(0)
  })

  it('handles kiro-cli diff format', () => {
    const blocks = parseBlocks('```\n+10:const x = 1\n-5:const y = 2\n```', false)
    expect(blocks[0].type).toBe('diff')
  })
})
