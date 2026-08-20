import type { UIMessage } from 'ai'

import type {
  RuntimeHarnessFragment,
  RuntimeSession,
} from '../../../chat-runtime/runtime-provider-types'
import type { CodexConfig } from '../../../provider-contracts/provider-base'
import { isCodexAppServerUnknownMethodError } from '../app-server/client'
import type { ThreadForkParams } from '../app-server-protocol/v2/ThreadForkParams'
import type { ThreadInjectItemsParams } from '../app-server-protocol/v2/ThreadInjectItemsParams'
import { readCodexProviderSnapshot } from '../projection/state-projector'
import { codexRequestError, formatUnknownError } from '../provider-errors'
import type {
  CodexAppServerClientLike,
  CodexAppServerHostResource,
  CodexThreadStatus,
  ThreadResponse,
} from '../types'
import { readCodexThreadDisplayTitle } from './stream-diagnostics'
import { projectCradleTranscriptToCodexItems } from './transcript-projector'

const CODEX_SIDE_BOUNDARY_PROMPT = [
  'You are in a Cradle side conversation.',
  '',
  'Cradle owns this side boundary: this child session grows from the parent conversation context, but it is a separate workspace for exploration. Use the inherited context as background, do not treat the side conversation as a continuation that should mutate the parent transcript, and keep any conclusions local until the user explicitly carries them back.',
].join('\n')

export interface CodexThreadStart {
  threadId: string
  title: string | null
  modelId: string | null
  modelProvider: string | null
  serviceTier: string | null
  reasoningEffort: string | null
  status: CodexThreadStatus | null
}

export async function requestCodexAppServerWithTimeout<T>(
  client: CodexAppServerClientLike,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([
      client.request(method, params),
      timeoutPromise,
    ]) as T
  }
  finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export async function syncCodexSkillExtraRoots(
  resource: CodexAppServerHostResource,
  extraRoots: string[],
): Promise<void> {
  const previousSize = resource.skillExtraRoots.size
  for (const root of extraRoots) {
    resource.skillExtraRoots.add(root)
  }
  if (resource.skillExtraRootsUnsupported) {
    return
  }
  if (resource.skillExtraRoots.size === previousSize) {
    await resource.skillExtraRootsSync
    return
  }

  const roots = [...resource.skillExtraRoots].sort()
  const previousSync = resource.skillExtraRootsSync ?? Promise.resolve()
  const sync = previousSync.then(async () => {
    if (resource.skillExtraRootsUnsupported) {
      return
    }
    try {
      await resource.client.request('skills/extraRoots/set', { extraRoots: roots })
    }
    catch (error) {
      if (isCodexAppServerUnknownMethodError(error, 'skills/extraRoots/set')) {
        resource.skillExtraRootsUnsupported = true
        return
      }
      throw codexRequestError('skills/extraRoots/set', formatUnknownError(error))
    }
  })
  resource.skillExtraRootsSync = sync
  await sync
}

export function markCodexThreadLoaded(
  resource: CodexAppServerHostResource,
  threadId: string,
): void {
  resource.loadedThreadIds.add(threadId)
}

export function isLiveCodexSideFork(runtimeSession: RuntimeSession): boolean {
  if (!runtimeSession.providerSessionId) {
    return false
  }
  const sideConversation = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.sideConversation
  return sideConversation?.liveFork === true
    && sideConversation.threadId === runtimeSession.providerSessionId
}

export function readLiveSideForkThreadStart(
  runtimeSession: RuntimeSession,
  fallbackModelId?: string | null,
): CodexThreadStart {
  if (!runtimeSession.providerSessionId) {
    throw codexRequestError('liveSideFork', 'Codex side conversation is missing a live thread id')
  }
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  return {
    threadId: runtimeSession.providerSessionId,
    title: null,
    modelId: snapshot.codex?.model?.modelId ?? fallbackModelId ?? snapshot.models?.currentModelId ?? null,
    modelProvider: snapshot.codex?.model?.modelProvider ?? null,
    serviceTier: snapshot.codex?.model?.serviceTier ?? null,
    reasoningEffort: snapshot.codex?.reasoning?.effort ?? null,
    status: snapshot.codex?.status?.status ?? null,
  }
}

