import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DocumentPanel from '../components/DocumentPanel'

// Stub MarkdownRenderer to avoid heavy deps
vi.mock('../components/MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => <div data-testid="md-render">{content}</div>,
}))

// Stub DiffView
vi.mock('../components/DiffView', () => ({
  default: ({ oldLabel, newLabel }: { oldLabel: string; newLabel: string }) => <div data-testid="diff-view">{oldLabel} → {newLabel}</div>,
}))

const baseProps = {
  filePath: '/tmp/test.md',
  content: '# Hello',
  onContentChange: vi.fn(),
  onSave: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
  dirty: false,
  versions: [] as any[],
  selectedVersion: null as number | null,
  conflictContent: null as string | null,
  onSelectVersion: vi.fn(),
  onResolveConflict: vi.fn(),
  diffMode: false,
  onToggleDiff: vi.fn(),
  comments: [] as any[],
  onAddComment: vi.fn(),
  onEditComment: vi.fn(),
  onDeleteComment: vi.fn(),
}

beforeEach(() => { vi.clearAllMocks() })

describe('DocumentPanel — Version Picker', () => {
  it('AC1: shows version dropdown with versions and Current', () => {
    const versions = [
      { version: 1, timestamp: '2026-04-14T10:00:00Z', size: 100 },
      { version: 2, timestamp: '2026-04-14T11:00:00Z', size: 200 },
    ]
    render(<DocumentPanel {...baseProps} versions={versions} />)
    const select = screen.getByRole('combobox', { name: /version/i })
    const options = Array.from(select.querySelectorAll('option'))
    expect(options).toHaveLength(3) // v1, v2, Current
    expect(options[0].textContent).toMatch(/v1/)
    expect(options[1].textContent).toMatch(/v2/)
    expect(options[2].textContent).toMatch(/current/i)
  })

  it('AC2: old version makes editor read-only', () => {
    const versions = [{ version: 1, timestamp: '2026-04-14T10:00:00Z', size: 100 }]
    const { container } = render(
      <DocumentPanel {...baseProps} versions={versions} selectedVersion={1} />
    )
    // Should show a read-only indicator
    expect(screen.getByText(/read.only/i)).toBeTruthy()
    // Editor textarea should be disabled or not present
    const ta = container.querySelector('textarea')
    if (ta) expect(ta).toHaveAttribute('disabled')
  })

  it('AC3: current version (selectedVersion=null) is editable', () => {
    const { container } = render(<DocumentPanel {...baseProps} selectedVersion={null} />)
    // Switch to edit mode
    fireEvent.click(screen.getByText('Edit'))
    const ta = container.querySelector('textarea')
    expect(ta).toBeTruthy()
    expect(ta!.hasAttribute('disabled')).toBe(false)
  })

  it('AC7: diff toggle button calls onToggleDiff', () => {
    const versions = [{ version: 1, timestamp: '2026-04-14T10:00:00Z', size: 100 }]
    render(<DocumentPanel {...baseProps} versions={versions} />)
    const diffBtn = screen.getByRole('button', { name: /diff/i })
    fireEvent.click(diffBtn)
    expect(baseProps.onToggleDiff).toHaveBeenCalled()
  })
})

describe('DocumentPanel — Conflict Bar', () => {
  it('AC4: conflict bar appears when conflictContent is non-null', () => {
    render(<DocumentPanel {...baseProps} conflictContent="new content from disk" />)
    expect(screen.getByText(/file changed on disk/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /keep mine/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /show diff/i })).toBeTruthy()
  })

  it('AC4: conflict bar hidden when conflictContent is null', () => {
    render(<DocumentPanel {...baseProps} conflictContent={null} />)
    expect(screen.queryByText(/file changed on disk/i)).toBeNull()
  })

  it('AC5: Reload calls onResolveConflict("reload")', () => {
    render(<DocumentPanel {...baseProps} conflictContent="new" />)
    fireEvent.click(screen.getByRole('button', { name: /reload/i }))
    expect(baseProps.onResolveConflict).toHaveBeenCalledWith('reload')
  })

  it('AC6: Keep Mine calls onResolveConflict("keep")', () => {
    render(<DocumentPanel {...baseProps} conflictContent="new" />)
    fireEvent.click(screen.getByRole('button', { name: /keep mine/i }))
    expect(baseProps.onResolveConflict).toHaveBeenCalledWith('keep')
  })

  it('Show Diff calls onResolveConflict("diff")', () => {
    render(<DocumentPanel {...baseProps} conflictContent="new" />)
    fireEvent.click(screen.getByRole('button', { name: /show diff/i }))
    expect(baseProps.onResolveConflict).toHaveBeenCalledWith('diff')
  })
})

describe('DocumentPanel — No Local Dirty State (AC8)', () => {
  it('uses dirty prop for save button state', () => {
    const { rerender } = render(<DocumentPanel {...baseProps} dirty={false} />)
    // Save button should be disabled when not dirty
    const saveBtn = screen.getByRole('button', { name: /save/i })
    expect(saveBtn).toBeDisabled()

    // Re-render with dirty=true
    rerender(<DocumentPanel {...baseProps} dirty={true} />)
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
  })
})

describe('DocumentPanel — Right-click Comment', () => {
  it('shows context menu on right-click with text selection', () => {
    const content = 'line 1\nline 2\nline 3'
    const { container } = render(
      <DocumentPanel {...baseProps} content={content} />
    )
    // The content area has onContextMenu handler
    const contentArea = container.querySelector('.flex-1.overflow-hidden.p-4')
    expect(contentArea).toBeTruthy()

    // Simulate a text selection via getSelection mock
    const mockSelection = {
      isCollapsed: false,
      toString: () => 'line 2',
    }
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as any)

    // Right-click on content area
    fireEvent.contextMenu(contentArea!)

    // Context menu should appear with Add Comment option
    expect(screen.getByText(/Add Comment/)).toBeTruthy()

    vi.restoreAllMocks()
  })

  it('does not show context menu when no text is selected', () => {
    const { container } = render(
      <DocumentPanel {...baseProps} content="hello" />
    )
    const contentArea = container.querySelector('.flex-1.overflow-hidden.p-4')

    // No selection
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: true } as any)
    fireEvent.contextMenu(contentArea!)

    // No context menu
    expect(screen.queryByText(/Add Comment/)).toBeNull()

    vi.restoreAllMocks()
  })
})
