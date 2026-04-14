import { describe, it, expect } from 'vitest'
import { truncate, parseToolArgs } from '../pages/chat/cardHelpers'

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('returns string at exact limit unchanged', () => {
    expect(truncate('12345', 5)).toBe('12345')
  })

  it('truncates long strings with ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello…')
  })

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('')
  })

  it('truncates to 1 character', () => {
    expect(truncate('abc', 1)).toBe('a…')
  })
})

describe('parseToolArgs', () => {
  it('parses valid JSON', () => {
    expect(parseToolArgs('{"action":"start","name":"foo"}')).toEqual({ action: 'start', name: 'foo' })
  })

  it('returns empty object for undefined', () => {
    expect(parseToolArgs(undefined)).toEqual({})
  })

  it('returns empty object for invalid JSON', () => {
    expect(parseToolArgs('not json')).toEqual({})
  })

  it('returns empty object for empty string', () => {
    expect(parseToolArgs('')).toEqual({})
  })

  it('parses nested JSON', () => {
    expect(parseToolArgs('{"a":{"b":1}}')).toEqual({ a: { b: 1 } })
  })
})
