import type {
  ChatRuntimeSettings,
  ChatThinkingEffort,
  CradleTurnTranscript,
  ProviderThreadEvent,
} from '@cradle/chat-runtime-contracts'
import type { UIMessage, UIMessageChunk } from 'ai'

export const REMOTE_AGENT_PROTOCOL_VERSION = 1 as const

export const remoteAgentUnaryMethods = [
  'host/hello',
  'host/health',
  'runtime/list',
  'workspace/list',
  'fs/listDirectory',
  'fs/stat',
  'fs/readFile',
  'git/probeRepository',
  'agent/list',
  'agent/start',
  'agent/attach',
  'agent/cancel',
  'agent/steer',
  'pty/write',
  'pty/resize',
  'pty/close',
] as const

export const remoteAgentStreamMethods = [
  'agent/turn',
  'pty/open',
] as const

export type RemoteAgentUnaryMethod = (typeof remoteAgentUnaryMethods)[number]
export type RemoteAgentStreamMethod = (typeof remoteAgentStreamMethods)[number]
export type RemoteAgentMethod = RemoteAgentUnaryMethod | RemoteAgentStreamMethod

export interface HostHelloParams {
  clientName: string
  clientVersion?: string | null
}

export interface HostHelloResult {
  protocolVersion: typeof REMOTE_AGENT_PROTOCOL_VERSION
  daemonVersion: string
  hostId: string
  platform: string
  arch: string
  supportedMethods: RemoteAgentMethod[]
}

export interface HostHealthResult {
  status: 'ok'
  daemonVersion: string
  hostId: string
  uptimeSeconds: number
}

export interface RemoteRuntimeSummary {
  runtimeKind: string
  label: string
  status: 'available' | 'unavailable'
  detail: string | null
}

export interface RuntimeListResult {
  runtimes: RemoteRuntimeSummary[]
}

export interface WorkspaceListParams {
  root?: string | null
}

export interface RemoteWorkspaceSummary {
  id: string
  name: string
  path: string
  reason: string
}

export interface WorkspaceListResult {
  workspaces: RemoteWorkspaceSummary[]
  message: string | null
}

export type RemoteFsEntryKind = 'file' | 'directory' | 'symlink' | 'other'

export interface RemoteFsEntry {
  name: string
  path: string
  kind: RemoteFsEntryKind
  size: number | null
  modifiedAt: number | null
  hidden: boolean
}

export interface FsListDirectoryParams {
  path?: string | null
}

export interface FsListDirectoryResult {
  path: string
  parentPath: string | null
  entries: RemoteFsEntry[]
}

export interface FsStatParams {
  path: string
}

export interface FsStatResult {
  path: string
  name: string
  kind: RemoteFsEntryKind
  size: number | null
  modifiedAt: number | null
  hidden: boolean
}

export interface FsReadFileParams {
  path: string
}

export interface FsReadFileResult {
  content: string
}

export interface GitProbeRepositoryParams {
  path: string
}

export interface GitProbeRepositoryResult {
  path: string
  isRepository: boolean
  rootPath: string | null
  branch: string | null
  remoteUrl: string | null
}

export interface RemoteAgentSummary {
  agentId: string
  runtimeKind: string
  workspacePath: string
  status: 'idle' | 'running' | 'failed'
  providerSessionId: string | null
  createdAt: number
  updatedAt: number
}

export interface AgentListResult {
  agents: RemoteAgentSummary[]
}

export interface AgentStartParams {
  runtimeKind: string
  workspacePath: string
  chatSessionId?: string | null
  providerSessionId?: string | null
  modelId?: string | null
}

export interface AgentStartResult {
  agent: RemoteAgentSummary
}

export interface AgentAttachParams {
  remoteAgentId: string
}

export interface AgentAttachResult {
  agent: RemoteAgentSummary
}

export interface AgentCancelParams {
  remoteAgentId: string
  reason?: string | null
}

export interface AgentCancelResult {
  cancelled: boolean
}

export interface AgentSteerParams {
  remoteAgentId: string
  message: UIMessage
}

export interface AgentSteerResult {
  accepted: boolean
}

