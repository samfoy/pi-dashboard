import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InlineComments from '../components/InlineComments'
import type { Comment } from '../hooks/usePanelState'

const baseProps = {
  comments: [] as Comment[],
  onAdd: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  currentVersion: 1,
  activeInputRange: null as { start: number; end: number } | null,
  onCancelInput: vi.fn(),
}

beforeEach(() => { vi.clearAllMocks() })

describe('InlineComments', () => {
  // AC1: Comment renders below line with cyan border
  it('renders comment with cyan left border for matching version', () => {
    const comments: Comment[] = [{
      id: 'c1', startLine: 5, endLine: 5, content: 'Fix this typo',
      version: 1, createdAt: '2026-04-14T10:00:00Z',
    }]
    const { container } = render(
      <InlineComments {...baseProps} comments={comments} currentVersion={1} />
    )
    const comment = container.querySelector('[data-comment-id="c1"]')
    expect(comment).toBeTruthy()
    expect(comment!.textContent).toContain('Fix this typo')
    // Cyan left border
    expect(comment!.className).toMatch(/border-l.*cyan|border-cyan/)
  })

  // AC2: Comment input appears when activeInputRange is set
  it('shows comment input when activeInputRange is set', () => {
    render(
      <InlineComments {...baseProps} activeInputRange={{ start: 10, end: 10 }} />
    )
    expect(screen.getByPlaceholderText(/add a comment/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /save/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy()
  })

  // AC3: onAdd called with correct data (single line)
  it('calls onAdd with line and content on save', () => {
    render(
      <InlineComments {...baseProps} activeInputRange={{ start: 10, end: 10 }} />
    )
    const input = screen.getByPlaceholderText(/add a comment/i)
    fireEvent.change(input, { target: { value: 'fix this' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(baseProps.onAdd).toHaveBeenCalledWith(10, 10, 'fix this')
  })

  // AC3b: onAdd called with range
  it('calls onAdd with range when activeInputRange spans multiple lines', () => {
    render(
      <InlineComments {...baseProps} activeInputRange={{ start: 10, end: 15 }} />
    )
    const input = screen.getByPlaceholderText(/add a comment/i)
    fireEvent.change(input, { target: { value: 'fix this section' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(baseProps.onAdd).toHaveBeenCalledWith(10, 15, 'fix this section')
  })

  // AC4: onEdit called on edit
  it('calls onEdit when edit is triggered', () => {
    const comments: Comment[] = [{
      id: 'c1', startLine: 5, endLine: 5, content: 'old comment',
      version: 1, createdAt: '2026-04-14T10:00:00Z',
    }]
    const { container } = render(
      <InlineComments {...baseProps} comments={comments} currentVersion={1} />
    )
    // Click edit button
    const editBtn = container.querySelector('[data-action="edit-c1"]')
    expect(editBtn).toBeTruthy()
    fireEvent.click(editBtn!)
    // Should show edit input with existing content
    const input = screen.getByDisplayValue('old comment')
    fireEvent.change(input, { target: { value: 'new comment' } })
    // Save edit
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(baseProps.onEdit).toHaveBeenCalledWith('c1', 'new comment')
  })

  // AC5: onDelete called on delete
  it('calls onDelete when delete is triggered', () => {
    const comments: Comment[] = [{
      id: 'c1', startLine: 5, endLine: 5, content: 'delete me',
      version: 1, createdAt: '2026-04-14T10:00:00Z',
    }]
    const { container } = render(
      <InlineComments {...baseProps} comments={comments} currentVersion={1} />
    )
    const deleteBtn = container.querySelector('[data-action="delete-c1"]')
    expect(deleteBtn).toBeTruthy()
    fireEvent.click(deleteBtn!)
    expect(baseProps.onDelete).toHaveBeenCalledWith('c1')
  })

  // AC6: Version filtering — only matching version shown
  it('only shows comments matching currentVersion', () => {
    const comments: Comment[] = [
      { id: 'c1', startLine: 1, endLine: 1, content: 'v1 comment', version: 1, createdAt: '2026-04-14T10:00:00Z' },
      { id: 'c2', startLine: 2, endLine: 2, content: 'v3 comment', version: 3, createdAt: '2026-04-14T11:00:00Z' },
    ]
    const { container } = render(
      <InlineComments {...baseProps} comments={comments} currentVersion={3} />
    )
    expect(container.querySelector('[data-comment-id="c2"]')).toBeTruthy()
    expect(container.querySelector('[data-comment-id="c1"]')).toBeNull()
  })

  // AC8: Comment navigation — renders and scrolls
  it('renders navigation bar and scrolls on nav click', () => {
    const comments: Comment[] = [
      { id: 'c1', startLine: 1, endLine: 1, content: 'first', version: 1, createdAt: '2026-04-14T10:00:00Z' },
      { id: 'c2', startLine: 10, endLine: 10, content: 'second', version: 1, createdAt: '2026-04-14T11:00:00Z' },
      { id: 'c3', startLine: 20, endLine: 20, content: 'third', version: 1, createdAt: '2026-04-14T12:00:00Z' },
    ]
    const { container } = render(
      <InlineComments {...baseProps} comments={comments} currentVersion={1} />
    )
    // Navigation bar shows count
    expect(screen.getByText(/3 comments/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /previous comment/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /next comment/i })).toBeTruthy()

    // Mock scrollIntoView on comment elements
    const mockScroll = vi.fn()
    container.querySelectorAll('[data-comment-id]').forEach(el => {
      (el as HTMLElement).scrollIntoView = mockScroll
    })

    // Click next — should scroll to second comment
    fireEvent.click(screen.getByRole('button', { name: /next comment/i }))
    expect(mockScroll).toHaveBeenCalled()
  })

  // Cancel input calls onCancelInput
  it('calls onCancelInput when cancel is clicked', () => {
    render(
      <InlineComments {...baseProps} activeInputRange={{ start: 5, end: 5 }} />
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(baseProps.onCancelInput).toHaveBeenCalled()
  })

  // No nav bar when no comments for current version
  it('hides navigation bar when no comments match version', () => {
    const comments: Comment[] = [
      { id: 'c1', startLine: 1, endLine: 1, content: 'v2 only', version: 2, createdAt: '2026-04-14T10:00:00Z' },
    ]
    render(
      <InlineComments {...baseProps} comments={comments} currentVersion={1} />
    )
    expect(screen.queryByText(/comment/i)).toBeNull()
  })
})
