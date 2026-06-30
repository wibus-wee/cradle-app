import type { ReactNode } from 'react'
import * as React from 'react'
import { Component } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  maxRetries?: number
  /** External error notification callback */
  onError?: (error: Error, retryCount: number) => void
}

interface State {
  error: Error | null
  retryCount: number
}

/**
 * Enhanced error boundary with:
 * - 3x auto-retry with exponential backoff
 * - onError callback for telemetry/external reporting
 * - Customizable fallback
 */
export class StreamingErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retryCount: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error) {
    const maxRetries = this.props.maxRetries ?? 3
    this.props.onError?.(error, this.state.retryCount)

    if (this.state.retryCount < maxRetries) {
      const delay = 100 * 2 ** this.state.retryCount
      setTimeout(() => {
        this.setState(prev => ({ error: null, retryCount: prev.retryCount + 1 }))
      }, delay)
    }
  }

  render() {
    if (this.state.error) {
      const maxRetries = this.props.maxRetries ?? 3
      if (this.state.retryCount >= maxRetries) {
        return this.props.fallback ?? (
          <div data-streamdown-error role="alert">
            <span>
Render error:
{this.state.error.message}
            </span>
          </div>
        )
      }
      return null
    }
    return this.props.children
  }
}
