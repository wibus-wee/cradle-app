import { randomUUID } from 'node:crypto'

import type {
  SandboxCreateRequest,
  SandboxEngineContainer,
  SandboxExecRequest,
  SandboxExecResult,
  SandboxRuntime,
} from './types'

interface MockContainer extends SandboxEngineContainer {
  workdir: string
  env: Record<string, string>
  mounts: SandboxCreateRequest['mounts']
  running: boolean
}

/**
 * In-memory Docker substitute for focused tests and CI without an engine.
 * Exec returns a deterministic echo of the command unless a scripted handler is set.
 */
export class MockSandboxRuntime implements SandboxRuntime {
  readonly kind = 'mock' as const
  private readonly containers = new Map<string, MockContainer>()
  private available = true
  private execHandler: ((request: SandboxExecRequest) => SandboxExecResult | Promise<SandboxExecResult>) | null = null
  pulledImages = new Set<string>()
  createCount = 0
  removeCount = 0

  setAvailable(available: boolean): void {
    this.available = available
  }

  setExecHandler(
    handler: ((request: SandboxExecRequest) => SandboxExecResult | Promise<SandboxExecResult>) | null,
  ): void {
    this.execHandler = handler
  }

  reset(): void {
    this.containers.clear()
    this.pulledImages.clear()
    this.createCount = 0
    this.removeCount = 0
    this.available = true
    this.execHandler = null
  }

  async ping(): Promise<boolean> {
    return this.available
  }

  async pullImage(image: string): Promise<void> {
    if (!this.available) {
      throw new Error('mock sandbox runtime unavailable')
    }
    this.pulledImages.add(image)
  }

  async create(request: SandboxCreateRequest): Promise<SandboxEngineContainer> {
    if (!this.available) {
      throw new Error('mock sandbox runtime unavailable')
    }
    this.createCount += 1
    const id = `mock-${randomUUID()}`
    const container: MockContainer = {
      id,
      name: request.name,
      image: request.image,
      state: 'created',
      labels: { ...request.labels },
      workdir: request.workdir,
      env: { ...request.env },
      mounts: [...request.mounts],
      running: false,
    }
    this.containers.set(id, container)
    this.pulledImages.add(request.image)
    return publicView(container)
  }

  async start(containerId: string): Promise<void> {
    const container = requireContainer(this.containers, containerId)
    container.running = true
    container.state = 'running'
  }

  async stop(containerId: string): Promise<void> {
    const container = this.containers.get(containerId)
    if (!container) {
      return
    }
    container.running = false
    container.state = 'exited'
  }

  async remove(containerId: string, force = false): Promise<void> {
    const container = this.containers.get(containerId)
    if (!container) {
      return
    }
    if (container.running && !force) {
      throw new Error(`container ${containerId} is running`)
    }
    this.containers.delete(containerId)
    this.removeCount += 1
  }

  async exec(request: SandboxExecRequest): Promise<SandboxExecResult> {
    const container = requireContainer(this.containers, request.containerId)
    if (!container.running) {
      throw new Error(`container ${request.containerId} is not running`)
    }
    if (this.execHandler) {
      return await this.execHandler(request)
    }
    return {
      exitCode: 0,
      stdout: request.command.join(' '),
      stderr: '',
      timedOut: false,
    }
  }

  async inspect(containerId: string): Promise<SandboxEngineContainer | null> {
    const container = this.containers.get(containerId)
    return container ? publicView(container) : null
  }

  async listLabeled(labelEquals: Record<string, string>): Promise<SandboxEngineContainer[]> {
    return [...this.containers.values()]
      .filter(container => Object.entries(labelEquals).every(([key, value]) => container.labels[key] === value))
      .map(publicView)
  }
}

function publicView(container: MockContainer): SandboxEngineContainer {
  return {
    id: container.id,
    name: container.name,
    image: container.image,
    state: container.state,
    labels: { ...container.labels },
  }
}

function requireContainer(containers: Map<string, MockContainer>, id: string): MockContainer {
  const container = containers.get(id)
  if (!container) {
    throw new Error(`container ${id} not found`)
  }
  return container
}
