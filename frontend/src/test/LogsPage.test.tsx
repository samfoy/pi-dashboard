import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { WsContext } from '../App'
import LogsPage from '../pages/LogsPage'
import type { ReactNode } from 'react'

// Stub UI components — we're testing LogsPage logic, not the design system
vi.mock('../components/ui', () => ({
  PageHeader: ({ title }: { title: string }) => <div data-testid="page-header">{title}</div>,
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>{children}</div>
  ),
  SearchInput: ({ value, onChange, placeholder }: { value: string; onChange: (e: any) => void; placeholder?: string }) => (
    <input data-testid="search-input" value={value} onChange={onChange} placeholder={placeholder} />
  ),
  Badge: ({ variant, children }: { variant: string; children: ReactNode }) => (
    <span data-testid="badge" data-variant={variant}>{children}</span>
  ),
}))

// ── helpers ──────────────────────────────────────────────────────────────────

type LogCb = ((data: { level: string; msg: string }) => void) | null

function makeSubscribeLogs() {
  let capturedCb: LogCb = null
  const fn = vi.fn((cb: LogCb) => { capturedCb = cb })
  // Single log — each call wrapped in its own act()
  const push = (data: { level: string; msg: string }) => {
    act(() => { capturedCb?.(data) })
  }
  // Push many logs in one act() to avoid 2001 separate React render flushes
  const pushMany = (entries: Array<{ level: string; msg: string }>) => {
    act(() => { for (const e of entries) capturedCb?.(e) })
  }
  return { subscribeLogs: fn, push, pushMany, getCb: () => capturedCb }
}

function renderPage(subscribeLogs: ReturnType<typeof vi.fn>) {
  return render(
    <WsContext.Provider value={{ subscribeLogs, subscribeFileChange: vi.fn(), wsRef: { current: null } as any }}>
      <LogsPage />
    </WsContext.Provider>,
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('LogsPage — initial render', () => {
  it('renders the page header', () => {
    const { subscribeLogs } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    expect(screen.getByTestId('page-header')).toHaveTextContent('Logs')
  })

  it('shows waiting message when no logs have arrived', () => {
    const { subscribeLogs } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    expect(screen.getByText(/Waiting for log events/i)).toBeInTheDocument()
  })

  it('shows 0/0 counter initially', () => {
    const { subscribeLogs } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    expect(screen.getByText('0 / 0')).toBeInTheDocument()
  })
})

describe('LogsPage — subscribeLogs lifecycle', () => {
  it('calls subscribeLogs with a callback on mount', () => {
    const { subscribeLogs } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    expect(subscribeLogs).toHaveBeenCalledTimes(1)
    expect(typeof subscribeLogs.mock.calls[0][0]).toBe('function')
  })

  it('calls subscribeLogs(null) on unmount', () => {
    const { subscribeLogs } = makeSubscribeLogs()
    const { unmount } = renderPage(subscribeLogs)
    unmount()
    const lastArg = subscribeLogs.mock.calls[subscribeLogs.mock.calls.length - 1][0]
    expect(lastArg).toBeNull()
  })
})

describe('LogsPage — log entry display', () => {
  it('shows a log entry after it arrives', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'hello world' })
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('shows multiple log entries', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'first message' })
    push({ level: 'warn', msg: 'second message' })
    expect(screen.getByText('first message')).toBeInTheDocument()
    expect(screen.getByText('second message')).toBeInTheDocument()
  })

  it('shows "No logs match filter" when logs exist but all are filtered out', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'some log' })
    // Set level filter to error — no error logs exist
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'error' } })
    expect(screen.getByText(/No logs match filter/i)).toBeInTheDocument()
  })

  it('updates the counter to show filtered/total', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'one' })
    push({ level: 'info', msg: 'two' })
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })
})

describe('LogsPage — LEVEL_COLORS badge variants', () => {
  const cases: [string, string][] = [
    ['debug', 'aim'],
    ['info', 'ok'],
    ['warn', 'warn'],
    ['warning', 'warn'],
    ['error', 'err'],
  ]

  for (const [level, expectedVariant] of cases) {
    it(`level '${level}' maps to Badge variant '${expectedVariant}'`, () => {
      const { subscribeLogs, push } = makeSubscribeLogs()
      renderPage(subscribeLogs)
      push({ level, msg: `test-${level}` })
      const badges = screen.getAllByTestId('badge')
      const badge = badges.find(b => b.textContent === level.toUpperCase())
      expect(badge).toBeDefined()
      expect(badge!.dataset.variant).toBe(expectedVariant)
    })
  }

  it("unknown level falls back to Badge variant 'aim'", () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'verbose', msg: 'fallback test' })
    const badges = screen.getAllByTestId('badge')
    const badge = badges.find(b => b.textContent === 'VERBOSE')
    expect(badge).toBeDefined()
    expect(badge!.dataset.variant).toBe('aim')
  })
})

describe('LogsPage — level filter', () => {
  it("'all' level shows logs of every level", () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'debug', msg: 'debug-msg' })
    push({ level: 'error', msg: 'error-msg' })
    // Default is 'all'
    expect(screen.getByText('debug-msg')).toBeInTheDocument()
    expect(screen.getByText('error-msg')).toBeInTheDocument()
  })

  it('specific level filter hides logs of other levels', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'info-msg' })
    push({ level: 'warn', msg: 'warn-msg' })
    push({ level: 'error', msg: 'error-msg' })
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'info' } })
    expect(screen.getByText('info-msg')).toBeInTheDocument()
    expect(screen.queryByText('warn-msg')).not.toBeInTheDocument()
    expect(screen.queryByText('error-msg')).not.toBeInTheDocument()
  })

  it('switching level filter back to all restores all logs', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'info-msg' })
    push({ level: 'warn', msg: 'warn-msg' })
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'info' } })
    expect(screen.queryByText('warn-msg')).not.toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'all' } })
    expect(screen.getByText('warn-msg')).toBeInTheDocument()
  })

  it('filtered counter reflects level filter', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'a' })
    push({ level: 'info', msg: 'b' })
    push({ level: 'error', msg: 'c' })
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'info' } })
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
  })
})

