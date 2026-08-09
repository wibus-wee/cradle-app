import type { Disposable } from '@cradle/plugin-sdk'

import { dispatchUiActivityToHandlers, UiActivityEngine } from './activity-engine'
import type {
  ResolvedUiActivityEntity,
  UiActivityEvent,
  UiActivityHandler,
  UiActivitySegment,
} from './types'

type HostHandler = {
  owner: string
  handler: UiActivityHandler
}

/**
 * Process-wide UI activity bus for Cradle-owned renderer sinks.
 */
class UiActivityBus {
  private engine: UiActivityEngine | null = null
  private readonly hostHandlers = new Map<symbol, HostHandler>()

  start(options: {
    idleTimeoutMs?: number
    now?: () => number
    isVisible?: () => boolean
  } = {}): void {
    this.stop()
    this.engine = new UiActivityEngine({
      ...options,
      onDispatch: event => this.dispatch(event),
    })
  }

  stop(): void {
    this.engine?.dispose()
    this.engine = null
  }

  setResolvedEntity(entity: ResolvedUiActivityEntity | null): void {
    this.engine?.setResolvedEntity(entity)
  }

  setVisibility(visible: boolean): void {
    this.engine?.setVisibility(visible)
  }

  getCurrentSegment(): UiActivitySegment | null {
    return this.engine?.getCurrentSegment() ?? null
  }

  listSubscriberOwners(): { host: string[] } {
    return {
      host: Array.from(this.hostHandlers.values(), handler => handler.owner),
    }
  }

  /** Built-in sinks (analytics, Jarvis) — always registered while bus is live. */
  subscribeHost(owner: string, handler: UiActivityHandler): Disposable {
    const key = Symbol(owner)
    this.hostHandlers.set(key, { owner, handler })
    return {
      dispose: () => {
        this.hostHandlers.delete(key)
      },
    }
  }

  private dispatch(activity: UiActivityEvent): void {
    const logError = (owner: string, error: unknown) => {
      console.error('[ui-activity] handler failed', { owner, error })
    }
    dispatchUiActivityToHandlers(this.hostHandlers.values(), activity, logError)
  }
}

export const uiActivityBus = new UiActivityBus()
