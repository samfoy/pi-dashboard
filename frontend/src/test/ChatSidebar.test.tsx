import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, createTestStore } from './helpers'
import ChatSidebar from '../pages/ChatSidebar'

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock child components that are complex
vi.mock('../components/InfoTip', () => ({ default: () => null }))
vi.mock('../components/TypewriterText', () => ({
  default: ({ text, className }: { text: string; className?: string }) => <span className={className}>{text}</span>,
}))

// Mock the chat submodule export
vi.mock('../pages/chat', () => ({
  NotificationItem: ({ n, onOpen, onDelete }: any) => (
    <div data-testid={`notification-${n.ts}`}>{n.title}</div>
  ),
}))

vi.mock('../api/client', () => ({
  api: {
    clearSessions: vi.fn(),
    sessions: vi.fn(),
    chatSlots: vi.fn(),
    chatSlotDetail: vi.fn(),
    chatMode: vi.fn(),
    deleteChatSlot: vi.fn(),
    createChatSlot: vi.fn(),
    resumeChatSlot: vi.fn(),
    deleteSession: vi.fn(),
  },
}))

const baseProps = {
  slots: [
    { key: 'slot-1', title: 'Fix the bug', running: false },
    { key: 'slot-2', title: 'Write tests', running: true },
    { key: 'slot-3', title: 'Deploy', running: false, stopping: true },
  ],
  activeSlot: 'slot-1',
  unreadSlots: ['slot-2'],
  notifications: [] as any[],
  history: [] as any[],
  historyHasMore: false,
  viewingNotification: null,
  onViewNotification: vi.fn(),
}

describe('ChatSidebar', () => {
  it('renders slot list', () => {
    renderWithProviders(<ChatSidebar {...baseProps} />)

    expect(screen.getByText('Fix the bug')).toBeInTheDocument()
    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(screen.getByText('Deploy')).toBeInTheDocument()
  })

  it('renders Sessions header', () => {
    renderWithProviders(<ChatSidebar {...baseProps} />)
    expect(screen.getByText('Sessions')).toBeInTheDocument()
  })

  it('renders new chat button', () => {
    renderWithProviders(<ChatSidebar {...baseProps} />)
    expect(screen.getByLabelText('New chat session')).toBeInTheDocument()
  })

  it('renders notifications section', () => {
    renderWithProviders(<ChatSidebar {...baseProps} />)
    expect(screen.getByText('Notifications')).toBeInTheDocument()
  })

  it('renders History section', () => {
    renderWithProviders(<ChatSidebar {...baseProps} />)
    expect(screen.getByText(/History/)).toBeInTheDocument()
  })

  it('shows notification badge when there are unacked notifications', () => {
    const props = {
      ...baseProps,
      notifications: [
        { kind: 'info', title: 'Task done', body: 'Details', ts: '1', acked: false },
        { kind: 'info', title: 'Another', body: '', ts: '2', acked: true },
      ],
    }
    renderWithProviders(<ChatSidebar {...props} />)
    // Unacked count badge should show "1"
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('renders filter input', () => {
    renderWithProviders(<ChatSidebar {...baseProps} />)
    expect(screen.getByPlaceholderText('Filter sessions…')).toBeInTheDocument()
  })

  it('renders notification filter input', () => {
    renderWithProviders(<ChatSidebar {...baseProps} />)
    expect(screen.getByPlaceholderText('Filter notifications…')).toBeInTheDocument()
  })

  it('renders pending approval badge', () => {
    const props = {
      ...baseProps,
      slots: [
        { key: 'slot-1', title: 'Needs approval', running: true, pending_approval: true },
      ],
    }
    renderWithProviders(<ChatSidebar {...props} />)
    expect(screen.getByTitle('Waiting for approval')).toBeInTheDocument()
  })

  it('renders stopping indicator', () => {
    const props = {
      ...baseProps,
      slots: [
        { key: 'slot-3', title: 'Stopping slot', running: false, stopping: true },
      ],
      activeSlot: null,
    }
    renderWithProviders(<ChatSidebar {...props} />)
    expect(screen.getByTitle('Stopping')).toBeInTheDocument()
  })

  it('groups slots by project when cwd differs', () => {
    const props = {
      ...baseProps,
      slots: [
        { key: 'slot-1', title: 'Fix the bug', running: false, cwd: '/home/user/project-a' },
        { key: 'slot-2', title: 'Write tests', running: false, cwd: '/home/user/project-b' },
      ],
    }
    renderWithProviders(<ChatSidebar {...props} />)
    expect(screen.getByText('project-a')).toBeInTheDocument()
    expect(screen.getByText('project-b')).toBeInTheDocument()
  })
})
