import { DockerCliSandboxRuntime } from './docker-cli'
import { MockSandboxRuntime } from './mock'
import type { SandboxRuntime } from './types'

export { detectDockerSocketPath, DockerCliSandboxRuntime } from './docker-cli'
export { MockSandboxRuntime } from './mock'
export type { SandboxRuntime } from './types'
export type {
  SandboxCreateRequest,
  SandboxEngineContainer,
  SandboxExecRequest,
  SandboxExecResult,
  SandboxMountSpec,
  SandboxNetworkMode,
} from './types'

let runtimeOverride: SandboxRuntime | null = null
let cachedRuntime: SandboxRuntime | null = null

/** Test seam: inject mock/docker runtime without touching process env permanently. */
export function setSandboxRuntimeForTests(runtime: SandboxRuntime | null): void {
  runtimeOverride = runtime
  cachedRuntime = null
}

export function getSandboxRuntime(): SandboxRuntime {
  if (runtimeOverride) {
    return runtimeOverride
  }
  if (cachedRuntime) {
    return cachedRuntime
  }
  if (process.env.CRADLE_SANDBOX_RUNTIME === 'mock') {
    cachedRuntime = new MockSandboxRuntime()
    return cachedRuntime
  }
  cachedRuntime = new DockerCliSandboxRuntime()
  return cachedRuntime
}
