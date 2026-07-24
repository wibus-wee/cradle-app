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

export interface ServerBootstrapEvent {
  type: 'cradle-server-bootstrap'
  phase: ServerBootstrapPhase
  kind: ServerBootstrapEventKind
  at: string
  error?: string
}

type BootstrapEventSink = (event: ServerBootstrapEvent) => void

function publishToParent(event: ServerBootstrapEvent): void {
  process.send?.(event)
}

export class ServerBootstrapReporter {
  constructor(private readonly publish: BootstrapEventSink = publishToParent) {}

  started(phase: ServerBootstrapPhase): void {
    this.emit(phase, 'started')
  }

  completed(phase: ServerBootstrapPhase): void {
    this.emit(phase, 'completed')
  }

  failed(phase: ServerBootstrapPhase, error: unknown): void {
    this.emit(phase, 'failed', error instanceof Error ? error.message : String(error))
  }

  ready(): void {
    this.emit('listener-establishment', 'ready')
  }

  async run<T>(phase: ServerBootstrapPhase, operation: () => Promise<T>): Promise<T> {
    this.started(phase)
    try {
      const result = await operation()
      this.completed(phase)
      return result
    }
 catch (error) {
      this.failed(phase, error)
      throw error
    }
  }

  runSync<T>(phase: ServerBootstrapPhase, operation: () => T): T {
    this.started(phase)
    try {
      const result = operation()
      this.completed(phase)
      return result
    }
 catch (error) {
      this.failed(phase, error)
      throw error
    }
  }

  private emit(phase: ServerBootstrapPhase, kind: ServerBootstrapEventKind, error?: string): void {
    this.publish({
      type: 'cradle-server-bootstrap',
      phase,
      kind,
      at: new Date().toISOString(),
      ...(error ? { error } : {}),
    })
  }
}
