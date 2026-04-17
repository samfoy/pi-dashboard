import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePanelState, detectFileType } from '../hooks/usePanelState'

describe('usePanelState', () => {
  // Existing behavior preserved
  it('opens and closes panel', () => {
    const { result } = renderHook(() => usePanelState())
    expect(result.current.isOpen).toBe(false)
    act(() => result.current.openPanel('/a.md', 'hello'))
    expect(result.current.isOpen).toBe(true)
    expect(result.current.filePath).toBe('/a.md')
    expect(result.current.content).toBe('hello')
    act(() => result.current.closePanel())
    expect(result.current.isOpen).toBe(false)
  })

  // AC1: setDirty updates flag
  it('setDirty updates dirty flag', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.openPanel('/a.md', 'x'))
    expect(result.current.dirty).toBe(false)
    act(() => result.current.setDirty(true))
    expect(result.current.dirty).toBe(true)
    act(() => result.current.setDirty(false))
    expect(result.current.dirty).toBe(false)
  })

  // AC2: setConflictContent stores conflict
  it('setConflictContent stores conflict', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.openPanel('/a.md', 'x'))
    expect(result.current.conflictContent).toBeNull()
    act(() => result.current.setConflictContent('new content'))
    expect(result.current.conflictContent).toBe('new content')
  })

  // AC3: resolveConflict('reload') applies conflict content, resets dirty, clears conflict
  it('resolveConflict reload applies conflict content and resets dirty', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.openPanel('/a.md', 'original'))
    act(() => result.current.setDirty(true))
    act(() => result.current.setConflictContent('disk content'))
    act(() => result.current.resolveConflict('reload'))
    expect(result.current.content).toBe('disk content')
    expect(result.current.dirty).toBe(false)
    expect(result.current.conflictContent).toBeNull()
  })

  // AC4: resolveConflict('keep') clears conflict without changing content
  it('resolveConflict keep clears conflict, preserves content', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.openPanel('/a.md', 'my edits'))
    act(() => result.current.setConflictContent('server content'))
    act(() => result.current.resolveConflict('keep'))
    expect(result.current.conflictContent).toBeNull()
    expect(result.current.content).toBe('my edits')
  })

  // AC5: setVersions / selectVersion round-trip
  it('setVersions and selectVersion round-trip', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.openPanel('/a.md', 'x'))
    const versions = [
      { version: 1, timestamp: '2026-01-01T00:00:00Z', size: 10 },
      { version: 2, timestamp: '2026-01-01T01:00:00Z', size: 20 },
    ]
    act(() => result.current.setVersions(versions))
    expect(result.current.versions).toEqual(versions)
    act(() => result.current.selectVersion(1))
    expect(result.current.selectedVersion).toBe(1)
    act(() => result.current.selectVersion(null))
    expect(result.current.selectedVersion).toBeNull()
  })

  // AC6: toggleDiffMode flips state
  it('toggleDiffMode flips state', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.openPanel('/a.md', 'x'))
    expect(result.current.diffMode).toBe(false)
    act(() => result.current.toggleDiffMode())
    expect(result.current.diffMode).toBe(true)
    act(() => result.current.toggleDiffMode())
    expect(result.current.diffMode).toBe(false)
  })

  // AC7: openPanel resets extended state
  it('openPanel resets all extended state', () => {
    const { result } = renderHook(() => usePanelState())
    // Set up dirty state
    act(() => result.current.openPanel('/a.md', 'x'))
    act(() => result.current.setDirty(true))
    act(() => result.current.setConflictContent('conflict'))
    act(() => result.current.setVersions([{ version: 1, timestamp: 't', size: 1 }]))
    act(() => result.current.selectVersion(1))
    act(() => result.current.toggleDiffMode())
    act(() => result.current.setDiffBase(1))
    act(() => result.current.setComments([{ id: '1', startLine: 1, endLine: 1, content: 'c', version: 1, createdAt: 't' }]))

    // Open new panel — everything resets
    act(() => result.current.openPanel('/b.md', 'new'))
    expect(result.current.dirty).toBe(false)
    expect(result.current.conflictContent).toBeNull()
    expect(result.current.versions).toEqual([])
    expect(result.current.selectedVersion).toBeNull()
    expect(result.current.diffMode).toBe(false)
    expect(result.current.diffBase).toBeNull()
    expect(result.current.comments).toEqual([])
  })

  // setDiffBase
  it('setDiffBase updates diffBase', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.openPanel('/a.md', 'x'))
    expect(result.current.diffBase).toBeNull()
    act(() => result.current.setDiffBase(2))
    expect(result.current.diffBase).toBe(2)
  })

  // setComments
  it('setComments updates comments', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.openPanel('/a.md', 'x'))
    const comments = [{ id: 'c1', startLine: 1, endLine: 3, content: 'fix this', version: 1, createdAt: '2026-01-01T00:00:00Z' }]
    act(() => result.current.setComments(comments))
    expect(result.current.comments).toEqual(comments)
  })

  it('supports comments with anchor field', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.openPanel('/a.pdf', ''))
    const comments = [{
      id: 'c1', startLine: 0, endLine: 0,
      content: 'check this page', version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      anchor: 'page:3'
    }]
    act(() => result.current.setComments(comments))
    expect(result.current.comments).toEqual(comments)
    expect(result.current.comments[0].anchor).toBe('page:3')
  })
})

describe('detectFileType', () => {
  it('returns text for .md files', () => {
    expect(detectFileType('/path/to/file.md')).toBe('text')
  })

  it('returns text for .ts files', () => {
    expect(detectFileType('/path/to/file.ts')).toBe('text')
  })

  it('returns text for .json files', () => {
    expect(detectFileType('/path/to/file.json')).toBe('text')
  })

  it('returns text for .py files', () => {
    expect(detectFileType('/path/to/file.py')).toBe('text')
  })

  it('returns pdf for .pdf files', () => {
    expect(detectFileType('/path/to/file.pdf')).toBe('pdf')
  })

  it('returns pdf for .PDF (case-insensitive)', () => {
    expect(detectFileType('/path/to/file.PDF')).toBe('pdf')
  })

  it('returns docx for .docx files', () => {
    expect(detectFileType('/path/to/file.docx')).toBe('docx')
  })

  it('returns spreadsheet for .xlsx files', () => {
    expect(detectFileType('/path/to/file.xlsx')).toBe('spreadsheet')
  })

  it('returns spreadsheet for .xls files', () => {
    expect(detectFileType('/path/to/file.xls')).toBe('spreadsheet')
  })

  it('returns spreadsheet for .csv files', () => {
    expect(detectFileType('/path/to/file.csv')).toBe('spreadsheet')
  })

  it('returns image for .png files', () => {
    expect(detectFileType('/path/to/file.png')).toBe('image')
  })

  it('returns image for .jpg files', () => {
    expect(detectFileType('/path/to/file.jpg')).toBe('image')
  })

  it('returns image for .svg files', () => {
    expect(detectFileType('/path/to/file.svg')).toBe('image')
  })

  it('returns image for .webp files', () => {
    expect(detectFileType('/path/to/file.webp')).toBe('image')
  })

  it('returns text for files with no extension', () => {
    expect(detectFileType('noext')).toBe('text')
  })

  it('returns text for unknown extensions', () => {
    expect(detectFileType('/path/to/file.xyz')).toBe('text')
  })
})
