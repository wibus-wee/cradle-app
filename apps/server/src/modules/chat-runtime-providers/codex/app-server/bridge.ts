import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../../chat-runtime/runtime-provider-types'
import type { CodexConfig } from '../../../provider-contracts/provider-base'
import { readTrustedCodexConfig } from '../../../provider-contracts/provider-base'
import type { SecretValueWithMetadata } from '../../../secrets/service'
import {
  buildCodexBedrockModelProviderConfig,
  buildCodexExternalModelProviderConfig,
  buildCodexMcpServersConfig,
  codexConfigRequiresApiKey,
  resolveCodexAuthMode,
  resolveCodexExternalModelProviderBaseUrl,
} from '../config/runtime-config'
import { resolveCodexRuntimeContext } from '../config/runtime-context'
import { buildCodexServerRequestToolInput, buildCodexServerRequestToolOutput } from '../tools/mapper'
import type { CodexAppServerClientLike } from '../types'
import type { CodexAppServerCapabilityManifest, CodexAppServerMethodCapability } from './capabilities'
import { CODEX_APP_SERVER_CAPABILITIES, CODEX_APP_SERVER_CLIENT_METHOD_SET, readCodexAppServerMethodCapability } from './capabilities'
import type { CodexAppServerAuthResolution, CodexChatgptAuthCredential } from './chatgpt-auth'
import {
  readCodexApiKeyAuth,
  readCodexChatgptAuth,
  refreshCodexChatgptAuthCredential,
  resolveCodexAppServerAuth,
} from './chatgpt-auth'
import type { CodexAppServerClientOptions, CodexAppServerServerRequest } from './client'
import { isCodexAppServerUnknownMethodError } from './client'
import { buildCodexAppServerEnv } from './env'
import type { CodexAppServerHostLease } from './host-lease'
import { acquireCodexAppServerHostLease, codexChatSessionAppServerScopeId, invalidateCodexAppServerHost } from './host-lease'
import { subscribeCodexAppServerHostNotifications } from './host-resource'

export type { CodexAppServerCapabilityManifest } from './capabilities'

function resolveBridgeCodexSkillExtraRoots(
  config: CodexConfig,
  workspacePath: string,
  resolveSkillPaths: (workspacePath: string) => string[],
): string[] {
  return config.skillPaths.length > 0
    ? config.skillPaths
    : resolveSkillPaths(workspacePath)
}