export interface RemoteAgentTurnParams {
  remoteAgentId: string
  chatSessionId: string
  runId: string
  responseMessageId?: string
  message: UIMessage
  transcript?: CradleTurnTranscript
  originalMessages?: UIMessage[]
  modelId?: string | null
  workspaceId?: string | null
  workspacePath?: string
  cradleAgentId?: string | null
  providerOptions?: {
    thinkingEffort?: ChatThinkingEffort
    runtimeSettings?: ChatRuntimeSettings
  }
  systemPrompt?: string
  history?: UIMessage[]
}

export type RemoteAgentTurnEvent =
  | { kind: 'chunk', chunk: UIMessageChunk }
  | { kind: 'sessionTitle', title: string }
  | { kind: 'providerThreadEvent', event: ProviderThreadEvent }

export interface PtyOpenParams {
  ptyId?: string
  cwd: string
  cols: number
  rows: number
  shell?: string | null
}

export type PtyOpenEvent =
  | { kind: 'opened', ptyId: string, cwd: string, pid: number }
  | { kind: 'output', ptyId: string, data: string }
  | { kind: 'exit', ptyId: string, exitCode: number | null, signal: string | null }

export interface PtyWriteParams {
  ptyId: string
  data: string
}

export interface PtyResizeParams {
  ptyId: string
  cols: number
  rows: number
}

export interface PtyCloseParams {
  ptyId: string
}

export interface PtyCommandResult {
  ok: boolean
}

export interface RemoteAgentParamsByMethod {
  'host/hello': HostHelloParams
  'host/health': Record<string, never>
  'runtime/list': Record<string, never>
  'workspace/list': WorkspaceListParams
  'fs/listDirectory': FsListDirectoryParams
  'fs/stat': FsStatParams
  'fs/readFile': FsReadFileParams
  'git/probeRepository': GitProbeRepositoryParams
  'agent/list': Record<string, never>
  'agent/start': AgentStartParams
  'agent/attach': AgentAttachParams
  'agent/cancel': AgentCancelParams
  'agent/steer': AgentSteerParams
  'agent/turn': RemoteAgentTurnParams
  'pty/open': PtyOpenParams
  'pty/write': PtyWriteParams
  'pty/resize': PtyResizeParams
  'pty/close': PtyCloseParams
}

export interface RemoteAgentResultByMethod {
  'host/hello': HostHelloResult
  'host/health': HostHealthResult
  'runtime/list': RuntimeListResult
  'workspace/list': WorkspaceListResult
  'fs/listDirectory': FsListDirectoryResult
  'fs/stat': FsStatResult
  'fs/readFile': FsReadFileResult
  'git/probeRepository': GitProbeRepositoryResult
  'agent/list': AgentListResult
  'agent/start': AgentStartResult
  'agent/attach': AgentAttachResult
  'agent/cancel': AgentCancelResult
  'agent/steer': AgentSteerResult
  'pty/write': PtyCommandResult
  'pty/resize': PtyCommandResult
  'pty/close': PtyCommandResult
}

export interface RemoteAgentStreamValueByMethod {
  'agent/turn': RemoteAgentTurnEvent
  'pty/open': PtyOpenEvent
}

export type RemoteAgentParams<M extends RemoteAgentMethod> = RemoteAgentParamsByMethod[M]
export type RemoteAgentResult<M extends RemoteAgentUnaryMethod> = RemoteAgentResultByMethod[M]
export type RemoteAgentStreamValue<M extends RemoteAgentStreamMethod> = RemoteAgentStreamValueByMethod[M]

export function isRemoteAgentUnaryMethod(method: string): method is RemoteAgentUnaryMethod {
  return (remoteAgentUnaryMethods as readonly string[]).includes(method)
}

export function isRemoteAgentStreamMethod(method: string): method is RemoteAgentStreamMethod {
  return (remoteAgentStreamMethods as readonly string[]).includes(method)
}

export function isRemoteAgentMethod(method: string): method is RemoteAgentMethod {
  return isRemoteAgentUnaryMethod(method) || isRemoteAgentStreamMethod(method)
}
