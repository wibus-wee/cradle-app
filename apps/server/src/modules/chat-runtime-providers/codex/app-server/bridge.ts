import type { DeliveryStallWatchdog } from '../../../../infra/sse-event-stream'
import {
  DEFAULT_STREAM_STALL_MS,
  sseStreamPressureCounters,
  startDeliveryStallWatchdog,
} from '../../../../infra/sse-event-stream'
import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../../chat-runtime/runtime-provider-types'
import type { CodexConfig } from '../../../provider-contracts/provider-base'
import { readTrustedCodexConfig } from '../../../provider-contracts/provider-base'
import type { SecretValueWithMetadata } from '../../../secrets/service'
import {
  bindCodexCradleMcpInvocation,
  buildCodexConfig,
  codexConfigRequiresApiKey,
} from '../config/runtime-config'
import { resolveCodexRuntimeContext } from '../config/runtime-context'
import { buildCodexServerRequestToolInput, buildCodexServerRequestToolOutput } from '../tools/mapper'
import { startOrResumeThread, syncCodexSkillExtraRoots } from '../turn/thread-lifecycle'
import type { CodexAppServerClientLike } from '../types'
import type { CodexAppServerCapabilityManifest, CodexAppServerMethodCapability } from './capabilities'
import { CODEX_APP_SERVER_CAPABILITIES, CODEX_APP_SERVER_CLIENT_METHOD_SET, readCodexAppServerMethodCapability } from './capabilities'
import type { CodexChatgptAuthCredential } from './chatgpt-auth'
import {
  readCodexApiKeyAuth,
  readCodexChatgptAuth,
  resolveCodexAppServerAuth,
  resolveFreshCodexChatgptAuthCredential,
} from './chatgpt-auth'
import type { CodexAppServerClientOptions, CodexAppServerServerRequest } from './client'
import { buildCodexAppServerEnv } from './env'
import type { CodexAppServerHostLease } from './host-lease'
import { acquireCodexAppServerHostLease, invalidateCodexAppServerHost } from './host-lease'

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

