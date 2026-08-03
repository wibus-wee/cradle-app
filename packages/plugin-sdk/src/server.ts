import type { Disposable, Logger, PluginManifest } from './index'

// Re-export shared types for convenience
export type { Disposable, Logger, PluginManifest } from './index'

/** Server plugin context — provided by host during activation */
export interface ServerPluginContext {
  /** HTTP route registrations owned by this plugin. */
  routes: ServerPluginRouteRegistry

  /** MCP server registrations */
  mcp: ServerPluginMcpRegistry

  /** Skill registrations */
  skills: ServerPluginSkillRegistry

  /** Provider-related registrations */
  providers: ServerPluginProviderRegistries

  /** Issue-related registrations */
  issues: ServerPluginIssueRegistries

  /** Chat/Jarvis runtime provider registrations */
  runtimes: ServerPluginRuntimeRegistry

  /** External conversation platform adapters such as Slack or Discord */
  conversation: ServerPluginConversationRegistries

  /** Disposables that the host releases when this plugin layer deactivates */
  subscriptions: Disposable[]

  /** Live, post-commit Cradle activity metadata */
  activities: PluginActivitySubscription

  /** Plugin-scoped persistent KV storage */
  storage: PluginStorage

  /** Plugin-owned retained resources projected through Cradle Managed Resources. */
  resources: PluginManagedResourceRegistry

  /** Download Center access with the owner namespace forced to this plugin. */
  downloads: PluginDownloadService

  /** Host-created filesystem paths owned by this plugin. */
  paths: PluginPaths

  /** Encrypted secret values scoped to this plugin. */
  secrets: PluginSecrets

  /** Child processes restricted to executables and working directories in this plugin's data directory. */
  processes: PluginProcessService

  /** Plugin package lifecycle hooks, including confirmed uninstall cleanup. */
  lifecycle: PluginLifecycle

  /** Plugin-scoped logger */
  logger: Logger

  /** Shared config from desktop plugin (passed via env vars) */
  sharedConfig: ReadonlyMap<string, string>

  /** Plugin manifest metadata */
  manifest: PluginManifest

}

export type PluginManagedResourceState
  = | 'not-installed'
    | 'installing'
    | 'installed'
    | 'update-available'
    | 'error'
    | 'unavailable'

export type PluginManagedResourceInstallationSource = 'built-in' | 'managed' | 'external' | null
export type PluginManagedResourceActionName = 'install' | 'update' | 'uninstall'

export interface PluginManagedResourceKey {
  resourceType: string
  resourceId: string
}

export interface PluginManagedResourceAction {
  available: boolean
  reasonCode: string | null
}

export interface PluginManagedResourceProjection {
  state: PluginManagedResourceState
  installationSource: PluginManagedResourceInstallationSource
  installedVersion: string | null
  availableVersion: string | null
  installedSizeBytes: number | null
  downloadSizeBytes: number | null
  actions: {
    install: PluginManagedResourceAction
    update: PluginManagedResourceAction
    uninstall: PluginManagedResourceAction
  }
}

export interface PluginManagedResourceDeclaration {
  key: PluginManagedResourceKey
  displayName: string
  description: string | null
  kind: string
  required: boolean
}

export interface PluginManagedResourceAdapter {
  declarations: () => readonly PluginManagedResourceDeclaration[]
  project: (key: PluginManagedResourceKey) => Promise<PluginManagedResourceProjection>
  execute: (
    key: PluginManagedResourceKey,
    action: PluginManagedResourceActionName,
  ) => Promise<PluginManagedResourceProjection>
}

export interface PluginManagedResourceRegistry {
  /** Registers one owner adapter. A plugin may register at most one adapter at a time. */
  register: (adapter: PluginManagedResourceAdapter) => Disposable
}

export interface PluginDownloadRequest {
  owner: {
    resourceType: string
    resourceId: string
    displayName: string
  }
  fileName: string
  sources: ReadonlyArray<{
    id: string
    url: string
    headers?: Readonly<Record<string, string>>
  }>
  integrity?: {
    expectedBytes?: number
    checksum?: {
      algorithm: 'sha256' | 'sha512'
      value: string
    }
  }
  maxBytes: number
  maxAttempts?: number
}

