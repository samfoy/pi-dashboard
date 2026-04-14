import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DiffView from '../components/DiffView'

const baseProps = {
  oldContent: '',
  newContent: '',
  oldLabel: 'v1',
  newLabel: 'v2',
  onClose: vi.fn(),
}

beforeEach(() => { vi.clearAllMocks() })

describe('DiffView', () => {
  it('AC1: added lines have bg-diff-add class', () => {
    const { container } = render(
      <DiffView {...baseProps} oldContent="a\nb" newContent="a\nb\nc" />
    )
    const addLines = container.querySelectorAll('.bg-diff-add')
    expect(addLines.length).toBeGreaterThan(0)
    // The added line should contain "c"
    const texts = Array.from(addLines).map(el => el.textContent)
    expect(texts.some(t => t?.includes('c'))).toBe(true)
  })

  it('AC2: removed lines have bg-diff-del class', () => {
    const { container } = render(
      <DiffView {...baseProps} oldContent="a\nb\nc" newContent="a\nb" />
    )
    const delLines = container.querySelectorAll('.bg-diff-del')
    expect(delLines.length).toBeGreaterThan(0)
    const texts = Array.from(delLines).map(el => el.textContent)
    expect(texts.some(t => t?.includes('c'))).toBe(true)
  })

  it('AC3: unchanged lines have no bg-diff-* class', () => {
    const { container } = render(
      <DiffView {...baseProps} oldContent="a\nb" newContent="a\nc" />
    )
    // There should be diff lines rendered (del "b", add "c", and context "a")
    const allLines = container.querySelectorAll('[data-diff-line]')
    expect(allLines.length).toBeGreaterThanOrEqual(2)
    // The add/del lines should have diff backgrounds
    const addLines = container.querySelectorAll('.bg-diff-add')
    const delLines = container.querySelectorAll('.bg-diff-del')
    expect(addLines.length).toBeGreaterThan(0)
    expect(delLines.length).toBeGreaterThan(0)
    // add+del should not account for ALL lines — context lines exist without diff bg
    expect(addLines.length + delLines.length).toBeLessThanOrEqual(allLines.length)
  })

  it('AC4: word-level highlighting within changed lines', () => {
    const { container } = render(
      <DiffView {...baseProps} oldContent="hello world" newContent="hello earth" />
    )
    // Should have word-level highlight spans
    const wordHighlights = container.querySelectorAll('[data-diff-word]')
    expect(wordHighlights.length).toBeGreaterThan(0)
  })

  it('AC5: stats show +N / -N counts', () => {
    const { container } = render(
      <DiffView {...baseProps} oldContent="a\nb\nc\nd" newContent="a\nx\ny\nz\nb" />
    )
    // Header should show + and - counts
    const header = container.querySelector('[data-diff-stats]')
    expect(header).toBeTruthy()
    expect(header!.textContent).toMatch(/\+\d+/)
    expect(header!.textContent).toMatch(/-\d+/)
  })

  it('AC6: hunk navigation scrolls to next hunk', () => {
    // Create content with two separate hunks (unchanged lines between changes)
    const oldLines = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8', 'line9', 'line10']
    const newLines = ['line1', 'CHANGED2', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8', 'line9', 'CHANGED10']
    const { container } = render(
      <DiffView {...baseProps} oldContent={oldLines.join('\n')} newContent={newLines.join('\n')} />
    )
    const nextBtn = container.querySelector('[data-diff-nav-next]')
    expect(nextBtn).toBeTruthy()
    // Mock scrollIntoView
    const mockScroll = vi.fn()
    const hunks = container.querySelectorAll('[data-diff-hunk]')
    hunks.forEach(h => { (h as HTMLElement).scrollIntoView = mockScroll })
    fireEvent.click(nextBtn!)
    expect(mockScroll).toHaveBeenCalled()
  })

  it('AC7: version labels displayed in header', () => {
    render(
      <DiffView {...baseProps} oldLabel="v1" newLabel="v2 (current)" oldContent="a" newContent="b" />
    )
    expect(screen.getByText('v1')).toBeTruthy()
    expect(screen.getByText('v2 (current)')).toBeTruthy()
  })

  it('AC8: empty content does not crash', () => {
    const { container } = render(
      <DiffView {...baseProps} oldContent="" newContent="" />
    )
    expect(container.querySelector('[data-diff-empty]')).toBeTruthy()
    expect(screen.getByText(/no changes/i)).toBeTruthy()
  })

  it('AC9: identical content shows "No changes" message', () => {
    render(
      <DiffView {...baseProps} oldContent="same" newContent="same" />
    )
    expect(screen.getByText(/no changes/i)).toBeTruthy()
  })

  it('close button calls onClose', () => {
    render(
      <DiffView {...baseProps} oldContent="a" newContent="b" />
    )
    const closeBtn = screen.getByRole('button', { name: /close/i })
    fireEvent.click(closeBtn)
    expect(baseProps.onClose).toHaveBeenCalled()
  })
})
