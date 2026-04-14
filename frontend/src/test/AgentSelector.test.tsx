import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AgentSelector from '../components/AgentSelector'

const agents = [
  { name: 'custom-agent', source: 'aim' },
  { name: 'another', source: 'built-in' },
  { name: 'meshclaw-lite', source: 'meshclaw' },
]

describe('AgentSelector', () => {
  it('renders current agent name', () => {
    render(<AgentSelector agents={agents} value="" onChange={() => {}} />)
    expect(screen.getByText('pi')).toBeInTheDocument()
  })

  it('shows dropdown on click', () => {
    render(<AgentSelector agents={agents} value="" onChange={() => {}} />)
    fireEvent.click(screen.getByLabelText('Switch agent'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('excludes agents in exclude list', () => {
    render(<AgentSelector agents={agents} value="" onChange={() => {}} exclude={['meshclaw-lite']} />)
    fireEvent.click(screen.getByLabelText('Switch agent'))
    expect(screen.queryByText('meshclaw-lite')).not.toBeInTheDocument()
    expect(screen.getByText('custom-agent')).toBeInTheDocument()
  })

  it('calls onChange when selecting an agent', () => {
    const onChange = vi.fn()
    render(<AgentSelector agents={agents} value="" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Switch agent'))
    fireEvent.click(screen.getByText('custom-agent'))
    expect(onChange).toHaveBeenCalledWith('custom-agent')
  })

  it('calls onChange with empty string for pi', () => {
    const onChange = vi.fn()
    render(<AgentSelector agents={agents} value="custom-agent" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Switch agent'))
    fireEvent.click(screen.getAllByText('pi')[0])
    expect(onChange).toHaveBeenCalledWith('')
  })
})
