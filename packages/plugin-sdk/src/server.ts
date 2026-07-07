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

  /** Plugin-scoped persistent KV storage */
  storage: PluginStorage

  /** Plugin-scoped logger */
  logger: Logger

  /** Shared config from desktop plugin (passed via env vars) */
  sharedConfig: ReadonlyMap<string, string>

  /** Plugin manifest metadata */
  manifest: PluginManifest

  /** Chat lifecycle hooks */
  hooks: ServerPluginHooks

  /** Event bus — subscribe to host-emitted events */
  events: PluginEventBus
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

export interface ServerPluginRuntimeRegistry {
  /** Register a Chat Runtime provider. The runtime must declare runtimeKind, metadata, static capabilities, and the four core ChatRuntime methods. */
  register: (runtime: unknown, metadata: ChatRuntimeContributionMetadata) => Disposable
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
  providerKind: 'anthropic' | 'openai-compatible' | 'cli-tool'
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

/** Chat lifecycle hooks — intercept/observe agent queries */
export interface ServerPluginHooks {
  /** Chat lifecycle hooks grouped under a domain namespace */
  chat: ServerPluginChatHooks
}

export interface ServerPluginChatHooks {
  /** Called before an agent query is executed. Can modify the query context. */
  onBeforeQuery: (handler: BeforeQueryHandler) => Disposable
  /** Called after an agent response is received (observation only). */
  onAfterResponse: (handler: AfterResponseHandler) => Disposable
}

export type BeforeQueryHandler = (
  ctx: QueryHookContext,
) => QueryHookContext | Promise<QueryHookContext>

export interface QueryHookContext {
  /** Messages to send to the agent */
  messages: Array<{ role: string, content: string }>
  /** Model being used */
  model: string
  /** Thread ID */
  threadId: string
  /** Additional metadata plugins can attach */
  metadata: Record<string, unknown>
}

export type AfterResponseHandler = (ctx: ResponseHookContext) => void | Promise<void>

export interface ResponseHookContext {
  /** Thread ID */
  threadId: string
  /** Model used */
  model: string
  /** Usage stats if available */
  usage?: { inputTokens: number, outputTokens: number }
  /** Duration in ms */
  durationMs: number
}

/** Event bus for plugin-to-host communication */
export interface PluginEventBus {
  /** Subscribe to a host event */
  on: (event: string, handler: (data: unknown) => void) => Disposable
  /** Emit an event (other plugins and host can listen) */
  emit: (event: string, data: unknown) => void
}

/** Server plugin module shape */
export interface ServerPlugin {
  activate: (ctx: ServerPluginContext) => void | Promise<void>
  deactivate?: () => void | Promise<void>
}
