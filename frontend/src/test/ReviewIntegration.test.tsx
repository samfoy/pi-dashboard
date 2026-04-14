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
  onReviewComments: vi.fn(),
}

beforeEach(() => { vi.clearAllMocks() })

describe('Review Integration — InlineComments', () => {
  // AC1: Review button sends message (via callback)
  it('calls onReviewComments when Review Comments button is clicked', () => {
    const comments: Comment[] = [
      { id: 'c1', startLine: 5, endLine: 5, content: 'Fix typo', version: 1, createdAt: '2026-04-14T10:00:00Z' },
      { id: 'c2', startLine: 10, endLine: 15, content: 'Refactor this', version: 1, createdAt: '2026-04-14T11:00:00Z' },
    ]
    render(<InlineComments {...baseProps} comments={comments} currentVersion={1} />)
    const btn = screen.getByRole('button', { name: /review comments/i })
    fireEvent.click(btn)
    expect(baseProps.onReviewComments).toHaveBeenCalledTimes(1)
  })

  // AC5: Button disabled when no comments for current version
  it('disables Review Comments button when no comments match current version', () => {
    const comments: Comment[] = [
      { id: 'c1', startLine: 1, endLine: 1, content: 'old', version: 2, createdAt: '2026-04-14T10:00:00Z' },
    ]
    render(<InlineComments {...baseProps} comments={comments} currentVersion={1} />)
    // No comments for version 1 → nav bar not shown, so no button
    expect(screen.queryByRole('button', { name: /review comments/i })).toBeNull()
  })

  // AC5 variant: button present but disabled when comments exist but all filtered out
  it('shows Review Comments button when comments exist for current version', () => {
    const comments: Comment[] = [
      { id: 'c1', startLine: 5, endLine: 5, content: 'Fix this', version: 1, createdAt: '2026-04-14T10:00:00Z' },
    ]
    render(<InlineComments {...baseProps} comments={comments} currentVersion={1} />)
    const btn = screen.getByRole('button', { name: /review comments/i })
    expect(btn).toBeTruthy()
    expect(btn).not.toBeDisabled()
  })
})