async function syncBridgeCodexSkillExtraRoots(client: CodexAppServerClientLike, extraRoots: string[]): Promise<void> {
  if (extraRoots.length === 0) {
    return
  }
  try {
    await client.request('skills/extraRoots/set', { extraRoots })
  }
  catch (error) {
    if (isCodexAppServerUnknownMethodError(error, 'skills/extraRoots/set')) {
      return
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Codex app-server skills/extraRoots/set failed: ${detail}`)
  }
}

interface CodexAppServerBridgeDeps {
  readSecret: (credentialRef: string) => string
  readSecretValueWithMetadata?: (credentialRef: string) => SecretValueWithMetadata
  updateSecretValue?: (credentialRef: string, secret: string) => void
  resolveSkillPaths: (workspacePath: string) => string[]
  createAppServerClient?: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
  readCodexPreferences?: () => { useCradleUserAgent: boolean }
}

export interface CodexAppServerBridgeContext {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  workspacePath: string
  workspaceId?: string | null
  agentId?: string | null
  modelId?: string
}

export interface CodexAppServerInvokeInput extends CodexAppServerBridgeContext {
  method: string
  params?: unknown
}

export interface CodexAppServerInvokeResponse {
  method: string
  capability: CodexAppServerMethodCapability
  result: unknown
}

export interface CodexAppServerStreamInput extends CodexAppServerInvokeInput {
  closeOnMethods?: string[]
}

type CodexAppServerBridgeRequestHandler = (
  request: CodexAppServerServerRequest,
  chatgptAuth: CodexChatgptAuthCredential | null,
) => Promise<unknown> | unknown

export function getCodexAppServerCapabilities(): CodexAppServerCapabilityManifest {
  return CODEX_APP_SERVER_CAPABILITIES
}

export class CodexAppServerBridge {
  constructor(private readonly deps: CodexAppServerBridgeDeps) {}

  async invoke(input: CodexAppServerInvokeInput): Promise<CodexAppServerInvokeResponse> {
    const capability = requireCodexAppServerMethod(input.method)
    const hostLease = await this.acquireHostLease(input, input.method, {
      serverRequestHandler: (request, auth) => buildDefaultCodexAppServerRequestResult(request, {
        chatgptAuth: auth,
        updateSecretValue: this.deps.updateSecretValue,
      }),
    })
    const client = hostLease.resource.client
    try {
      const result = await client.request(input.method, normalizeParams(capability, input.params))
      return { method: input.method, capability, result }
    }
    finally {
      hostLease.release()
    }
  }

  openEventStream(input: CodexAppServerStreamInput): ReadableStream<Uint8Array> {
    const capability = requireCodexAppServerMethod(input.method)
    const encoder = new TextEncoder()
    const abortController = new AbortController()
    const closeOnMethods = new Set(input.closeOnMethods ?? defaultCloseMethodsFor(input.method))
    const shouldWaitForNotifications = shouldKeepStreamOpenAfterResult(
      input.method,
      capability,
      closeOnMethods,
      input.closeOnMethods !== undefined,
    )
    let hostLease: CodexAppServerHostLease | null = null
    let unsubscribeNotifications: (() => void) | null = null

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        void (async () => {
          try {
            hostLease = await this.acquireHostLease(input, input.method, {
              serverRequestHandler: async (request, auth) => {
                const result = await buildDefaultCodexAppServerRequestResult(request, {
                  chatgptAuth: auth,
                  updateSecretValue: this.deps.updateSecretValue,
                })
                writeSse(controller, encoder, 'server_request', {
                  method: request.method,
                  id: request.id,
                  params: request.params,
                  input: buildCodexServerRequestToolInput(request),
                  output: buildCodexServerRequestToolOutput(request, result),
                })
                return result
              },
            })
            if (abortController.signal.aborted) {
              return
            }
            const waitForNotifications = new Promise<void>((resolve) => {
              unsubscribeNotifications = subscribeCodexAppServerHostNotifications(
                hostLease!.resource,
                {
                  onMessage: (message) => {
                    if (abortController.signal.aborted) {
                      resolve()
                      return true
                    }
                    writeSse(controller, encoder, 'notification', message)
                    if (message.method && closeOnMethods.has(message.method)) {
                      resolve()
                      return true
                    }
                    return false
                  },
                  onClose: resolve,
                },
              )
            })
            const resultPromise = hostLease.resource.client.request(input.method, normalizeParams(capability, input.params))
            writeSse(controller, encoder, 'request_started', { method: input.method, capability })

            const abortPromise = new Promise<void>((resolve) => {
              if (abortController.signal.aborted) {
                resolve()
                return
              }
              abortController.signal.addEventListener('abort', () => resolve(), { once: true })
            })
            const notificationWait = shouldWaitForNotifications || closeOnMethods.size > 0
              ? waitForNotifications
              : abortPromise

            const result = await resultPromise
            writeSse(controller, encoder, 'result', { method: input.method, result })
            if (shouldWaitForNotifications) {
              await notificationWait.catch(() => undefined)
            }
            else {
              abortController.abort()
              await abortPromise.catch(() => undefined)
            }
            writeDone(controller, encoder)
          }
          catch (error) {
            writeSse(controller, encoder, 'error', {
              message: error instanceof Error ? error.message : String(error),
            })
            writeDone(controller, encoder)
          }
          finally {
            unsubscribeNotifications?.()
            hostLease?.release()
          }
        })()
      },
      cancel: () => {
        abortController.abort()
        unsubscribeNotifications?.()
        hostLease?.release()
      },
    })
  }

  private async acquireHostLease(
    context: CodexAppServerBridgeContext,
    requestedMethod: string,
    options: { serverRequestHandler?: CodexAppServerBridgeRequestHandler } = {},
  ): Promise<CodexAppServerHostLease> {
    const config = readTrustedCodexConfig(context.profile.configJson)
    const auth = resolveCodexAppServerAuth(context.profile, config, 'OPENAI_API_KEY', this.deps)
    const chatgptAuth = readCodexChatgptAuth(auth)
    if (codexConfigRequiresApiKey(config, auth)) {
      throw new Error('Codex app-server bridge requires an API key for external model providers')
    }
    const runtimeContext = resolveCodexRuntimeContext(context.workspacePath, context.agentId)
    const skillExtraRoots = resolveBridgeCodexSkillExtraRoots(config, context.workspacePath, this.deps.resolveSkillPaths)
    const requestHandler: CodexAppServerClientOptions['serverRequestHandler']
      = options.serverRequestHandler
      ? request => options.serverRequestHandler!(request, chatgptAuth)
      : undefined
    const clientOptions: CodexAppServerClientOptions = {
      apiKey: readCodexApiKeyAuth(auth) ?? undefined,
      config: buildBridgeCodexConfig(config, context.workspacePath, this.deps.resolveSkillPaths, context.modelId, auth),
      env: buildCodexAppServerEnv({
        chatSessionId: context.runtimeSession.chatSessionId,
        workspaceId: context.workspaceId,
        workspacePath: context.workspacePath,
        agentId: context.agentId,
        agentHome: runtimeContext.agentHome,
      }, auth),
      serverRequestHandler: requestHandler,
    }
    const hostLease = await acquireCodexAppServerHostLease({
      runtimeKind: context.runtimeSession.runtimeKind,
      providerTargetId: context.profile.providerTargetId,
      scopeId: codexChatSessionAppServerScopeId(context.runtimeSession.chatSessionId),
      options: clientOptions,
      chatgptAuth,
      authenticateChatgpt: !isAccountAuthMutationMethod(requestedMethod),
      deps: {
        createAppServerClient: this.deps.createAppServerClient,
        readCodexPreferences: this.deps.readCodexPreferences,
        updateSecretValue: this.deps.updateSecretValue,
      },
    })
    try {
      await syncBridgeCodexSkillExtraRoots(hostLease.resource.client, skillExtraRoots)
      return hostLease
    }
    catch (error) {
      invalidateCodexAppServerHost(hostLease.hostId)
      hostLease.release()
      throw error
    }
  }
}

function isAccountAuthMutationMethod(method: string): boolean {
  return method === 'account/login/start'
    || method === 'account/login/cancel'
    || method === 'account/logout'
}

function requireCodexAppServerMethod(method: string): CodexAppServerMethodCapability {
  if (!CODEX_APP_SERVER_CLIENT_METHOD_SET.has(method)) {
    throw new Error(`Unsupported Codex app-server method: ${method}`)
  }
  return readCodexAppServerMethodCapability(method)!
}

function normalizeParams(capability: CodexAppServerMethodCapability, params: unknown): unknown {
  return capability.paramsType === null ? undefined : params ?? {}
}

function buildBridgeCodexConfig(
  config: CodexConfig,
  _workspacePath: string,
  _resolveSkillPaths: (workspacePath: string) => string[],
  effectiveModel: string | null | undefined,
  auth: CodexAppServerAuthResolution,
): Record<string, unknown> {
  const mcpServers = buildCodexMcpServersConfig()
  const authMode = resolveCodexAuthMode(config, auth)
  const externalBaseUrl = resolveCodexExternalModelProviderBaseUrl(config)
  return {
    approval_policy: config.approvalPolicy,
    sandbox_mode: config.sandboxMode,
    network_access: 'enabled',
    show_raw_agent_reasoning: true,
    disable_response_storage: true,
    ...(Object.keys(mcpServers).length > 0 ? { mcp_servers: mcpServers } : {}),
    ...(externalBaseUrl
      ? buildCodexExternalModelProviderConfig(externalBaseUrl, authMode)
      : {}),
    ...(auth.kind === 'bedrockApiKey'
      ? buildCodexBedrockModelProviderConfig(auth.region)
      : {}),
    ...(effectiveModel ?? config.model ? { model: effectiveModel ?? config.model } : {}),
  }
}

function defaultCloseMethodsFor(method: string): string[] {
  if (method === 'turn/start') {
    return ['turn/completed']
  }
  if (method === 'process/spawn') {
    return ['process/exited']
  }
  if (method === 'thread/realtime/start') {
    return ['thread/realtime/closed', 'thread/realtime/error']
  }
  if (method.startsWith('fuzzyFileSearch/session')) {
    return ['fuzzyFileSearch/sessionCompleted']
  }
  if (method === 'account/login/start') {
    return ['account/login/completed']
  }
  if (method === 'windowsSandbox/setupStart') {
    return ['windowsSandbox/setupCompleted']
  }
  if (method === 'externalAgentConfig/import') {
    return ['externalAgentConfig/import/completed']
  }
  return []
}

function shouldKeepStreamOpenAfterResult(
  method: string,
  capability: CodexAppServerMethodCapability,
  closeOnMethods: Set<string>,
  hasExplicitClosePolicy: boolean,
): boolean {
  if (capability.interaction !== 'stream') {
    return false
  }
  if (closeOnMethods.size > 0) {
    return true
  }
  if (hasExplicitClosePolicy) {
    return false
  }
  return method === 'fs/watch'
}

function writeSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown,
): void {
  controller.enqueue(encoder.encode(`event: ${event}\n`))
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
}

function writeDone(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder): void {
  controller.enqueue(encoder.encode('event: done\n'))
  controller.enqueue(encoder.encode('data: {}\n\n'))
  controller.close()
}

export async function buildDefaultCodexAppServerRequestResult(
  request: CodexAppServerServerRequest,
  options: {
    chatgptAuth?: CodexChatgptAuthCredential | null
    updateSecretValue?: (credentialRef: string, secret: string) => void
  } = {},
): Promise<unknown> {
  switch (request.method) {
    case 'item/commandExecution/requestApproval':
      return { decision: 'decline' }
    case 'item/fileChange/requestApproval':
      return { decision: 'decline' }
    case 'item/tool/requestUserInput':
      return { answers: {} }
    case 'mcpServer/elicitation/request':
      return { action: 'decline', content: null, _meta: null }
    case 'item/permissions/requestApproval':
      return { permissions: {}, scope: 'turn' }
    case 'item/tool/call':
      return { contentItems: [{ type: 'text', text: 'Cradle Codex app-server bridge does not execute external dynamic tools.' }], success: false }
    case 'account/chatgptAuthTokens/refresh':
      if (!options.chatgptAuth) {
        throw new Error('Cradle Codex app-server bridge cannot refresh ChatGPT auth tokens without a ChatGPT credential')
      }
      return projectChatgptAuthRefreshResponse(await refreshCodexChatgptAuthCredential(options.chatgptAuth, {
        updateSecretValue: options.updateSecretValue,
      }))
    case 'attestation/generate':
      throw new Error('Cradle Codex app-server bridge cannot generate client attestation tokens')
    case 'applyPatchApproval':
      return { decision: 'denied' }
    case 'execCommandApproval':
      return { decision: 'denied' }
    default:
      throw new Error(`Unhandled Codex app-server request: ${request.method}`)
  }
}

function projectChatgptAuthRefreshResponse(credential: CodexChatgptAuthCredential): unknown {
  if (!credential.accessToken) {
    throw new Error('Codex ChatGPT auth refresh did not return an access token')
  }
  return {
    accessToken: credential.accessToken,
    chatgptAccountId: credential.chatgptAccountId,
    chatgptPlanType: credential.chatgptPlanType,
  }
}
