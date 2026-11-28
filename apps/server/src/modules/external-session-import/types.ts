import type { UIMessage } from 'ai'

export type ExternalSessionSourceApp = 'claude' | 'codex' | 'kimi' | 'opencode'

export interface ExternalSessionGitIdentity {
  originUrl: string | null
  repoRoot: string | null
  branch: string | null
  headSha: string | null
}

export interface ExternalSessionDescriptor {
  candidateId: string
  sourceHostId: string
  sourceApp: ExternalSessionSourceApp
  externalSessionId: string
  sourcePath: string | null
  sourceRevision: string
  title: string
  summary: string | null
  workspacePath: string
  gitIdentity: ExternalSessionGitIdentity
  createdAt: number | null
  updatedAt: number | null
  archived: boolean
  estimatedBytes: number | null
  childSessionCount: number | null
  sourceFiles: ExternalSessionSourceFile[]
}

export interface ExternalSessionSourceFile {
  path: string
  kind: 'main' | 'subagent'
  sourceId: string
  size: number
  modifiedAtMs: number
}

export interface ExternalSessionBundleFile {
  sourcePath: string
  bundlePath: string
  kind: ExternalSessionSourceFile['kind']
  sourceId: string
  size: number
  sha256: string
}

export interface ExternalSessionBundleManifest {
  version: 1
  parserVersion: number
  sourceHostId: string
  sourceApp: ExternalSessionSourceApp
  externalSessionId: string
  sourceRevision: string
  capturedAt: number
  files: ExternalSessionBundleFile[]
}

export interface ExternalSessionBundle {
  storagePath: string
  absolutePath: string
  manifest: ExternalSessionBundleManifest
  created: boolean
}

export interface ExternalSessionImportMessage {
  sourceEntryIds: string[]
  createdAt: number | null
  message: UIMessage
}

export interface ExternalSessionFidelityReport {
  messages: number
  toolCalls: number
  reasoningParts: number
  omittedSystemEntries: number
  unavailableAttachments: number
  childSessions: number
  preservedUnknownEntries: number
}

export interface ExternalSessionReadResult {
  descriptor: ExternalSessionDescriptor
  contentHash: string
  messages: ExternalSessionImportMessage[]
  fidelity: ExternalSessionFidelityReport
}

export interface ExternalSessionDiscoverInput {
  sourceHostId: string
  limit?: number
}

export interface ExternalSessionReadInput {
  descriptor: ExternalSessionDescriptor
  bundle: ExternalSessionBundle
}

export interface ExternalSessionCaptureInput {
  descriptor: ExternalSessionDescriptor
}

export interface ExternalSessionSourceAdapter {
  readonly sourceApp: ExternalSessionSourceApp
  discover: (input: ExternalSessionDiscoverInput) => Promise<ExternalSessionDescriptor[]>
  capture: (input: ExternalSessionCaptureInput) => Promise<ExternalSessionBundle>
  read: (input: ExternalSessionReadInput) => Promise<ExternalSessionReadResult>
}
