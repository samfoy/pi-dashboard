import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, act, waitFor } from '@testing-library/react'
import { render } from '@testing-library/react'
import SlashCommandMenu from '../components/SlashCommandMenu'
import React from 'react'

// Mock createPortal to render inline instead of into document.body
vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom')
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  }
})

function makeAnchorRef(): React.RefObject<HTMLElement> {
  const div = document.createElement('div')
  div.getBoundingClientRect = () => ({
    top: 100, bottom: 140, left: 20, right: 400, width: 380, height: 40,
    x: 20, y: 100, toJSON: () => {},
  })
  document.body.appendChild(div)
  return { current: div }
}

describe('SlashCommandMenu', () => {
  let anchorRef: React.RefObject<HTMLElement>

  beforeEach(() => {
    anchorRef = makeAnchorRef()
    // Mock fetch for slash commands endpoint
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { name: '/clear', description: 'Clear conversation', source: 'builtin' },
        { name: '/compact', description: 'Compact context', source: 'builtin' },
        { name: '/model', description: 'Select model', source: 'builtin' },
        { name: '/custom', description: 'Custom command', source: 'extension' },
      ]),
    } as Response)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // Clean up anchor elements
    document.body.innerHTML = ''
  })

  it('renders nothing when input does not start with /', () => {
    const { container } = render(
      <SlashCommandMenu
        input="hello"
        anchorRef={anchorRef}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders command list when input starts with /', async () => {
    render(
      <SlashCommandMenu
        input="/"
        anchorRef={anchorRef}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )

    // Fallback commands should show immediately
    expect(screen.getByText('/clear')).toBeInTheDocument()
    expect(screen.getByText('/compact')).toBeInTheDocument()
  })

  it('filters commands based on input', () => {
    render(
      <SlashCommandMenu
        input="/cl"
        anchorRef={anchorRef}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('/clear')).toBeInTheDocument()
    // /compact doesn't match /cl
    expect(screen.queryByText('/compact')).toBeNull()
  })

  it('renders nothing when no commands match filter', () => {
    const { container } = render(
      <SlashCommandMenu
        input="/zzz"
        anchorRef={anchorRef}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('calls onSelect when a command is clicked', () => {
    const onSelect = vi.fn()
    render(
      <SlashCommandMenu
        input="/"
        anchorRef={anchorRef}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    )

    // mouseDown because the component uses onMouseDown
    fireEvent.mouseDown(screen.getByText('/clear'))
    expect(onSelect).toHaveBeenCalledWith('/clear ')
  })

  it('renders nothing when open is false', () => {
    const { container } = render(
      <SlashCommandMenu
        input="/"
        anchorRef={anchorRef}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        open={false}
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows source badges', () => {
    render(
      <SlashCommandMenu
        input="/"
        anchorRef={anchorRef}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )

    // The fallback commands all have 'builtin' source -> 'pi' badge
    const badges = screen.getAllByText('pi')
    expect(badges.length).toBeGreaterThan(0)
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    render(
      <SlashCommandMenu
        input="/"
        anchorRef={anchorRef}
        onSelect={vi.fn()}
        onClose={onClose}
      />
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onSelect on Enter key', () => {
    const onSelect = vi.fn()
    render(
      <SlashCommandMenu
        input="/"
        anchorRef={anchorRef}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    )

    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('/clear ')
  })
})