export interface PluginDownloadedArtifact {
  taskId: string
  filePath: string
  bytes: number
  checksum: {
    algorithm: 'sha256' | 'sha512'
    expected: string | null
    actual: string
    matched: boolean | null
  }
}

export interface PluginDownloadService {
  execute: (request: PluginDownloadRequest) => Promise<PluginDownloadedArtifact>
  release: (taskId: string) => Promise<void>
}

export interface PluginPaths {
  /** Absolute directory below the Cradle data directory reserved for this plugin. */
  dataDir: string
}

export interface PluginSecrets {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
  delete: (key: string) => void
}

export interface PluginProcessSpec {
  id: string
  displayName: string
  command: string
  args?: readonly string[]
  cwd?: string
  env?: Readonly<Record<string, string>>
}

export interface PluginProcessView {
  id: string
  displayName: string
  pid: number | null
  state: 'starting' | 'running' | 'stopping'
  startedAt: string
}

export interface PluginProcessHandle {
  readonly id: string
  status: () => PluginProcessView | null
  stop: () => Promise<void>
}

export interface PluginProcessService {
  spawn: (spec: PluginProcessSpec) => Promise<PluginProcessHandle>
  list: () => PluginProcessView[]
  stop: (id: string) => Promise<void>
  stopAll: () => Promise<void>
}

export interface PluginUninstallDataEffect {
  id: string
  label: string
  effect: 'remove' | 'preserve'
  description?: string
}

export interface PluginUninstallInspection {
  summary: string
  data: PluginUninstallDataEffect[]
  warnings?: string[]
}

export interface PluginUninstallHandler {
  inspect: () => PluginUninstallInspection | Promise<PluginUninstallInspection>
  execute: () => void | Promise<void>
}

export interface PluginLifecycle {
  registerUninstall: (handler: PluginUninstallHandler) => Disposable
}

export type ServerPluginRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ServerPluginRouteContext<
  TBody = unknown,
  TParams extends Record<string, string> = Record<string, string>,
  TQuery extends Record<string, unknown> = Record<string, unknown>,
> {
  body: TBody
  params: TParams
  query: TQuery
  headers: Record<string, string | undefined>
  set: {
    status?: number | string
    headers?: Record<string, string>
  }
}

export type ServerPluginRouteHandler<
  TBody = unknown,
  TParams extends Record<string, string> = Record<string, string>,
  TQuery extends Record<string, unknown> = Record<string, unknown>,
> = (context: ServerPluginRouteContext<TBody, TParams, TQuery>) => unknown | Promise<unknown>

export interface ServerPluginRouteRegistration<
  TBody = unknown,
  TParams extends Record<string, string> = Record<string, string>,
  TQuery extends Record<string, unknown> = Record<string, unknown>,
> {
  method: ServerPluginRouteMethod
  /** Path below /api/plugins/{routeSegment}; must start with '/'. */
  path: string
  handler: ServerPluginRouteHandler<TBody, TParams, TQuery>
  label?: string
  metadata?: Record<string, unknown>
}

export interface ServerPluginRouteRegistry {
  /** Register a plugin-owned HTTP route below /api/plugins/{routeSegment}. */
  register: (route: ServerPluginRouteRegistration) => Disposable
}

export type McpServerConfig = StdioMcpServerConfig | StreamableHttpMcpServerConfig

export interface StdioMcpServerConfig {
  /** MCP transport kind. Stdio servers are spawned as local child processes. */
  transport: 'stdio'
  /** Unique name for this MCP server */
  name: string
  /** Command to execute (e.g. 'node') */
  command: string
  /** Arguments for the command */
  args: string[]
  /** Environment variables for the process */
  env?: Record<string, string>
  /** Predicate — if returns false, server is not registered */
  when?: () => boolean | Promise<boolean>
}

