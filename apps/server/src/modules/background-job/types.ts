import type { BackgroundJob } from '@cradle/db'

export type BackgroundJobStatus = BackgroundJob['status']
export type BackgroundJobTerminalStatus = Extract<
  BackgroundJobStatus,
  'succeeded' | 'failed' | 'cancelled'
>

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export interface BackgroundJobView {
  id: string
  workspaceId: string | null
  ownerNamespace: string
  ownerResourceType: string
  ownerResourceId: string
  ownerResourceKey: string | null
  kind: string
  status: BackgroundJobStatus
  sourceKind: string
  sourceSessionId: string | null
  sourceRunId: string | null
  attempts: number
  maxAttempts: number
  context: JsonObject
  progress: JsonObject | null
  result: JsonObject | null
  errorCode: string | null
  errorMessage: string | null
  errorDetails: JsonObject | null
  cancelRequestedAt: number | null
  startedAt: number | null
  finishedAt: number | null
  projectedAt: number | null
  projectionAttempts: number
  projectionError: string | null
  createdAt: number
  updatedAt: number
}

export interface BackgroundJobSourceObservation {
  status: BackgroundJobStatus
  progress?: JsonObject | null
  result?: JsonObject | null
  errorCode?: string | null
  errorMessage?: string | null
  errorDetails?: JsonObject | null
  startedAt?: number | null
  finishedAt?: number | null
}

export interface BackgroundJobSourceAdapter {
  sourceKind: string
  read: (job: BackgroundJobView) => Promise<BackgroundJobSourceObservation>
  cancel?: (job: BackgroundJobView) => Promise<void>
}

export interface BackgroundJobProjectionResult {
  status?: BackgroundJobTerminalStatus
  result?: JsonObject | null
  errorCode?: string | null
  errorMessage?: string | null
  errorDetails?: JsonObject | null
}

export interface BackgroundJobOwnerProjector {
  ownerNamespace: string
  kind: string
  project: (
    job: BackgroundJobView,
  ) => Promise<BackgroundJobProjectionResult | void> | BackgroundJobProjectionResult | void
}
