import type { RuntimeKind } from '../../../provider-contracts/types'
import type { ProviderProcessHostLease } from '../../kit/process-host'
import {
  acquireProviderProcessHostResource,
  invalidateProviderProcessHostResource,
  registerProcessHostLeaseCleanup,
} from '../../kit/process-host'
import type {
  CodexAppServerClientLike,
  CodexAppServerHostResource,
} from '../types'
import type { CodexChatgptAuthCredential } from './chatgpt-auth'
import {
  buildCodexChatgptAuthLoginParams,
  CodexChatgptAuthReauthRequiredError,
  ensureCodexChatgptAuthAccessToken,
} from './chatgpt-auth'
import type { CodexAppServerClientOptions } from './client'
import { CodexAppServerClient } from './client'
import { createCodexAppServerHostFingerprint } from './host-fingerprint'
import {
  addCodexAppServerHostRequestHandler,
  createCodexAppServerHostResource,
} from './host-resource'

export interface CodexAppServerHostLeaseDeps {
  createAppServerClient?: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
  readCodexPreferences?: () => { useCradleUserAgent: boolean }
  readCodexCliCompatibleIdentity?: () => boolean
  updateSecretValue?: (credentialRef: string, secret: string) => void
  mapChatgptAuthError?: (error: CodexChatgptAuthReauthRequiredError) => Error
}

export interface AcquireCodexAppServerHostLeaseInput {
  runtimeKind: RuntimeKind
  providerTargetId: string
  scopeId: string
  options: CodexAppServerClientOptions
  chatgptAuth: CodexChatgptAuthCredential | null
  deps: CodexAppServerHostLeaseDeps
  authenticateChatgpt?: boolean
  pinned?: boolean
}

export type CodexAppServerHostLease = ProviderProcessHostLease<CodexAppServerHostResource>

export function codexChatSessionAppServerScopeId(chatSessionId: string): string {
  return `chat-session:${chatSessionId}`
}

export function codexProviderTargetDiagnosticsAppServerScopeId(providerTargetId: string): string {
  return `provider-target-diagnostics:${providerTargetId}`
}

export async function acquireCodexAppServerHostLease(
  input: AcquireCodexAppServerHostLeaseInput,
): Promise<CodexAppServerHostLease> {
  const clientOptions = configureCodexAppServerClientOptions(input.options, input.deps)
  const { serverRequestHandler, ...hostClientOptions } = clientOptions
  const lease = await acquireProviderProcessHostResource({
    runtimeKind: input.runtimeKind,
    providerTargetId: input.providerTargetId,
    scopeId: input.scopeId,
    pinned: input.pinned ?? false,
    resourceFingerprint: createCodexAppServerHostFingerprint({
      options: hostClientOptions,
      chatgptAuth: input.chatgptAuth,
    }),
    createResource: (): CodexAppServerHostResource => createCodexAppServerHostResource({
      clientOptions: hostClientOptions,
      createClient: options => input.deps.createAppServerClient?.(options) ?? new CodexAppServerClient(options),
    }),
    disposeResource: resource => resource.client.close(),
  })
  const releaseRequestHandler = serverRequestHandler
    ? addCodexAppServerHostRequestHandler(lease.resource, serverRequestHandler)
    : () => undefined
  registerProcessHostLeaseCleanup(lease, () => {
    releaseRequestHandler()
  })

  try {
    await initializeCodexAppServerHost(lease.resource, {
      chatgptAuth: input.chatgptAuth,
      updateSecretValue: input.deps.updateSecretValue,
      authenticateChatgpt: input.authenticateChatgpt ?? true,
      mapChatgptAuthError: input.deps.mapChatgptAuthError,
    })
    return lease
  }
  catch (error) {
    await invalidateProviderProcessHostResource(lease.hostId)
    lease.release()
    throw error
  }
}

export function invalidateCodexAppServerHost(hostId: string): Promise<void> {
  return invalidateProviderProcessHostResource(hostId)
}

function configureCodexAppServerClientOptions(
  options: CodexAppServerClientOptions,
  deps: Pick<CodexAppServerHostLeaseDeps, 'readCodexPreferences' | 'readCodexCliCompatibleIdentity'>,
): CodexAppServerClientOptions {
  const userAgentMode = deps.readCodexPreferences?.().useCradleUserAgent === false ? 'native' : 'cradle'
  const cliCompatibleIdentity = deps.readCodexCliCompatibleIdentity?.() ?? false
  return { ...options, userAgentMode, cliCompatibleIdentity } satisfies CodexAppServerClientOptions
}

async function initializeCodexAppServerHost(
  resource: CodexAppServerHostResource,
  input: {
    chatgptAuth: CodexChatgptAuthCredential | null
    updateSecretValue?: (credentialRef: string, secret: string) => void
    authenticateChatgpt: boolean
    mapChatgptAuthError?: (error: CodexChatgptAuthReauthRequiredError) => Error
  },
): Promise<void> {
  resource.initialized ??= resource.client.initialize()
  await resource.initialized
  if (!input.chatgptAuth || !input.authenticateChatgpt) {
    return
  }
  const chatgptAuth = input.chatgptAuth
  resource.chatgptAuthenticated ??= authenticateCodexAppServerChatgpt(resource.client, {
    chatgptAuth,
    updateSecretValue: input.updateSecretValue,
    mapChatgptAuthError: input.mapChatgptAuthError,
  })
  await resource.chatgptAuthenticated
}

async function authenticateCodexAppServerChatgpt(
  client: CodexAppServerClientLike,
  input: {
    chatgptAuth: CodexChatgptAuthCredential
    updateSecretValue?: (credentialRef: string, secret: string) => void
    mapChatgptAuthError?: (error: CodexChatgptAuthReauthRequiredError) => Error
  },
): Promise<void> {
  try {
    const credential = await ensureCodexChatgptAuthAccessToken(input.chatgptAuth, {
      updateSecretValue: input.updateSecretValue,
    })
    await client.request('account/login/start', buildCodexChatgptAuthLoginParams(credential))
  }
  catch (error) {
    if (error instanceof CodexChatgptAuthReauthRequiredError && input.mapChatgptAuthError) {
      throw input.mapChatgptAuthError(error)
    }
    throw error
  }
}