export interface StreamableHttpMcpServerConfig {
  /** MCP transport kind. Streamable HTTP servers are already reachable over HTTP. */
  transport: 'streamable-http'
  /** Unique name for this MCP server */
  name: string
  /** HTTP MCP endpoint URL. */
  url: string
  /** Optional HTTP headers for the runtime MCP client. May contain secrets. */
  headers?: Record<string, string>
  /** Predicate — if returns false, server is not registered */
  when?: () => boolean | Promise<boolean>
}

export interface ServerPluginMcpRegistry {
  /** Register an MCP server for agent runtime */
  registerServer: (config: McpServerConfig) => Disposable | Promise<Disposable | undefined> | undefined
}

export interface SkillDefinition {
  /** Skill name (used as identifier) */
  name: string
  /** Human-readable description */
  description: string
  /** Absolute path to SKILL.md file */
  skillFile: string
}

export interface ServerPluginSkillRegistry {
  /** Register a skill for agent discovery */
  register: (skill: SkillDefinition) => Disposable
}

export interface ServerPluginProviderRegistries {
  /** External provider sources that return host-rendered provider snapshots */
  externalSources: ExternalProviderSourceRegistry
}

export interface ServerPluginIssueRegistries {
  /** External issue sources that return host-rendered read-only issue snapshots */
  externalSources: ExternalIssueSourceRegistry
}

export interface ServerPluginConversationRegistries {
  /** Platform adapters that translate external conversations into Cradle session messages */
  adapters: ConversationBridgeAdapterRegistry
}

export type ChatRuntimeSurface = 'chat' | 'jarvis'

export interface ChatRuntimeContributionMetadata {
  runtimeKind: string
  label: string
  description?: string
  providerKinds: string[]
  iconKey?: string
  surfaces?: ChatRuntimeSurface[]
  sortOrder?: number
}

// ── Plugin Chat Runtime contract ─────────────────────────────────────────────
//
// Minimal structural mirror of the host `ChatRuntime` contract from
// `@cradle/chat-runtime-contracts`. The SDK is published and must not depend
// on that private package, so the shapes below intentionally cover only the
// members every plugin runtime must provide. The host asserts at compile time
// that its full `ChatRuntime` type stays assignable to `PluginChatRuntime`.

/** Loose mirror of the host provider target profile handed to plugin runtimes. */
export interface PluginChatRuntimeProviderTargetProfile {
  id: string
  name: string
  enabled: boolean
  configJson: string
  customModels: string
  iconSlug: string | null
  providerTargetKind: 'manual' | 'external'
  providerTargetId: string
}

export interface PluginChatRuntimeSession {
  id: string
  chatSessionId: string
  providerTargetId: string | null
  runtimeKind: string
  providerSessionId: string | null
  providerStateSnapshot: string | null
}

/** Loose mirror of the AI SDK `UIMessage` shape streamed through Cradle. */
export interface PluginChatUiMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  parts: Array<{ type: string }>
}

export type PluginChatRuntimeSteerCapability = 'native' | 'queue-fallback' | 'unsupported'

export interface PluginChatRuntimeCapabilities {
  readonly steer: PluginChatRuntimeSteerCapability
  readonly supportsShellExecution: boolean
  readonly supportsLastTurnRollback: boolean
  readonly supportsRuntimeSettings: boolean
  readonly supportsUiSlotStates: boolean
  readonly supportsDynamicCapabilities: boolean
  readonly supportsTitleGeneration: boolean
  readonly sessionModelSwitch: 'in-session' | 'restart-session' | 'unsupported'
}

export interface PluginChatRuntimeMetadata {
  label: string
  description?: string
  providerKinds: string[]
  iconKey?: string
  surfaces?: ChatRuntimeSurface[]
  sortOrder?: number
}

export interface PluginStartChatSessionInput {
  chatSessionId: string
  profile: PluginChatRuntimeProviderTargetProfile | null
  workspacePath: string
  agentId?: string | null
  modelId?: string | null
  previousProviderStateSnapshot?: string | null
}

