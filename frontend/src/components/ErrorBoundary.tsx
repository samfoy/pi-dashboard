import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render errors in child components and shows a recovery UI
 * instead of white-screening the entire app.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
          <div className="text-4xl">💥</div>
          <h2 className="text-lg font-semibold text-text">Something went wrong</h2>
          <pre className="max-w-lg text-[13px] text-danger bg-card border border-border rounded-lg p-4 overflow-auto whitespace-pre-wrap break-words">
            {this.state.error.message}
          </pre>
          <button
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white border-none cursor-pointer hover:bg-accent-hover transition-colors"
            onClick={() => this.setState({ error: null })}
          >
            Try Again
          </button>
          <button
            className="px-4 py-2 rounded-lg text-sm font-medium bg-card border border-border text-muted cursor-pointer hover:text-text hover:border-border-strong transition-all"
            onClick={() => window.location.reload()}
          >
            Reload Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
