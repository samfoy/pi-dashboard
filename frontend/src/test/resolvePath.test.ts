import { describe, it, expect } from 'vitest'
import { resolvePath } from '../utils/resolvePath'

describe('resolvePath', () => {
  const cwd = '/workplace/samfp/CSSelfHealingWG/src/CSSelfHealingWG'

  it('returns absolute paths unchanged', () => {
    const p = '/workplace/samfp/CSSelfHealingWG/src/CSSelfHealingWG/docs/design/1-pager.md'
    expect(resolvePath(p, cwd)).toBe(p)
  })

  it('returns ~ paths unchanged (backend expandHome handles them)', () => {
    expect(resolvePath('~/vault/Notes/foo.md', cwd)).toBe('~/vault/Notes/foo.md')
    expect(resolvePath('~', cwd)).toBe('~')
  })

  it('joins workspace-relative paths against cwd — the 1-pager.md fix', () => {
    expect(resolvePath('docs/design/1-pager.md', cwd))
      .toBe('/workplace/samfp/CSSelfHealingWG/src/CSSelfHealingWG/docs/design/1-pager.md')
  })

  it('collapses leading ./ on relative paths', () => {
    expect(resolvePath('./docs/design/1-pager.md', cwd))
      .toBe('/workplace/samfp/CSSelfHealingWG/src/CSSelfHealingWG/docs/design/1-pager.md')
  })

  it('handles bare hyphenated filenames', () => {
    expect(resolvePath('1-pager.md', cwd))
      .toBe('/workplace/samfp/CSSelfHealingWG/src/CSSelfHealingWG/1-pager.md')
  })

  it('strips a trailing slash from cwd before joining', () => {
    expect(resolvePath('foo.md', '/tmp/work/')).toBe('/tmp/work/foo.md')
  })

  it('leaves relative paths alone when no cwd is known', () => {
    expect(resolvePath('docs/1-pager.md', null)).toBe('docs/1-pager.md')
    expect(resolvePath('docs/1-pager.md', undefined)).toBe('docs/1-pager.md')
    expect(resolvePath('docs/1-pager.md', '')).toBe('docs/1-pager.md')
  })

  it('returns empty input unchanged', () => {
    expect(resolvePath('', cwd)).toBe('')
  })
})