export interface PluginResumeChatSessionInput {
  runtimeSession: PluginChatRuntimeSession
  profile: PluginChatRuntimeProviderTargetProfile | null
  workspacePath: string
  agentId?: string | null
  modelId?: string | null
}

export interface PluginStreamTurnInput {
  runId: string
  runtimeSession: PluginChatRuntimeSession
  profile: PluginChatRuntimeProviderTargetProfile | null
  message: PluginChatUiMessage
  queueItemId?: string | null
  modelId?: string | null
  workspaceId?: string | null
  workspacePath?: string
  agentId?: string | null
  systemPrompt?: string
}

export interface PluginCancelTurnInput {
  runtimeSession: PluginChatRuntimeSession
  profile: PluginChatRuntimeProviderTargetProfile | null
}

/**
 * Contract for a plugin-contributed Chat Runtime.
 *
 * Members are declared with method syntax on purpose: the host `ChatRuntime`
 * uses richer input types, and method parameter bivariance keeps it assignable
 * to this contract while plugin authors still get typed inputs instead of
 * `unknown`. Streamed chunks follow the AI SDK `UIMessageChunk` protocol.
 */
export interface PluginChatRuntime {
  readonly runtimeKind: string
  readonly metadata: PluginChatRuntimeMetadata
  readonly capabilities: PluginChatRuntimeCapabilities
  startChatSession: (input: PluginStartChatSessionInput) => Promise<PluginChatRuntimeSession>
  resumeChatSession: (input: PluginResumeChatSessionInput) => Promise<PluginChatRuntimeSession>
  streamTurn: (input: PluginStreamTurnInput) => AsyncIterable<unknown>
  cancelTurn: (input: PluginCancelTurnInput) => Promise<void>
}

export interface ServerPluginRuntimeRegistry {
  /** Register a Chat Runtime provider. The runtime must declare runtimeKind, metadata, static capabilities, and the four core ChatRuntime methods. */
  register: (runtime: PluginChatRuntime, metadata: ChatRuntimeContributionMetadata) => Disposable
}

export interface ConversationBridgeAdapterRegistry {
  register: (adapter: ConversationBridgeAdapterRegistration) => Disposable
}

export interface ConversationBridgeAdapterRegistration {
  id: string
  platform: string
  label: string
  description?: string
  capabilities?: ConversationBridgeAdapterCapabilities
  createRuntime: (ctx: ConversationBridgeAdapterRuntimeContext) => ConversationBridgeAdapterRuntime
}

export interface ConversationBridgeAdapterCapabilities {
  realtime?: 'socket' | 'webhook'
  channelBinding?: boolean
  threadBinding?: boolean
  interactiveControls?: boolean
}

export const CONVERSATION_BRIDGE_STATUS_REFRESH_ACTION = 'cradle_status_refresh'
export const CONVERSATION_BRIDGE_CHANNEL_UNBIND_ACTION = 'cradle_channel_unbind'
export const CONVERSATION_BRIDGE_WORKSPACE_SELECT_ACTION = 'cradle_workspace_select'
export const CONVERSATION_BRIDGE_SESSION_TARGET_SELECT_ACTION = 'cradle_session_target_select'
export const CONVERSATION_BRIDGE_SESSION_MODEL_SELECT_ACTION = 'cradle_session_model_select'

export interface ConversationBridgeAdapterRuntimeContext {
  logger: Logger
  sharedConfig: ReadonlyMap<string, string>
  signal: AbortSignal
}

export interface ConversationBridgeAdapterRuntime {
  start: (
    connection: ConversationBridgeConnectionRuntimeConfig,
    host: ConversationBridgeHost,
  ) => Promise<void>
  stop: (connectionId: string) => Promise<void>
  sendMessage: (input: ConversationBridgeDeliveryInput) => Promise<ConversationBridgeDeliveryResult>
}

export interface ConversationBridgeConnectionRuntimeConfig {
  id: string
  platform: string
  displayName: string
  config: Record<string, unknown>
  secrets: Record<string, string>
}

