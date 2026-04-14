import { describe, it, expect } from 'vitest'
import { esc, md, fmtSpeed } from '../api/helpers'

describe('esc', () => {
  it('escapes HTML entities', () => {
    expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;')
  })
  it('handles null/undefined', () => {
    expect(esc(null)).toBe('')
    expect(esc(undefined)).toBe('')
  })
  it('converts numbers to string', () => {
    expect(esc(42)).toBe('42')
  })
  it('escapes ampersands', () => {
    expect(esc('a & b')).toBe('a &amp; b')
  })
})

describe('md', () => {
  it('renders bold text', () => {
    expect(md('**hello**')).toContain('<strong>hello</strong>')
  })
  it('renders italic text', () => {
    expect(md('*hello*')).toContain('<em>hello</em>')
  })
  it('renders inline code', () => {
    expect(md('use `npm install`')).toContain('<code>npm install</code>')
  })
  it('renders code blocks', () => {
    const result = md('```js\nconsole.log(1)\n```')
    expect(result).toContain('<pre>')
    expect(result).toContain('<code>')
  })
  it('sanitizes dangerous HTML', () => {
    const result = md('<img src=x onerror=alert(1)>')
    // md() escapes HTML first, so the tag becomes &lt;img...&gt; — safe
    expect(result).not.toContain('<img')
  })
})

describe('fmtSpeed', () => {
  it('formats KB/s', () => {
    expect(fmtSpeed(500)).toBe('500 KB/s')
  })
  it('formats MB/s', () => {
    expect(fmtSpeed(2048)).toBe('2.0 MB/s')
  })
  it('rounds KB/s', () => {
    expect(fmtSpeed(99.7)).toBe('100 KB/s')
  })
})
