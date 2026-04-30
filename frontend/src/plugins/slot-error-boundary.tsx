/**
 * Per-claim error boundary.
 * Wraps each slot contribution individually so one failing plugin
 * does not suppress sibling contributions in the same slot.
 */
import { Component, type ReactNode } from 'react'

interface Props {
  pluginId: string
  slotId: string
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class SlotErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error(
      `[slot-error-boundary] Plugin "${this.props.pluginId}" slot "${this.props.slotId}" threw:`,
      error,
    )
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}