export interface ConversationBridgeHost {
  handleInboundMessage: (event: NormalizedConversationInboundMessage) => Promise<void>
  handleControl: (input: NormalizedConversationControl) => Promise<ConversationBridgeControlResponse>
  reportConnectionHealth: (input: ConversationBridgeConnectionHealth) => void
}

export interface NormalizedConversationInboundMessage {
  connectionId: string
  externalEventId: string
  externalWorkspaceId: string
  externalChannelId: string
  externalThreadId: string
  externalMessageId: string
  externalActorId: string | null
  text: string
  mentionedAdapter: boolean
  eventType: string
  payload?: Record<string, unknown>
}

export interface ConversationBridgeDeliveryInput {
  connectionId: string
  externalWorkspaceId: string
  externalChannelId: string
  externalThreadId: string
  text: string
  payload?: Record<string, unknown>
}

export interface ConversationBridgeDeliveryResult {
  externalMessageId: string | null
  payload?: Record<string, unknown>
}

export interface ConversationBridgeConnectionHealth {
  connectionId: string
  status: 'starting' | 'running' | 'stopped' | 'error'
  message?: string | null
}

export interface NormalizedConversationControl {
  connectionId: string
  externalWorkspaceId: string
  externalChannelId: string
  externalActorId: string | null
  kind: 'command' | 'action'
  command?: string
  text?: string
  actionId?: string
  selectedValue?: string | null
  value?: string | null
  payload?: Record<string, unknown>
}

export interface ConversationBridgeControlResponse {
  text: string
  visibility: 'ephemeral' | 'in_channel'
  replaceOriginal?: boolean
  blocks?: ConversationBridgeControlBlock[]
}

export type ConversationBridgeControlBlock
  = | ConversationBridgeControlHeaderBlock
    | ConversationBridgeControlSectionBlock
    | ConversationBridgeControlContextBlock
    | ConversationBridgeControlDividerBlock
    | ConversationBridgeControlActionsBlock

export interface ConversationBridgeControlHeaderBlock {
  type: 'header'
  text: string
}

export interface ConversationBridgeControlSectionBlock {
  type: 'section'
  text: string
  accessory?: ConversationBridgeControlElement
}

export interface ConversationBridgeControlContextBlock {
  type: 'context'
  text: string
}

export interface ConversationBridgeControlDividerBlock {
  type: 'divider'
}

export interface ConversationBridgeControlActionsBlock {
  type: 'actions'
  elements: ConversationBridgeControlElement[]
}

export type ConversationBridgeControlElement
  = | ConversationBridgeControlButtonElement
    | ConversationBridgeControlSelectElement

export interface ConversationBridgeControlButtonElement {
  type: 'button'
  actionId: string
  text: string
  value?: string
  style?: 'primary' | 'danger'
  confirm?: {
    title: string
    text: string
    confirm: string
    deny: string
  }
}

export interface ConversationBridgeControlSelectElement {
  type: 'static_select'
  actionId: string
  placeholder: string
  options: ConversationBridgeControlOption[]
  initialOption?: ConversationBridgeControlOption
}

export interface ConversationBridgeControlOption {
  label: string
  description?: string
  value: string
}

export interface ExternalProviderSourceRegistry {
  register: (source: ExternalProviderSource) => Disposable
}

export interface ExternalProviderSource {
  id: string
  label: string
  description?: string
  capabilities?: ExternalProviderSourceCapabilities
  readSnapshot: (ctx: ExternalProviderSourceReadContext) => Promise<ExternalProviderSourceSnapshot>
}

export interface ExternalProviderSourceCapabilities {
  refresh?: boolean
  revealSourceFile?: boolean
  importAsNative?: boolean
}

export interface ExternalProviderSourceReadContext {
  signal: AbortSignal
  logger: Logger
  sharedConfig: ReadonlyMap<string, string>
}

