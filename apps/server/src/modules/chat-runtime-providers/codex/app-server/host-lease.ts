import { resolve } from 'node:path'

import type { RuntimeKind } from '../../../provider-contracts/types'
import type { ProviderProcessHostLease } from '../../kit/process-host'
import {
  acquireProviderProcessHostResource,
  collectProviderProcessHostResources,
  invalidateProviderProcessHostResource,
  listProviderProcessHosts,
  registerProcessHostLeaseCleanup,
} from '../../kit/process-host'
import { CODEX_RUNTIME_KIND } from '../metadata'
import type {
  CodexAppServerClientLike,
  CodexAppServerHostResource,
} from '../types'
import type { CodexChatgptAuthCredential } from './chatgpt-auth'
import {
  buildCodexChatgptAuthLoginParams,
  CodexChatgptAuthReauthRequiredError,
  resolveFreshCodexChatgptAuthCredential,
} from './chatgpt-auth'
import type { CodexAppServerClientOptions } from './client'
import { CodexAppServerClient } from './client'
import { createCodexAppServerHostFingerprint } from './host-fingerprint'
import {
  addCodexAppServerHostRequestHandler,
  createCodexAppServerHostResource,
  createCodexAppServerLeaseClient,
  disposeCodexAppServerHostResource,
} from './host-resource'
import { projectCodexProcessConfig } from './process-config'

const CODEX_APP_SERVER_SCOPE_ID = 'provider-host'
export const CODEX_APP_SERVER_IDLE_TTL_MS = 30 * 60 * 1000

export interface CodexAppServerHostLeaseDeps {
  readSecret: (credentialRef: string) => string
  createAppServerClient?: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
  readCodexPreferences?: () => { useCradleUserAgent: boolean }
  readCodexCliCompatibleIdentity?: () => boolean
  updateSecretValue?: (credentialRef: string, secret: string) => void
  mapChatgptAuthError?: (error: CodexChatgptAuthReauthRequiredError) => Error
}

export interface AcquireCodexAppServerHostLeaseInput {
  runtimeKind: RuntimeKind
  providerTargetId: string
  options: CodexAppServerClientOptions
  chatgptAuth: CodexChatgptAuthCredential | null
  deps: CodexAppServerHostLeaseDeps
  authenticateChatgpt?: boolean
  pinned?: boolean
  readThreadId?: () => string | null
}

export type CodexAppServerHostLease = ProviderProcessHostLease<CodexAppServerHostResource> & {
  client: CodexAppServerClientLike
}

export function codexProviderAppServerScopeId(): string {
  return CODEX_APP_SERVER_SCOPE_ID
}

export async function acquireCodexAppServerHostLease(
  input: AcquireCodexAppServerHostLeaseInput,
): Promise<CodexAppServerHostLease> {
  const clientOptions = configureCodexAppServerClientOptions(input.options, input.deps)
  const { serverRequestHandler, ...hostClientOptions } = clientOptions
  const processClientOptions = sanitizeCodexAppServerProcessOptions(hostClientOptions)
  const resourceFingerprint = createCodexAppServerHostFingerprint({
    options: processClientOptions,
    chatgptAuth: input.chatgptAuth,
  })
  const lease = await acquireProviderProcessHostResource({
    runtimeKind: input.runtimeKind,
    providerTargetId: input.providerTargetId,
    scopeId: `${codexProviderAppServerScopeId()}:${resourceFingerprint}`,
    ttlMs: CODEX_APP_SERVER_IDLE_TTL_MS,
    pinned: input.pinned ?? false,
    retainOnRelease: true,
    resourceFingerprint,
    createResource: (): CodexAppServerHostResource => createCodexAppServerHostResource({
      clientOptions: processClientOptions,
      createClient: options => input.deps.createAppServerClient?.(options) ?? new CodexAppServerClient(options),
    }),
    disposeResource: disposeCodexAppServerHostResource,
  })
  lease.resource.onTerminated = () => {
    void invalidateProviderProcessHostResource(lease.hostId, lease.resource)
  }
  let inferredThreadId: string | null = null
  const releaseRequestHandler = serverRequestHandler
    ? addCodexAppServerHostRequestHandler(lease.resource, Object.assign(serverRequestHandler, {
        readThreadId: () => inferredThreadId ?? input.readThreadId?.() ?? null,
      }))
    : () => undefined
  const client = createCodexAppServerLeaseClient(
    lease.resource,
    () => inferredThreadId ?? input.readThreadId?.() ?? null,
    (threadId) => {
      inferredThreadId = threadId
      lease.resource.loadedThreadIds.add(threadId)
    },
  )
  registerProcessHostLeaseCleanup(lease, () => {
    releaseRequestHandler()
    void client.close()
  })

  try {
    await initializeCodexAppServerHost(lease.resource, {
      chatgptAuth: input.chatgptAuth,
      readSecret: input.deps.readSecret,
      updateSecretValue: input.deps.updateSecretValue,
      authenticateChatgpt: input.authenticateChatgpt ?? true,
      mapChatgptAuthError: input.deps.mapChatgptAuthError,
    })
    return Object.assign(lease, { client })
  }
  catch (error) {
    await invalidateProviderProcessHostResource(lease.hostId)
    lease.release()
    throw error
  }
}

