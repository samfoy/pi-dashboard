import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AssistantMessage from '../pages/chat/AssistantMessage'

// Mock MarkdownRenderer to avoid complex markdown parsing in tests
vi.mock('../components/MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}))

describe('AssistantMessage', () => {
  it('renders markdown content', () => {
    render(<AssistantMessage content="Hello world" isStreaming={false} slotRunning={false} onOption={() => {}} />)
    expect(screen.getByTestId('md')).toHaveTextContent('Hello world')
  })

  it('adds streaming cursor class when streaming', () => {
    const { container } = render(<AssistantMessage content="typing…" isStreaming={true} slotRunning={true} onOption={() => {}} />)
    expect(container.querySelector('.streaming-cursor')).toBeInTheDocument()
  })

  it('parses and renders option buttons', () => {
    render(<AssistantMessage content="Pick one [OPTIONS: Yes|No|Maybe]" isStreaming={false} slotRunning={false} onOption={() => {}} />)
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
    expect(screen.getByText('Maybe')).toBeInTheDocument()
  })

  it('hides options while streaming', () => {
    render(<AssistantMessage content="Pick [OPTIONS: A|B]" isStreaming={true} slotRunning={true} onOption={() => {}} />)
    expect(screen.queryByText('A')).not.toBeInTheDocument()
  })

  it('calls onOption when clicking an option', () => {
    const onOption = vi.fn()
    render(<AssistantMessage content="Choose [OPTIONS: Alpha|Beta]" isStreaming={false} slotRunning={false} onOption={onOption} />)
    fireEvent.click(screen.getByText('Alpha'))
    // Multi-select: clicking shows Send button, need to click Send to fire onOption
    fireEvent.click(screen.getByText(/Send/))
    expect(onOption).toHaveBeenCalledWith('Alpha')
  })

  it('disables other options after submitting', () => {
    render(<AssistantMessage content="Choose [OPTIONS: A|B|C]" isStreaming={false} slotRunning={false} onOption={() => {}} />)
    fireEvent.click(screen.getByText('A'))
    fireEvent.click(screen.getByText(/Send/))
    expect(screen.getByText('B')).toBeDisabled()
    expect(screen.getByText('C')).toBeDisabled()
  })

  it('allows selecting multiple options before submitting', () => {
    const onOption = vi.fn()
    render(<AssistantMessage content="Pick [OPTIONS: X|Y|Z]" isStreaming={false} slotRunning={false} onOption={onOption} />)
    fireEvent.click(screen.getByText('X'))
    fireEvent.click(screen.getByText('Z'))
    fireEvent.click(screen.getByText(/Send \(2\)/))
    expect(onOption).toHaveBeenCalledWith('X, Z')
  })

  it('toggles option off when clicked again', () => {
    render(<AssistantMessage content="Pick [OPTIONS: A|B]" isStreaming={false} slotRunning={false} onOption={() => {}} />)
    fireEvent.click(screen.getByText('A'))
    expect(screen.getByText(/Send/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('A'))
    expect(screen.queryByText(/Send/)).not.toBeInTheDocument()
  })

  it('shows "Use as Plan" button for valid plan JSON', () => {
    const planContent = '<!-- plan_task_id:test-123 -->\nHere is the plan:\n```json\n[{"title":"Step 1","description":"Do thing"}]\n```'
    render(<AssistantMessage content={planContent} isStreaming={false} slotRunning={false} onOption={() => {}} planTaskId="test-123" onApplyPlan={() => {}} />)
    expect(screen.getByText(/Use as Plan/)).toBeInTheDocument()
  })

  it('does not show plan button while streaming', () => {
    const planContent = '```json\n[{"title":"Step 1","description":"Do thing"}]\n```'
    render(<AssistantMessage content={planContent} isStreaming={true} slotRunning={true} onOption={() => {}} planTaskId="test-123" onApplyPlan={() => {}} />)
    expect(screen.queryByText(/Use as Plan/)).not.toBeInTheDocument()
  })
})