export interface ExternalProviderSourceSnapshot {
  source: ExternalProviderSourceSnapshotInfo
  providers: ExternalProviderRecord[]
  inventory?: ExternalProviderInventory
  warnings?: ExternalProviderWarning[]
}

export interface ExternalProviderSourceSnapshotInfo {
  status: 'ok' | 'warning' | 'error'
  message?: string
  observedAt?: string
}

export interface ExternalProviderRecord {
  externalId: string
  app: string
  name: string
  providerKind: 'anthropic' | 'openai-compatible' | 'universal' | 'cli-tool'
  config: Record<string, unknown>
  credential?: ExternalProviderCredential
  current?: boolean
  readonly?: boolean
  metadata?: ExternalProviderRecordMetadata
  warnings?: ExternalProviderWarning[]
}

export interface ExternalProviderCredential {
  kind: 'api-key' | 'chatgpt-auth'
  value: string
  label?: string
}

export interface ExternalProviderRecordMetadata {
  baseUrl?: string
  openaiBaseUrl?: string
  anthropicBaseUrl?: string
  model?: string
  apiFormat?: string
  iconSlug?: string
  iconUrl?: string
  avatarUrl?: string
  sourceUpdatedAt?: string
  rawFingerprintHint?: string
}

export interface ExternalProviderInventory {
  mcpServers?: number
  prompts?: number
  skills?: number
  usageRollups?: number
  modelPricingEntries?: number
}

export interface ExternalProviderWarning {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
}

export interface ExternalIssueSourceRegistry {
  register: (source: ExternalIssueSource) => Disposable
}

export interface ExternalIssueSource {
  id: string
  label: string
  description?: string
  capabilities?: ExternalIssueSourceCapabilities
  readSnapshot: (ctx: ExternalIssueSourceReadContext) => Promise<ExternalIssueSourceSnapshot>
}

export interface ExternalIssueSourceCapabilities {
  refresh?: boolean
}

export interface ExternalIssueSourceReadContext {
  signal: AbortSignal
  logger: Logger
  sharedConfig: ReadonlyMap<string, string>
  repository: {
    owner: string
    name: string
  }
  etag?: string | null
  cursor?: Record<string, unknown> | null
}

export interface ExternalIssueSourceSnapshot {
  source: ExternalIssueSourceSnapshotInfo
  issues: ExternalIssueRecord[]
  inventory?: Record<string, unknown>
  warnings?: ExternalIssueWarning[]
}

export interface ExternalIssueSourceSnapshotInfo {
  status: 'ok' | 'warning' | 'error'
  message?: string
  observedAt?: string
  notModified?: boolean
  etag?: string
  cursor?: Record<string, unknown>
  rateLimit?: {
    remaining?: number
    resetAt?: number
  }
}

export interface ExternalIssueRecord {
  externalId: string
  externalKey: string
  externalUrl?: string
  repository: {
    owner: string
    name: string
  }
  number: number
  title: string
  body?: string | null
  state: 'open' | 'closed'
  labels?: string[]
  assignees?: string[]
  milestone?: string | null
  createdAt?: string
  updatedAt?: string
  closedAt?: string | null
  metadata?: Record<string, unknown>
  warnings?: ExternalIssueWarning[]
}

export interface ExternalIssueWarning {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
}

export interface PluginStorage {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  delete: (key: string) => Promise<void>
}

export type PluginActivity
  = | {
    kind: 'chat.run.started'
    occurredAt: number
    sessionId: string
    runId: string
    origin: 'user' | 'issue-agent' | 'system'
  }
  | {
    kind: 'chat.run.finished'
    occurredAt: number
    sessionId: string
    runId: string
    outcome: 'completed' | 'failed' | 'aborted'
  }

export type PluginActivityHandler = (activity: PluginActivity) => void | Promise<void>

export interface PluginActivitySubscription {
  subscribe: (handler: PluginActivityHandler) => Disposable
}

/** Server plugin module shape */
export interface ServerPlugin {
  activate: (ctx: ServerPluginContext) => void | Promise<void>
  deactivate?: () => void | Promise<void>
}