export async function startOrResumeThread(
  client: CodexAppServerClientLike,
  resource: CodexAppServerHostResource,
  runtimeSession: RuntimeSession,
  params: {
    model?: string | null
    serviceTier?: string | null
    cwd: string
    runtimeWorkspaceRoots: string[]
    approvalPolicy: CodexConfig['approvalPolicy']
    sandbox: CodexConfig['sandboxMode']
    config: NonNullable<ThreadForkParams['config']>
    developerInstructions?: string | null
    requestTimeoutMs?: number
  },
): Promise<CodexThreadStart> {
  const baseParams = {
    model: params.model,
    ...(params.serviceTier ? { serviceTier: params.serviceTier } : {}),
    cwd: params.cwd,
    runtimeWorkspaceRoots: params.runtimeWorkspaceRoots,
    approvalPolicy: params.approvalPolicy,
    sandbox: params.sandbox,
    config: params.config,
    ...(params.developerInstructions ? { developerInstructions: params.developerInstructions } : {}),
  }
  const method = runtimeSession.providerSessionId ? 'thread/resume' : 'thread/start'
  const requestParams = runtimeSession.providerSessionId
    ? { ...baseParams, threadId: runtimeSession.providerSessionId, excludeTurns: true }
    : { ...baseParams, experimentalRawEvents: true }
  if (runtimeSession.providerSessionId && resource.loadedThreadIds.has(runtimeSession.providerSessionId)) {
    return readLiveSideForkThreadStart(runtimeSession, params.model)
  }

  let response: ThreadResponse
  try {
    const existingThreadId = runtimeSession.providerSessionId
    if (existingThreadId) {
      const existingBind = resource.threadBindPromises.get(existingThreadId)
      if (existingBind) {
        response = await existingBind
      }
      else {
        const bind = params.requestTimeoutMs
          ? requestCodexAppServerWithTimeout<ThreadResponse>(client, method, requestParams, params.requestTimeoutMs)
          : client.request(method, requestParams) as Promise<ThreadResponse>
        resource.threadBindPromises.set(existingThreadId, bind)
        try {
          response = await bind
          resource.loadedThreadIds.add(existingThreadId)
        }
        finally {
          resource.threadBindPromises.delete(existingThreadId)
        }
      }
    }
    else {
      response = params.requestTimeoutMs
        ? await requestCodexAppServerWithTimeout<ThreadResponse>(client, method, requestParams, params.requestTimeoutMs)
        : await client.request(method, requestParams) as ThreadResponse
    }
  }
  catch (error) {
    throw codexRequestError(method, formatUnknownError(error))
  }
  const threadId = response.thread?.id
  if (!threadId) {
    throw codexRequestError('startOrResumeCodexThread', 'Codex app-server did not return a thread id')
  }
  resource.loadedThreadIds.add(threadId)
  return {
    threadId,
    title: readCodexThreadDisplayTitle(response.thread),
    modelId: response.model ?? null,
    modelProvider: response.modelProvider ?? response.thread?.modelProvider ?? null,
    serviceTier: response.serviceTier ?? null,
    reasoningEffort: response.reasoningEffort ?? null,
    status: response.thread?.status ?? null,
  }
}

export async function injectCradleTranscriptHistory(
  client: CodexAppServerClientLike,
  threadId: string,
  history: UIMessage[] | undefined,
): Promise<void> {
  if (!history?.length) {
    return
  }

  const items = projectCradleTranscriptToCodexItems(history)
  if (items.length === 0) {
    return
  }

  const params: ThreadInjectItemsParams = {
    threadId,
    items: items as ThreadInjectItemsParams['items'],
  }
  await client.request('thread/inject_items', params)
}

export async function injectCodexHarnessFragments(
  client: CodexAppServerClientLike,
  threadId: string,
  fragments: RuntimeHarnessFragment[],
): Promise<void> {
  if (fragments.length === 0) {
    return
  }

  const params: ThreadInjectItemsParams = {
    threadId,
    items: fragments.map(fragment => ({
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: fragment.content }],
    })) as ThreadInjectItemsParams['items'],
  }
  await client.request('thread/inject_items', params)
}

export async function injectCodexSideBoundary(
  client: CodexAppServerClientLike,
  threadId: string,
): Promise<void> {
  const params: ThreadInjectItemsParams = {
    threadId,
    items: [{
      type: 'message',
      role: 'user',
      content: [{
        type: 'input_text',
        text: CODEX_SIDE_BOUNDARY_PROMPT,
      }],
    }],
  }
  await client.request('thread/inject_items', params)
}
