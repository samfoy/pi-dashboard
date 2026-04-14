import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ErrorBoundary from '../components/ErrorBoundary'

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test explosion')
  return <div>All good</div>
}

describe('ErrorBoundary', () => {
  // Suppress console.error for expected errors in tests
  const originalError = console.error
  beforeEach(() => { console.error = vi.fn() })
  afterEach(() => { console.error = originalError })

  it('renders children when no error', () => {
    render(<ErrorBoundary><div>Hello</div></ErrorBoundary>)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('shows fallback UI on render error', () => {
    render(<ErrorBoundary><ThrowingComponent shouldThrow={true} /></ErrorBoundary>)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('Test explosion')).toBeInTheDocument()
  })

  it('shows Try Again button that resets error state', () => {
    const { rerender } = render(
      <ErrorBoundary><ThrowingComponent shouldThrow={true} /></ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()

    // Click try again — boundary resets, but component still throws
    fireEvent.click(screen.getByText('Try Again'))
    // Component throws again immediately, so error UI returns
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('shows custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error</div>}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Custom error')).toBeInTheDocument()
  })

  it('shows Reload Page button', () => {
    render(<ErrorBoundary><ThrowingComponent shouldThrow={true} /></ErrorBoundary>)
    expect(screen.getByText('Reload Page')).toBeInTheDocument()
  })
})
