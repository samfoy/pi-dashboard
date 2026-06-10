import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WelcomeView from '../components/WelcomeView'

// SlashCommandMenu requires a ref and can cause issues in tests — mock it
vi.mock('../components/SlashCommandMenu', () => ({
  default: () => null,
}))

const defaultProps = {
  input: '',
  setInput: vi.fn(),
  send: vi.fn(),
  models: [
    { id: 'claude-3', name: 'Claude 3', provider: 'anthropic', contextWindow: 200000 },
    { id: 'gpt-4', name: 'GPT-4', provider: 'openai', contextWindow: 128000 },
  ],
  selectedModel: '',
  onSelectModel: vi.fn(),
  workspaces: [{ name: 'default', path: '/home' }],
  selectedCwd: '',
  onSelectCwd: vi.fn(),
  pendingImages: [],
  onPaste: vi.fn(),
  onRemoveImage: vi.fn(),
}

describe('WelcomeView', () => {
  it('renders welcome prompt', () => {
    render(<WelcomeView {...defaultProps} />)
    expect(screen.getByText('What can I help you with?')).toBeInTheDocument()
  })

  it('renders message input', () => {
    render(<WelcomeView {...defaultProps} />)
    expect(screen.getByLabelText('Message input')).toBeInTheDocument()
  })

  it('disables send button when input is empty', () => {
    render(<WelcomeView {...defaultProps} />)
    expect(screen.getByRole('button', { name: '↑' })).toBeDisabled()
  })

  it('enables send button when input has text', () => {
    render(<WelcomeView {...defaultProps} input="hello" />)
    expect(screen.getByRole('button', { name: '↑' })).not.toBeDisabled()
  })

  it('calls send on button click', () => {
    const send = vi.fn()
    render(<WelcomeView {...defaultProps} input="test" send={send} />)
    fireEvent.click(screen.getByRole('button', { name: '↑' }))
    expect(send).toHaveBeenCalledOnce()
  })

  it('calls send on Enter key', () => {
    const send = vi.fn()
    render(<WelcomeView {...defaultProps} input="test" send={send} />)
    fireEvent.keyDown(screen.getByLabelText('Message input'), { key: 'Enter' })
    expect(send).toHaveBeenCalledOnce()
  })

  it('does not call send on Shift+Enter', () => {
    const send = vi.fn()
    render(<WelcomeView {...defaultProps} input="test" send={send} />)
    fireEvent.keyDown(screen.getByLabelText('Message input'), { key: 'Enter', shiftKey: true })
    expect(send).not.toHaveBeenCalled()
  })

  it('shows prefill hint when enabled', () => {
    render(<WelcomeView {...defaultProps} prefillHint />)
    expect(screen.getByText(/Plan pre-filled/)).toBeInTheDocument()
  })

  it('calls onDismissHint when closing hint', () => {
    const onDismiss = vi.fn()
    render(<WelcomeView {...defaultProps} prefillHint onDismissHint={onDismiss} />)
    fireEvent.click(screen.getByText('✕'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('renders model picker when config is expanded', () => {
    render(<WelcomeView {...defaultProps} />)
    fireEvent.click(screen.getByTitle('Model & workspace'))
    expect(screen.getByText('Model')).toBeInTheDocument()
  })

  it('renders directory picker when config is expanded', () => {
    render(<WelcomeView {...defaultProps} />)
    fireEvent.click(screen.getByTitle('Model & workspace'))
    expect(screen.getByText('Directory')).toBeInTheDocument()
  })
})
