import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, act } from '@testing-library/react'
import { renderWithProviders, createTestStore } from './helpers'
import ConnectionOverlay from '../components/ConnectionOverlay'

const connectedState = {
  dashboard: {
    status: null,
    connected: true,
    slots: [],
    approvalMode: 'normal',
    refreshTrigger: 0,
    unreadSlots: [],
  },
} as any

const disconnectedState = {
  dashboard: {
    status: null,
    connected: false,
    slots: [],
    approvalMode: 'normal',
    refreshTrigger: 0,
    unreadSlots: [],
  },
} as any

describe('ConnectionOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when connected', () => {
    const { container } = renderWithProviders(<ConnectionOverlay />, {
      store: createTestStore(connectedState),
    })
    expect(container.querySelector('.fixed')).toBeNull()
  })

  it('shows reconnecting state when disconnected', () => {
    renderWithProviders(<ConnectionOverlay />, {
      store: createTestStore(disconnectedState),
    })
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument()
  })

  it('shows elapsed seconds while reconnecting', () => {
    renderWithProviders(<ConnectionOverlay />, {
      store: createTestStore(disconnectedState),
    })

    act(() => { vi.advanceTimersByTime(3000) })
    // Should show ~3s elapsed
    expect(screen.getByText(/3s/)).toBeInTheDocument()
  })

  it('transitions to disconnected state after 15 seconds', () => {
    renderWithProviders(<ConnectionOverlay />, {
      store: createTestStore(disconnectedState),
    })

    expect(screen.getByText('Reconnecting…')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(16_000) })

    expect(screen.getByText('Connection Lost')).toBeInTheDocument()
  })

  it('shows troubleshooting steps in disconnected state', () => {
    renderWithProviders(<ConnectionOverlay />, {
      store: createTestStore(disconnectedState),
    })

    act(() => { vi.advanceTimersByTime(16_000) })

    expect(screen.getByText('🔑 Check SSH access')).toBeInTheDocument()
    expect(screen.getByText('🔗 Restart SSH tunnel')).toBeInTheDocument()
    expect(screen.getByText('🥧 Restart dashboard')).toBeInTheDocument()
  })

  it('shows Retry Now and Copy fix buttons', () => {
    renderWithProviders(<ConnectionOverlay />, {
      store: createTestStore(disconnectedState),
    })

    act(() => { vi.advanceTimersByTime(16_000) })

    expect(screen.getByText('🔄 Retry Now')).toBeInTheDocument()
    expect(screen.getByText('📋 Copy fix')).toBeInTheDocument()
  })

  it('shows auto-retrying indicator', () => {
    renderWithProviders(<ConnectionOverlay />, {
      store: createTestStore(disconnectedState),
    })

    act(() => { vi.advanceTimersByTime(16_000) })

    expect(screen.getByText('Auto-retrying in background')).toBeInTheDocument()
  })
})
