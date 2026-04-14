import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './helpers'
import App from '../App'

// Mock all page components to isolate routing
vi.mock('../pages/ChatPage', () => ({ default: () => <div data-testid="chat-page">ChatPage</div> }))
vi.mock('../pages/SystemPage', () => ({ default: () => <div data-testid="system-page">SystemPage</div> }))
vi.mock('../hooks/useWebSocket', () => ({ useWebSocket: () => ({ subscribeLogs: () => {} }) }))
vi.mock('../components/MarkdownRenderer', () => ({ default: ({ content }: { content: string }) => <span>{content}</span> }))
vi.mock('../api/client', () => ({
  api: {
    chatSlots: vi.fn().mockResolvedValue([]),
    notifications: vi.fn().mockResolvedValue({ notifications: [] }),
    status: vi.fn().mockResolvedValue({ uptime: '1h', sessions: 0, messages: 0, cron_jobs: 0, subagents: 0, lessons: 0 }),
  },
}))

// Mock matchMedia for useTheme (jsdom doesn't provide it)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
})

describe('App routing', () => {
  it('renders chat page at /chat', () => {
    renderWithProviders(<App />, { route: '/chat' })
    expect(screen.getByTestId('chat-page')).toBeInTheDocument()
  })

  it('renders system page at /system', () => {
    renderWithProviders(<App />, { route: '/system' })
    expect(screen.getByTestId('system-page')).toBeInTheDocument()
  })

  it('redirects unknown routes to /chat', () => {
    renderWithProviders(<App />, { route: '/nonexistent' })
    expect(screen.getByTestId('chat-page')).toBeInTheDocument()
  })

  it('renders nav items', () => {
    renderWithProviders(<App />, { route: '/chat' })
    expect(screen.getByText('Chat')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
  })

  it('renders PI DASH branding', () => {
    renderWithProviders(<App />, { route: '/chat' })
    expect(screen.getByText('PI DASH')).toBeInTheDocument()
  })

  it('renders health indicator', () => {
    renderWithProviders(<App />, { route: '/chat' })
    expect(screen.getByText('Health')).toBeInTheDocument()
  })

  it('renders theme toggle', () => {
    renderWithProviders(<App />, { route: '/chat' })
    // Default preference is 'system', button shows "Auto"
    expect(screen.getByText(/Auto|Light|Dark/)).toBeInTheDocument()
  })
})
