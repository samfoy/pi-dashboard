import { describe, it, expect } from 'vitest'
import { extOf, wrapCode, stripMd, langFor, MD_EXTS } from '../components/renderers/TextRenderer'

describe('extOf', () => {
  it('returns the extension including the dot', () => {
    expect(extOf('foo.ts')).toBe('.ts')
  })

  it('lowercases the extension', () => {
    expect(extOf('README.MD')).toBe('.md')
    expect(extOf('image.PNG')).toBe('.png')
  })

  it('returns empty string when there is no dot', () => {
    expect(extOf('Makefile')).toBe('')
  })

  it('uses the last dot for files with multiple dots', () => {
    expect(extOf('archive.tar.gz')).toBe('.gz')
  })

  it('handles dot-files (hidden files) with no extension', () => {
    // ".gitignore" — lastIndexOf('.') === 0, so slice(0) === '.gitignore'
    // The function treats the whole name as the extension — that is the
    // defined behaviour; pin it so we catch any future change.
    expect(extOf('.gitignore')).toBe('.gitignore')
  })

  it('handles an empty string path', () => {
    expect(extOf('')).toBe('')
  })

  it('handles a path with directory separators', () => {
    expect(extOf('src/utils/helper.py')).toBe('.py')
  })
})

describe('wrapCode', () => {
  it('wraps content in a fenced code block using the extension without the dot', () => {
    expect(wrapCode('const x = 1', '.ts')).toBe('~~~ts\nconst x = 1\n~~~')
  })

  it('uses the raw ext value when the dot is absent', () => {
    expect(wrapCode('print("hi")', 'py')).toBe('~~~py\nprint("hi")\n~~~')
  })

  it('produces an empty-language fence for an empty extension', () => {
    expect(wrapCode('hello', '')).toBe('~~~\nhello\n~~~')
  })

  it('preserves multi-line content exactly', () => {
    const content = 'line 1\nline 2\nline 3'
    const result = wrapCode(content, '.js')
    expect(result).toBe('~~~js\nline 1\nline 2\nline 3\n~~~')
  })
})

describe('MD_EXTS', () => {
  it('contains expected markdown extensions', () => {
    expect(MD_EXTS.has('.md')).toBe(true)
    expect(MD_EXTS.has('.markdown')).toBe(true)
    expect(MD_EXTS.has('.mdx')).toBe(true)
    expect(MD_EXTS.has('.txt')).toBe(true)
  })

  it('contains the empty string (no-extension files render as markdown)', () => {
    expect(MD_EXTS.has('')).toBe(true)
  })

  it('does not contain code extensions', () => {
    expect(MD_EXTS.has('.ts')).toBe(false)
    expect(MD_EXTS.has('.py')).toBe(false)
    expect(MD_EXTS.has('.json')).toBe(false)
  })
})

describe('langFor', () => {
  const cases: Array<[string, string]> = [
    ['.ts', 'typescript'],
    ['.tsx', 'typescript'],
    ['.js', 'javascript'],
    ['.jsx', 'javascript'],
    ['.py', 'python'],
    ['.json', 'json'],
    ['.yaml', 'yaml'],
    ['.yml', 'yaml'],
    ['.sh', 'bash'],
    ['.css', 'css'],
    ['.html', 'html'],
    ['.md', 'markdown'],
    ['.rs', 'rust'],
    ['.go', 'go'],
    ['.java', 'java'],
    ['.kt', 'kotlin'],
    ['.rb', 'ruby'],
    ['.sql', 'sql'],
    ['.xml', 'xml'],
    ['.toml', 'ini'],
    ['.cfg', 'ini'],
  ]

  for (const [ext, expected] of cases) {
    it(`maps ${ext} → ${expected}`, () => {
      expect(langFor(ext)).toBe(expected)
    })
  }

  it('returns "plaintext" for unknown extensions', () => {
    expect(langFor('.xyz')).toBe('plaintext')
    expect(langFor('.unknown')).toBe('plaintext')
  })

  it('returns "plaintext" for an empty string', () => {
    expect(langFor('')).toBe('plaintext')
  })
})

describe('stripMd', () => {
  it('strips h1–h6 headings', () => {
    expect(stripMd('# Title')).toBe('Title')
    expect(stripMd('## Subtitle')).toBe('Subtitle')
    expect(stripMd('###### Deep')).toBe('Deep')
  })

  it('strips bold text', () => {
    expect(stripMd('**bold**')).toBe('bold')
    expect(stripMd('__bold__')).toBe('__bold__') // only * syntax is stripped
  })

  it('strips italic text', () => {
    expect(stripMd('*italic*')).toBe('italic')
  })

  it('strips bold-italic (triple asterisks)', () => {
    expect(stripMd('***bold-italic***')).toBe('bold-italic')
  })

  it('strips inline code', () => {
    expect(stripMd('`code`')).toBe('code')
  })

  it('strips markdown links', () => {
    expect(stripMd('[click here](https://example.com)')).toBe('click here')
  })

  it('strips image syntax', () => {
    expect(stripMd('![alt text](image.png)')).toBe('alt text')
  })

  it('strips unordered list prefixes (-, *, +)', () => {
    expect(stripMd('- item')).toBe('item')
    expect(stripMd('* item')).toBe('item')
    expect(stripMd('+ item')).toBe('item')
  })

  it('strips ordered list prefixes', () => {
    expect(stripMd('1. first')).toBe('first')
    expect(stripMd('42. answer')).toBe('answer')
  })

  it('strips blockquote prefix', () => {
    expect(stripMd('> quoted text')).toBe('quoted text')
  })

  it('trims surrounding whitespace', () => {
    expect(stripMd('  hello  ')).toBe('hello')
  })

  it('leaves plain text unchanged', () => {
    expect(stripMd('just plain text')).toBe('just plain text')
  })

  it('handles an empty string', () => {
    expect(stripMd('')).toBe('')
  })
})
