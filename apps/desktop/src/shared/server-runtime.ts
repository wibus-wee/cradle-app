export const DESKTOP_SERVER_STATUS_GET_CHANNEL = 'desktop-server:get-status'
export const DESKTOP_SERVER_STATUS_CHANGED_CHANNEL = 'desktop-server:status-changed'

export const SERVER_BOOTSTRAP_PHASES = [
  'database-migration',
  'database-maintenance',
  'persisted-run-recovery',
  'service-initialization',
  'plugin-activation',
  'listener-establishment',
] as const

export type ServerBootstrapPhase = (typeof SERVER_BOOTSTRAP_PHASES)[number]
export type ServerBootstrapEventKind = 'started' | 'completed' | 'failed' | 'ready'

/** Lifecycle fact emitted by the server and forwarded through the managed process. */
export interface ServerBootstrapEvent {
  type: 'cradle-server-bootstrap'
  phase: ServerBootstrapPhase
  kind: ServerBootstrapEventKind
  at: string
  error?: string
}

/** Desktop-owned projection retained for both IPC snapshots and diagnostics. */
export interface DesktopServerBootstrapSnapshot {
  startedAt: string
  currentPhase: ServerBootstrapPhase | null
  phaseStartedAt: string | null
  lastEvent: ServerBootstrapEvent | null
  phases: Partial<Record<ServerBootstrapPhase, DesktopServerBootstrapPhaseReport>>
}

export interface DesktopServerBootstrapPhaseReport {
  startedAt?: string
  completedAt?: string
  failedAt?: string
  error?: string
}

export type DesktopServerStatus
  = | { state: 'starting' }
    | { state: 'migrating', phase: string }
    | { state: 'bootstrapping', bootstrap: DesktopServerBootstrapSnapshot }
    | { state: 'ready', serverUrl: string, bootstrap: DesktopServerBootstrapSnapshot }
    | { state: 'failed', message: string, bootstrap: DesktopServerBootstrapSnapshot | null }

export function createDesktopServerBootstrapSnapshot(
  now = new Date(),
): DesktopServerBootstrapSnapshot {
  return {
    startedAt: now.toISOString(),
    currentPhase: null,
    phaseStartedAt: null,
    lastEvent: null,
    phases: {},
  }
}

export function applyServerBootstrapEvent(
  snapshot: DesktopServerBootstrapSnapshot,
  event: ServerBootstrapEvent,
): DesktopServerBootstrapSnapshot {
  const previousReport = snapshot.phases[event.phase]
  const report: DesktopServerBootstrapPhaseReport = {
    ...previousReport,
    ...(event.kind === 'started' ? { startedAt: event.at } : {}),
    ...(event.kind === 'completed' ? { completedAt: event.at } : {}),
    ...(event.kind === 'failed' ? { failedAt: event.at, error: event.error } : {}),
  }
  const currentPhase
    = event.kind === 'started'
      ? event.phase
      : snapshot.currentPhase === event.phase
        ? null
        : snapshot.currentPhase
  return {
    ...snapshot,
    currentPhase,
    phaseStartedAt:
      event.kind === 'started' ? event.at : currentPhase === null ? null : snapshot.phaseStartedAt,
    lastEvent: event,
    phases: {
      ...snapshot.phases,
      [event.phase]: report,
    },
  }
}
