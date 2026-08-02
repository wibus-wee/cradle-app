import type {
  ResolvedUiActivityEntity,
  UiActivityEndReason,
  UiActivityEvent,
  UiActivityHandler,
  UiActivitySegment,
} from './types'
import { IDLE_TIMEOUT_MS } from './types'

export interface ActivityEngineOptions {
  idleTimeoutMs?: number
  now?: () => number
  isVisible?: () => boolean
  onDispatch?: (event: UiActivityEvent) => void
}

interface ActiveSegment extends UiActivitySegment {}

/**
 * Owns segment start/end for entity switch, idle (+ idle resume), and hidden.
 * Dispatches events in host order; callers own fan-out isolation.
 */
export class UiActivityEngine {
  private readonly idleTimeoutMs: number
  private readonly now: () => number
  private readonly isVisible: () => boolean
  private readonly onDispatch: (event: UiActivityEvent) => void

  private current: ActiveSegment | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(options: ActivityEngineOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS
    this.now = options.now ?? (() => Date.now())
    this.isVisible = options.isVisible ?? (() =>
      typeof document === 'undefined' ? true : document.visibilityState === 'visible')
    this.onDispatch = options.onDispatch ?? (() => {})
  }

  getCurrentSegment(): UiActivitySegment | null {
    if (!this.current) {
      return null
    }
    return { ...this.current }
  }

  /**
   * Apply a newly resolved entity (or null when nothing is resolvable).
   * Call on each tick / source change.
   */
  setResolvedEntity(next: ResolvedUiActivityEntity | null): void {
    if (this.disposed) {
      return
    }

    if (!this.isVisible()) {
      this.endCurrent('hidden')
      return
    }

    if (!next) {
      this.endCurrent('entity-changed')
      return
    }

    if (this.current && this.current.entity === next.entity) {
      // Same entity — do not reset idle; timeout is measured from segment start.
      return
    }

    const previousEntity = this.current?.entity ?? null
    const previousEntityType = this.current?.entityType ?? null
    this.endCurrent('entity-changed')
    this.startSegment(next, previousEntity, previousEntityType)
  }

  /** Document became hidden or visible. */
  setVisibility(visible: boolean): void {
    if (this.disposed) {
      return
    }
    if (!visible) {
      this.endCurrent('hidden')
    }
    // Visible again: caller should re-resolve and call setResolvedEntity.
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.endCurrent('hidden')
    this.disposed = true
    this.clearIdleTimer()
    this.current = null
  }

  private startSegment(
    entity: ResolvedUiActivityEntity,
    previousEntity: string | null,
    previousEntityType: UiActivitySegment['entityType'] | null,
  ): void {
    const occurredAt = this.now()
    this.current = {
      entity: entity.entity,
      entityType: entity.entityType,
      startedAt: occurredAt,
    }
    this.dispatch({
      kind: 'ui.segment.started',
      occurredAt,
      entity: entity.entity,
      entityType: entity.entityType,
      previousEntity,
      previousEntityType,
    })
    this.armIdleTimer()
  }

  private endCurrent(endReason: UiActivityEndReason): void {
    if (!this.current) {
      this.clearIdleTimer()
      return
    }
    const ended = this.current
    const occurredAt = this.now()
    this.current = null
    this.clearIdleTimer()
    this.dispatch({
      kind: 'ui.segment.ended',
      occurredAt,
      entity: ended.entity,
      entityType: ended.entityType,
      durationMs: Math.max(0, occurredAt - ended.startedAt),
      endReason,
    })

    if (endReason === 'idle' && this.isVisible()) {
      this.startSegment(
        { entity: ended.entity, entityType: ended.entityType },
        null,
        null,
      )
    }
  }

  private armIdleTimer(): void {
    this.clearIdleTimer()
    if (!this.current || this.disposed) {
      return
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      this.endCurrent('idle')
    }, this.idleTimeoutMs)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer != null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private dispatch(event: UiActivityEvent): void {
    this.onDispatch(event)
  }
}

/** Fan-out with per-handler isolation (sync throw + async rejection). */
export function dispatchUiActivityToHandlers(
  handlers: Iterable<{ owner: string, handler: UiActivityHandler }>,
  activity: UiActivityEvent,
  logError: (owner: string, error: unknown) => void,
): void {
  for (const { owner, handler } of handlers) {
    try {
      Promise.resolve(handler(activity)).catch((error) => {
        logError(owner, error)
      })
    }
    catch (error) {
      logError(owner, error)
    }
  }
}
