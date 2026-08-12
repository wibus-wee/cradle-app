import {
  M0_ELECTRON_VERSION,
  M0_SCHEME_PRIVILEGES,
  M0_SCHEME_REGISTRATION,
  REQUIRED_M0_ASSERTIONS,
  validateM0Result,
} from './result-contract.mjs'

export {
  M0_ELECTRON_VERSION,
  M0_SCHEME_PRIVILEGES,
  M0_SCHEME_REGISTRATION,
  REQUIRED_M0_ASSERTIONS,
  validateM0Result,
}

export type M0Mode = 'development' | 'packaged'
export type M0AssertionName = typeof REQUIRED_M0_ASSERTIONS[number]
export type M0Detail = number | string | boolean

export interface M0Assertion {
  passed: boolean
  details: Record<string, M0Detail>
}

export interface M0MemorySample {
  elapsedMs: number
  mainKiB: number
  rendererKiB: number
}

export interface M0MemoryTrace {
  baselineKiB: { main: number, renderer: number }
  peakKiB: { main: number, renderer: number }
  samples: M0MemorySample[]
}

export interface M0MemoryResult {
  chunkBytes: 262144
  baselineKiB: { main: number, renderer: number }
  peak64MiBKiB: { main: number, renderer: number }
  peak128MiBKiB: { main: number, renderer: number }
  settledKiB: { main: number, renderer: number }
  trace64MiB: M0MemoryTrace
  trace128MiB: M0MemoryTrace
}

export interface M0Counters {
  activeRequests: number
  responseCancels: number
  upstreamCloses: number
  defaultSessionHits: number
  partitionHits: number
  requestSignalAborts: number
  cancelStreamChunks: number
  customSchemeModuleHits: number
}

export interface M0RendererReport {
  assertions: Partial<Record<M0AssertionName | string, M0Assertion>>
  trace64MiB: M0MemoryTrace
  trace128MiB: M0MemoryTrace
}

export interface M0RendererDiagnostics {
  activeRequests: number
  responseCancels: number
  requestSignalAborts: number
  defaultSessionHits: number
  partitionHits: number
  customSchemeModuleHits: number
  rejectedAuthorities: number
  upstreamActiveRequests: number
  upstreamCloses: number
  cancelStreamChunks: number
  requestStreamChunks: number
  requestStreamFirstToLastMs: number
  pixelHits: number
  simpleModuleHits: number
  realPluginHits: number
  dependencyHits: number
  pdfBytes: number
  pdfSha256: string
}

export interface M0Result {
  schemaVersion: 1
  passed: boolean
  mode: M0Mode
  electronVersion: string
  platform: NodeJS.Platform
  arch: string
  artifactPath: string | null
  schemePrivileges: typeof M0_SCHEME_PRIVILEGES
  assertions: Record<M0AssertionName | string, M0Assertion>
  memory: M0MemoryResult
  counters: M0Counters
  launch: {
    noSandbox: boolean
    rendererSandbox: true
  }
}