describe('LogsPage — text search filter', () => {
  it('filters logs by message substring (case-insensitive)', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'Database connection opened' })
    push({ level: 'info', msg: 'Request received' })
    const input = screen.getByTestId('search-input')
    fireEvent.change(input, { target: { value: 'database' } })
    expect(screen.getByText('Database connection opened')).toBeInTheDocument()
    expect(screen.queryByText('Request received')).not.toBeInTheDocument()
  })

  it('search is case-insensitive (uppercase query matches lowercase msg)', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'connection pool ready' })
    const input = screen.getByTestId('search-input')
    fireEvent.change(input, { target: { value: 'CONNECTION' } })
    expect(screen.getByText('connection pool ready')).toBeInTheDocument()
  })

  it('empty search shows all logs', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'alpha' })
    push({ level: 'warn', msg: 'beta' })
    const input = screen.getByTestId('search-input')
    fireEvent.change(input, { target: { value: 'alpha' } })
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
  })

  it('level filter and text search combine (AND logic)', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'db started' })
    push({ level: 'warn', msg: 'db warning' })
    push({ level: 'info', msg: 'request ok' })
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'info' } })
    const input = screen.getByTestId('search-input')
    fireEvent.change(input, { target: { value: 'db' } })
    expect(screen.getByText('db started')).toBeInTheDocument()
    expect(screen.queryByText('db warning')).not.toBeInTheDocument()
    expect(screen.queryByText('request ok')).not.toBeInTheDocument()
  })
})

describe('LogsPage — MAX_LOGS cap', () => {
  it('keeps only the last 2000 entries when more arrive', () => {
    const { subscribeLogs, pushMany } = makeSubscribeLogs()
    renderPage(subscribeLogs)

    // Push 2001 logs in a single act() to avoid 2001 separate React flushes
    const entries = Array.from({ length: 2001 }, (_, i) => ({ level: 'info', msg: `log-${i}` }))
    pushMany(entries)

    // Total shown should be capped at 2000
    expect(screen.getByText('2000 / 2000')).toBeInTheDocument()
    // First entry (log-0) should be gone; last entry (log-2000) should be present
    expect(screen.queryByText('log-0')).not.toBeInTheDocument()
    expect(screen.getByText('log-2000')).toBeInTheDocument()
  })

  it('exactly 2000 entries are kept without truncation', () => {
    const { subscribeLogs, pushMany } = makeSubscribeLogs()
    renderPage(subscribeLogs)

    const entries = Array.from({ length: 2000 }, (_, i) => ({ level: 'info', msg: `log-${i}` }))
    pushMany(entries)

    expect(screen.getByText('2000 / 2000')).toBeInTheDocument()
    expect(screen.getByText('log-0')).toBeInTheDocument()
    expect(screen.getByText('log-1999')).toBeInTheDocument()
  })
})

describe('LogsPage — pause state', () => {
  // Helper: find the toggle div inside the label that contains the Live/Paused span
  function getPauseToggle() {
    const span = screen.getByText(/^(Live|Paused)$/)
    return span.closest('label')!.querySelector('div')! as HTMLElement
  }

  it('discards incoming logs while paused', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'before pause' })

    fireEvent.click(getPauseToggle())

    push({ level: 'info', msg: 'during pause' })
    expect(screen.getByText('before pause')).toBeInTheDocument()
    expect(screen.queryByText('during pause')).not.toBeInTheDocument()
  })

  it('paused label changes to "Paused" when toggled', () => {
    const { subscribeLogs } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    expect(screen.getByText('Live')).toBeInTheDocument()

    fireEvent.click(getPauseToggle())
    expect(screen.getByText('Paused')).toBeInTheDocument()
  })

  it('resumes receiving logs after unpausing', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)

    // Pause
    fireEvent.click(getPauseToggle())
    push({ level: 'info', msg: 'skipped while paused' })
    expect(screen.queryByText('skipped while paused')).not.toBeInTheDocument()

    // Unpause
    fireEvent.click(getPauseToggle())
    push({ level: 'info', msg: 'after unpause' })
    expect(screen.getByText('after unpause')).toBeInTheDocument()
  })
})

describe('LogsPage — clear button', () => {
  it('clears all logs when Clear is clicked', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'message to clear' })
    expect(screen.getByText('message to clear')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(screen.queryByText('message to clear')).not.toBeInTheDocument()
    expect(screen.getByText(/Waiting for log events/i)).toBeInTheDocument()
  })

  it('counter resets to 0/0 after clear', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'a' })
    push({ level: 'info', msg: 'b' })
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(screen.getByText('0 / 0')).toBeInTheDocument()
  })

  it('new logs arrive normally after clear', () => {
    const { subscribeLogs, push } = makeSubscribeLogs()
    renderPage(subscribeLogs)
    push({ level: 'info', msg: 'before clear' })
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    push({ level: 'info', msg: 'after clear' })
    expect(screen.queryByText('before clear')).not.toBeInTheDocument()
    expect(screen.getByText('after clear')).toBeInTheDocument()
  })
})
