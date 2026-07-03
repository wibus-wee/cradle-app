import type { RuntimeCatalogItem } from '~/features/agent-runtime/runtime-catalog'
import { runtimeCatalogItemHasSlotId } from '~/features/agent-runtime/runtime-catalog'

const CODEX_GOAL_SLOT_ID = 'codex:goal'
const CODEX_PLUGIN_SLOT_ID = 'codex:plugin'

type RuntimeSlotCatalog = Pick<RuntimeCatalogItem, 'slots'> | null | undefined

export function runtimeSupportsCodexGoalBridge(runtime: RuntimeSlotCatalog): boolean {
  return runtimeCatalogItemHasSlotId(runtime, CODEX_GOAL_SLOT_ID, 'slashCommand')
}

export function runtimeSupportsCodexPluginMentions(runtime: RuntimeSlotCatalog): boolean {
  return runtimeCatalogItemHasSlotId(runtime, CODEX_PLUGIN_SLOT_ID)
}

async function loadCodexAppServerSdk() {
  return import('~/api-gen/sdk.gen')
}

export async function loadCodexInstalledPluginResult(input: {
  sessionId: string
  providerTargetId?: string | null
  modelId?: string | null
  signal?: AbortSignal
}): Promise<unknown> {
  const { postChatSessionsBySessionIdCodexAppServerInvoke } = await loadCodexAppServerSdk()
  const { data } = await postChatSessionsBySessionIdCodexAppServerInvoke({
    path: { sessionId: input.sessionId },
    body: {
      method: 'plugin/installed',
      params: {},
      providerTargetId: input.providerTargetId ?? undefined,
      modelId: input.modelId ?? undefined,
    },
    signal: input.signal,
  })
  return data?.result
}

export async function setCodexThreadGoal(input: {
  sessionId: string
  threadId: string
  objective?: string
  status?: string
  providerTargetId?: string | null
  modelId?: string | null
}): Promise<void> {
  const { postChatSessionsBySessionIdCodexAppServerInvoke } = await loadCodexAppServerSdk()
  await postChatSessionsBySessionIdCodexAppServerInvoke({
    path: { sessionId: input.sessionId },
    body: {
      method: 'thread/goal/set',
      params: {
        threadId: input.threadId,
        ...(input.objective !== undefined ? { objective: input.objective } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      providerTargetId: input.providerTargetId ?? undefined,
      modelId: input.modelId ?? undefined,
    },
    throwOnError: true,
  })
}

export async function clearCodexThreadGoal(input: {
  sessionId: string
  threadId: string
}): Promise<void> {
  const { postChatSessionsBySessionIdCodexAppServerInvoke } = await loadCodexAppServerSdk()
  await postChatSessionsBySessionIdCodexAppServerInvoke({
    path: { sessionId: input.sessionId },
    body: {
      method: 'thread/goal/clear',
      params: {
        threadId: input.threadId,
      },
    },
    throwOnError: true,
  })
}