function sanitizeCodexAppServerProcessOptions(
  options: CodexAppServerClientOptions,
): CodexAppServerClientOptions {
  const config = projectCodexProcessConfig(options.config)
  const env = { ...options.env }
  delete env.CRADLE_CHAT_SESSION_ID
  delete env.CRADLE_WORKSPACE_ID
  delete env.CRADLE_WORKSPACE_PATH
  delete env.CRADLE_AGENT_ID
  delete env.CRADLE_AGENT_HOME
  return {
    ...options,
    ...(config && Object.keys(config).length > 0 ? { config } : { config: undefined }),
    env,
  }
}

export function invalidateCodexAppServerHost(hostId: string): Promise<void> {
  return invalidateProviderProcessHostResource(hostId)
}

/**
 * Drain pooled app-server hosts that launched the given executable so the
 * managed install can be removed. Actively leased hosts (or hosts still
 * spawning, which cannot report their executable yet) refuse removal —
 * mirrors the opencode runtime pool's preparePathForRemoval contract.
 */
export async function prepareCodexManagedPathForRemoval(binaryPath: string): Promise<boolean> {
  const target = resolve(binaryPath)
  const appServerScopePrefix = `${CODEX_APP_SERVER_SCOPE_ID}:`

  const stillSpawning = listProviderProcessHosts().some(entry =>
    entry.runtimeKind === CODEX_RUNTIME_KIND
    && entry.scopeId.startsWith(appServerScopePrefix)
    && entry.spawning)
  if (stillSpawning) {
    return false
  }

  const matching = collectProviderProcessHostResources(
    CODEX_RUNTIME_KIND,
    (resource, entry) => {
      const executable = (resource as CodexAppServerHostResource).client.executablePath
      return executable && resolve(executable) === target ? { entry, resource } : undefined
    },
  )
  if (matching.some(({ entry }) => entry.refCount > 0)) {
    return false
  }
  await Promise.all(matching.map(({ entry, resource }) =>
    invalidateProviderProcessHostResource(entry.hostId, resource)))
  return true
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
    readSecret: (credentialRef: string) => string
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
    readSecret: input.readSecret,
    updateSecretValue: input.updateSecretValue,
    mapChatgptAuthError: input.mapChatgptAuthError,
  })
  await resource.chatgptAuthenticated
}

async function authenticateCodexAppServerChatgpt(
  client: CodexAppServerClientLike,
  input: {
    chatgptAuth: CodexChatgptAuthCredential
    readSecret: (credentialRef: string) => string
    updateSecretValue?: (credentialRef: string, secret: string) => void
    mapChatgptAuthError?: (error: CodexChatgptAuthReauthRequiredError) => Error
  },
): Promise<void> {
  try {
    const credential = await resolveFreshCodexChatgptAuthCredential({
      credentialRef: input.chatgptAuth.credentialRef,
      store: {
        readSecret: input.readSecret,
        updateSecretValue: input.updateSecretValue ?? missingCredentialLifecycleStore,
      },
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

function missingCredentialLifecycleStore(): never {
  throw new Error('Codex ChatGPT auth requires a credential lifecycle store')
}
