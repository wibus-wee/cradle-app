import type { ReactNode } from 'react'
import * as React from 'react'
import { Component } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  maxRetries?: number
}

interface State {
  error: Error | null
  retryCount: number
}

export class StreamErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retryCount: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(_error: Error) {
    const maxRetries = this.props.maxRetries ?? 3
    if (this.state.retryCount < maxRetries) {
      // Auto-retry after brief delay
      setTimeout(() => {
        this.setState(prev => ({ error: null, retryCount: prev.retryCount + 1 }))
      }, 100 * (this.state.retryCount + 1))
    }
  }

  render() {
    if (this.state.error) {
      const maxRetries = this.props.maxRetries ?? 3
      if (this.state.retryCount >= maxRetries) {
        return this.props.fallback ?? <div data-streamdown-error>{this.state.error.message}</div>
      }
      return null // briefly blank during retry
    }
    return this.props.children
  }
}