interface CodexAppServerBridgeDeps {
  readSecret: (credentialRef: string) => string
  readSecretValueWithMetadata?: (credentialRef: string) => SecretValueWithMetadata
  updateSecretValue?: (credentialRef: string, secret: string) => void
  resolveSkillPaths: (workspacePath: string) => string[]
  createAppServerClient?: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
  readCodexPreferences?: () => { useCradleUserAgent: boolean }
  readCodexCliCompatibleIdentity?: () => boolean
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
        readSecret: this.deps.readSecret,
        updateSecretValue: this.deps.updateSecretValue,
      }),
    })
    const client = hostLease.client
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

    // Plan 077: notification frames are buffered through a bounded backlog
    // with the `close` overflow policy. Protocol frames are never dropped
    // silently — under pressure the backlog is replaced by an explicit
    // truncation error plus the terminal done frame, and the host lease is
    // released so the client can simply re-invoke.
    const maxBufferedFrames = 128
    const maxBufferedBytes = 1024 * 1024
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
    let watchdog: DeliveryStallWatchdog | null = null
    let closed = false
    let terminalAfterDrain = false
    let pendingBytes = 0
    const pending: Uint8Array[] = []

    const finish = (closeController: boolean) => {
      if (closed) {
        return
      }
      closed = true
      watchdog?.stop()
      watchdog = null
      pending.length = 0
      pendingBytes = 0
      if (closeController) {
        try {
          controllerRef?.close()
        }
        catch {
        }
      }
    }

    function drain(streamController: ReadableStreamDefaultController<Uint8Array>, pullRequested = false) {
      if (closed) {
        return
      }
      while (
        pending.length > 0
        && (pullRequested || (streamController.desiredSize ?? 0) > 0)
      ) {
        const bytes = pending.shift()!
        pendingBytes -= bytes.byteLength
        streamController.enqueue(bytes)
        watchdog?.touch()
        pullRequested = false
      }
      if (!closed && terminalAfterDrain && pending.length === 0) {
        finish(true)
      }
    }

    const encodeEventFrame = (event: string, data: unknown): Uint8Array => {
      return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const terminateForPressure = () => {
      if (closed || terminalAfterDrain) {
        return
      }
      sseStreamPressureCounters.overflowCloses += 1
      pending.length = 0
      pendingBytes = 0
      for (const bytes of [
        encodeEventFrame('error', { message: 'codex app-server event stream overflowed its delivery buffer; re-invoke the method' }),
        encoder.encode('event: done\ndata: {}\n\n'),
      ]) {
        pending.push(bytes)
        pendingBytes += bytes.byteLength
      }
      terminalAfterDrain = true
      abortController.abort()
      if (controllerRef) {
        drain(controllerRef)
      }
    }

    const pushFrame = (bytes: Uint8Array): void => {
      if (closed || terminalAfterDrain) {
        return
      }
      const byteOver = pendingBytes + bytes.byteLength > maxBufferedBytes && pendingBytes <= maxBufferedBytes
      if (
        pending.length > 0
        && (pending.length + 1 > maxBufferedFrames || byteOver)
      ) {
        terminateForPressure()
        return
      }
      pending.push(bytes)
      pendingBytes += bytes.byteLength
      if (controllerRef) {
        drain(controllerRef)
      }
    }

    const writeSse = (event: string, data: unknown): void => {
      pushFrame(encodeEventFrame(event, data))
    }

    const writeDone = (): void => {
      pushFrame(encoder.encode('event: done\ndata: {}\n\n'))
      // The done frame is the wire-level terminal; once it is queued nothing
      // else may produce, and the stream closes after the backlog drains.
      terminalAfterDrain = true
      if (controllerRef) {
        drain(controllerRef)
      }
    }

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        controllerRef = controller
        watchdog = startDeliveryStallWatchdog({
          stallMs: DEFAULT_STREAM_STALL_MS,
          isClosed: () => closed || terminalAfterDrain,
          isBuffering: () => pending.length > 0,
          onStall: terminateForPressure,
        })
        void (async () => {
          try {
            hostLease = await this.acquireHostLease(input, input.method, {
              serverRequestHandler: async (request, auth) => {
                const result = await buildDefaultCodexAppServerRequestResult(request, {
                  chatgptAuth: auth,
                  readSecret: this.deps.readSecret,
                  updateSecretValue: this.deps.updateSecretValue,
                })
                writeSse('server_request', {
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
            const waitForNotifications = (async () => {
              while (!abortController.signal.aborted) {
                const message = await hostLease!.client.nextNotification(abortController.signal)
                if (!message) {
                  return
                }
                writeSse('notification', message)
                if (message.method && closeOnMethods.has(message.method)) {
                  return
                }
              }
            })()
            const resultPromise = hostLease.client.request(input.method, normalizeParams(capability, input.params))
            writeSse('request_started', { method: input.method, capability })

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
            writeSse('result', { method: input.method, result })
            if (shouldWaitForNotifications) {
              await notificationWait.catch(() => undefined)
            }
            else {
              abortController.abort()
              await abortPromise.catch(() => undefined)
            }
            writeDone()
          }
          catch (error) {
            writeSse('error', {
              message: error instanceof Error ? error.message : String(error),
            })
            writeDone()
          }
          finally {
            hostLease?.release()
          }
        })()
      },
      cancel: () => {
        abortController.abort()
        hostLease?.release()
        finish(false)
      },
      pull: (streamController) => {
        drain(streamController, true)
      },
    })
  }

  private async acquireHostLease(
    context: CodexAppServerInvokeInput,
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
    const appServerEnvironment = buildCodexAppServerEnv({
      chatSessionId: context.runtimeSession.chatSessionId,
      workspaceId: context.workspaceId,
      workspacePath: context.workspacePath,
      agentId: context.agentId,
      agentHome: runtimeContext.agentHome,
    }, auth)
    const threadConfig = bindCodexCradleMcpInvocation(
      buildCodexConfig(config, context.workspacePath, this.deps.resolveSkillPaths, context.modelId, auth),
      appServerEnvironment,
    )
    const clientOptions: CodexAppServerClientOptions = {
      apiKey: readCodexApiKeyAuth(auth) ?? undefined,
      config: threadConfig,
      env: appServerEnvironment,
      serverRequestHandler: requestHandler,
    }
    const hostLease = await acquireCodexAppServerHostLease({
      runtimeKind: context.runtimeSession.runtimeKind,
      providerTargetId: context.profile.providerTargetId,
      options: clientOptions,
      chatgptAuth,
      readThreadId: () => readBridgeRequestThreadId(context.params),
      authenticateChatgpt: !isAccountAuthMutationMethod(requestedMethod),
      deps: {
        readSecret: this.deps.readSecret,
        createAppServerClient: this.deps.createAppServerClient,
        readCodexPreferences: this.deps.readCodexPreferences,
        readCodexCliCompatibleIdentity: this.deps.readCodexCliCompatibleIdentity,
        updateSecretValue: this.deps.updateSecretValue,
      },
    })
    try {
      await syncCodexSkillExtraRoots(hostLease.resource, skillExtraRoots)
      const requestedThreadId = readBridgeRequestThreadId(context.params)
      if (
        requestedThreadId
        && requestedThreadId === context.runtimeSession.providerSessionId
        && requestedMethod !== 'thread/resume'
      ) {
        await startOrResumeThread(hostLease.client, hostLease.resource, context.runtimeSession, {
          model: context.modelId ?? config.model,
          cwd: runtimeContext.cwd,
          runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
          approvalPolicy: config.approvalPolicy,
          sandbox: config.sandboxMode,
          config: threadConfig,
        })
      }
      return hostLease
    }
    catch (error) {
      await invalidateCodexAppServerHost(hostLease.hostId)
      hostLease.release()
      throw error
    }
  }
}

function readBridgeRequestThreadId(params: unknown): string | null {
  if (!params || typeof params !== 'object' || !('threadId' in params)) {
    return null
  }
  const threadId = (params as { threadId?: unknown }).threadId
  return typeof threadId === 'string' ? threadId : null
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

export async function buildDefaultCodexAppServerRequestResult(
  request: CodexAppServerServerRequest,
  options: {
    chatgptAuth?: CodexChatgptAuthCredential | null
    readSecret?: (credentialRef: string) => string
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
      if (!options.readSecret || !options.updateSecretValue) {
        throw new Error('Cradle Codex app-server bridge cannot refresh ChatGPT auth tokens without a credential lifecycle store')
      }
      return projectChatgptAuthRefreshResponse(await resolveFreshCodexChatgptAuthCredential({
        credentialRef: options.chatgptAuth.credentialRef,
        store: { readSecret: options.readSecret, updateSecretValue: options.updateSecretValue },
        forceRefresh: true,
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
