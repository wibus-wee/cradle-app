export type RuntimeShutdownPhase = 'cancel' | 'drain' | 'stop' | 'close'

interface RuntimeResourceRegistration {
  name: string
  phase: RuntimeShutdownPhase
  stop: () => void | Promise<void>
}

const PHASES: RuntimeShutdownPhase[] = ['cancel', 'drain', 'stop', 'close']

export class RuntimeResourceRegistry {
  private readonly resources: RuntimeResourceRegistration[] = []
  private readonly shutdownController = new AbortController()
  private shutdownPromise: Promise<void> | null = null
  private shuttingDown = false

  get acceptingCommands(): boolean {
    return !this.shuttingDown
  }

  get shutdownSignal(): AbortSignal {
    return this.shutdownController.signal
  }

  register(resource: RuntimeResourceRegistration): void {
    if (this.shuttingDown) {
      throw new Error(`Cannot register runtime resource ${resource.name} during shutdown`)
    }
    if (this.resources.some(entry => entry.name === resource.name)) {
      throw new Error(`Runtime resource ${resource.name} is already registered`)
    }
    this.resources.push(resource)
  }

  shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shuttingDown = true
      this.shutdownController.abort()
      this.shutdownPromise = this.runShutdown()
    }
    return this.shutdownPromise
  }

  private async runShutdown(): Promise<void> {
    const failures: Error[] = []
    for (const phase of PHASES) {
      const resources = this.resources.filter(resource => resource.phase === phase).reverse()
      for (const resource of resources) {
        try {
          await resource.stop()
        }
        catch (error) {
          failures.push(new Error(`Failed to stop runtime resource ${resource.name}`, { cause: error }))
        }
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Runtime shutdown completed with failures')
    }
  }
}
