import type { Disposable } from '@cradle/plugin-sdk'
import type { UiActivityEvent, UiActivityHandler, UiActivitySegment } from '@cradle/plugin-sdk/web'

import { dispatchUiActivityToHandlers, UiActivityEngine } from './activity-engine'
import type { ResolvedUiActivityEntity } from './types'

type HostHandler = {
  owner: string
  handler: UiActivityHandler
}

/**
 * Process-wide UI activity bus: one engine, many sinks (analytics, Jarvis, plugins).
 */
class UiActivityBus {
  private engine: UiActivityEngine | null = null
  private readonly hostHandlers = new Map<symbol, HostHandler>()
  private readonly pluginHandlers = new Map<symbol, HostHandler>()

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

  listSubscriberOwners(): { host: string[], plugin: string[] } {
    return {
      host: Array.from(this.hostHandlers.values(), handler => handler.owner),
      plugin: Array.from(this.pluginHandlers.values(), handler => handler.owner),
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

  /** Plugin subscriptions — isolated fan-out. */
  subscribePlugin(owner: string, handler: UiActivityHandler): Disposable {
    const key = Symbol(owner)
    this.pluginHandlers.set(key, { owner, handler })
    return {
      dispose: () => {
        this.pluginHandlers.delete(key)
      },
    }
  }

  private dispatch(activity: UiActivityEvent): void {
    const logError = (owner: string, error: unknown) => {
      console.error('[ui-activity] handler failed', { owner, error })
    }
    dispatchUiActivityToHandlers(this.hostHandlers.values(), activity, logError)
    dispatchUiActivityToHandlers(this.pluginHandlers.values(), activity, logError)
  }
}

export const uiActivityBus = new UiActivityBus()
