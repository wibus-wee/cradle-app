export type SandboxNetworkMode = 'none' | 'bridge'

export interface SandboxMountSpec {
  hostPath: string
  containerPath: string
  readOnly: boolean
}

export interface SandboxCreateRequest {
  name: string
  image: string
  workdir: string
  env: Record<string, string>
  mounts: SandboxMountSpec[]
  networkMode: SandboxNetworkMode
  cpuLimit?: number
  memoryMb?: number
  labels: Record<string, string>
  /** Keep the container alive for lease/exec. */
  command?: string[]
}

export interface SandboxExecRequest {
  containerId: string
  command: string[]
  workdir?: string
  env?: Record<string, string>
  timeoutMs: number
}

export interface SandboxExecResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface SandboxEngineContainer {
  id: string
  name: string
  image: string
  state: 'created' | 'running' | 'exited' | 'dead' | 'unknown'
  labels: Record<string, string>
}

export interface SandboxRuntime {
  readonly kind: 'mock' | 'docker-cli'
  ping: () => Promise<boolean>
  pullImage: (image: string) => Promise<void>
  create: (request: SandboxCreateRequest) => Promise<SandboxEngineContainer>
  start: (containerId: string) => Promise<void>
  stop: (containerId: string, timeoutSec?: number) => Promise<void>
  remove: (containerId: string, force?: boolean) => Promise<void>
  exec: (request: SandboxExecRequest) => Promise<SandboxExecResult>
  inspect: (containerId: string) => Promise<SandboxEngineContainer | null>
  listLabeled: (labelEquals: Record<string, string>) => Promise<SandboxEngineContainer[]>
}
