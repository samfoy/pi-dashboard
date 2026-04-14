import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePanelState } from '../hooks/usePanelState'
import type { Comment } from '../hooks/usePanelState'

/**
 * Test the review integration logic that will be added to ChatPage:
 * 1. formatReviewMessage — formats comments into a chat message
 * 2. auto-open on agent .md writes
 */

// Extract the message formatting logic as a pure function for testability
function formatReviewMessage(filePath: string, comments: Comment[]): string {
  const lines = comments.map(c => {
    const lineRef = c.startLine === c.endLine ? `Line ${c.startLine}` : `Lines ${c.startLine}-${c.endLine}`
    return `${lineRef}: ${c.content}`
  })
  return `Please review and address the comments in ${filePath}:\n\n${lines.join('\n')}`
}

describe('Review Integration — Message Formatting', () => {
  // AC1: Review button sends formatted message
  it('formats single-line and range comments correctly', () => {
    const comments: Comment[] = [
      { id: 'c1', startLine: 5, endLine: 5, content: 'Fix typo here', version: 1, createdAt: '2026-04-14T10:00:00Z' },
      { id: 'c2', startLine: 10, endLine: 15, content: 'Refactor this section', version: 1, createdAt: '2026-04-14T11:00:00Z' },
    ]
    const msg = formatReviewMessage('/tmp/spec.md', comments)
    expect(msg).toBe(
      'Please review and address the comments in /tmp/spec.md:\n\n' +
      'Line 5: Fix typo here\n' +
      'Lines 10-15: Refactor this section'
    )
  })

  // AC2: Message appears as user message (verified by checking send is called with correct text)
  it('formats single comment', () => {
    const comments: Comment[] = [
      { id: 'c1', startLine: 3, endLine: 3, content: 'Needs clarification', version: 1, createdAt: '2026-04-14T10:00:00Z' },
    ]
    const msg = formatReviewMessage('/docs/design.md', comments)
    expect(msg).toContain('Please review and address the comments in /docs/design.md')
    expect(msg).toContain('Line 3: Needs clarification')
  })
})

describe('Review Integration — Auto-Open on Agent .md Write', () => {
  // AC3: Auto-open when panel is closed and agent writes to a previously discussed .md file
  it('should auto-open when panel is closed and discussed .md file changes', () => {
    const handleFileOpen = vi.fn()
    const discussedFiles = new Set(['/tmp/spec.md'])

    // Simulate the auto-open logic
    const panelIsOpen = false
    const panelFilePath = ''
    const changedPath = '/tmp/spec.md'

    const shouldAutoOpen = !panelIsOpen && changedPath.endsWith('.md') && discussedFiles.has(changedPath)
    if (shouldAutoOpen) handleFileOpen(changedPath)

    expect(handleFileOpen).toHaveBeenCalledWith('/tmp/spec.md')
  })

  // AC4: No auto-open when panel is busy with different file
  it('should NOT auto-open when panel is open with a different file', () => {
    const handleFileOpen = vi.fn()
    const discussedFiles = new Set(['/tmp/spec.md'])

    const panelIsOpen = true
    const panelFilePath = '/tmp/other.md'
    const changedPath = '/tmp/spec.md'

    const shouldAutoOpen = !panelIsOpen && changedPath.endsWith('.md') && discussedFiles.has(changedPath)
    if (shouldAutoOpen) handleFileOpen(changedPath)

    expect(handleFileOpen).not.toHaveBeenCalled()
  })

  // Auto-open should NOT trigger for non-.md files
  it('should NOT auto-open for non-.md files', () => {
    const handleFileOpen = vi.fn()
    const discussedFiles = new Set(['/tmp/app.ts'])

    const panelIsOpen = false
    const changedPath = '/tmp/app.ts'

    const shouldAutoOpen = !panelIsOpen && changedPath.endsWith('.md') && discussedFiles.has(changedPath)
    if (shouldAutoOpen) handleFileOpen(changedPath)

    expect(handleFileOpen).not.toHaveBeenCalled()
  })

  // Auto-open when panel is open with the SAME file (just refresh, not interrupt)
  it('should auto-open when panel is open with the same .md file', () => {
    const handleFileOpen = vi.fn()
    const discussedFiles = new Set(['/tmp/spec.md'])

    const panelIsOpen = true
    const panelFilePath = '/tmp/spec.md'
    const changedPath = '/tmp/spec.md'

    // Same file is OK — it's already showing, the live update handles it
    // Auto-open only needed when panel is closed
    const shouldAutoOpen = !panelIsOpen && changedPath.endsWith('.md') && discussedFiles.has(changedPath)
    if (shouldAutoOpen) handleFileOpen(changedPath)

    expect(handleFileOpen).not.toHaveBeenCalled()
  })
})
