export type UiActivityEntityType
  = | 'chat'
    | 'file'
    | 'settings'
    | 'pr'
    | 'diff'
    | 'kanban'
    | 'plugin'
    | 'work'
    | 'app'

export type UiActivityEndReason = 'entity-changed' | 'idle' | 'hidden'

export type UiActivityEvent
  = | {
    kind: 'ui.segment.started'
    occurredAt: number
    entity: string
    entityType: UiActivityEntityType
    previousEntity: string | null
    previousEntityType: UiActivityEntityType | null
  }
  | {
    kind: 'ui.segment.ended'
    occurredAt: number
    entity: string
    entityType: UiActivityEntityType
    durationMs: number
    endReason: UiActivityEndReason
  }

export interface UiActivitySegment {
  entity: string
  entityType: UiActivityEntityType
  startedAt: number
}

export interface ResolvedUiActivityEntity {
  entity: string
  entityType: UiActivityEntityType
}

export type UiActivityHandler = (activity: UiActivityEvent) => void | Promise<void>

export const IDLE_TIMEOUT_MS = 5 * 60 * 1000
export const MIN_OBSERVATION_DURATION_MS = 30_000
export const AMBIENT_OBSERVATION_LIMIT = 5
