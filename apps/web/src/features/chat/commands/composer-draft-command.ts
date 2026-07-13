// Chat-owned command boundary for server-authoritative composer drafts.
import {
  deleteChatComposerDraftsBySurfaceId,
  getChatComposerDraftsBySurfaceId,
  putChatComposerDraftsBySurfaceId,
} from '~/api-gen/sdk.gen'
import type {
  DeleteChatComposerDraftsBySurfaceIdResponse,
  GetChatComposerDraftsBySurfaceIdResponse,
  PutChatComposerDraftsBySurfaceIdResponse,
} from '~/api-gen/types.gen'
import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'
import type { ComposerDraft } from '~/store/composer-draft'

export interface ComposerDraftServerState {
  surfaceId: string
  draft: ComposerDraft | null
  revision: number
  updatedAt: number | null
  deletedAt: number | null
}

type ComposerDraftApiResponse
  = | DeleteChatComposerDraftsBySurfaceIdResponse
    | GetChatComposerDraftsBySurfaceIdResponse
    | PutChatComposerDraftsBySurfaceIdResponse

const discardedSurfaceIds = new Set<string>()
const serverDraftQueues = new Map<string, Promise<void>>()

export function activateComposerDraftSurface(surfaceId: string): void {
  discardedSurfaceIds.delete(surfaceId)
}

export function markComposerDraftSurfaceDiscarded(surfaceId: string): void {
  discardedSurfaceIds.add(surfaceId)
}

export async function readServerComposerDraft(
  surfaceId: string,
  signal?: AbortSignal,
): Promise<ComposerDraftServerState> {
  const { data } = await getChatComposerDraftsBySurfaceId({
    path: { surfaceId },
    signal,
    throwOnError: true,
  })

  return projectComposerDraftResponse(data)
}

export async function writeServerComposerDraft(
  surfaceId: string,
  draft: ComposerDraft,
): Promise<ComposerDraftServerState> {
  const { data } = await putChatComposerDraftsBySurfaceId({
    path: { surfaceId },
    body: { draft },
    throwOnError: true,
  })

  return projectComposerDraftResponse(data)
}

export async function deleteServerComposerDraft(
  surfaceId: string,
): Promise<ComposerDraftServerState> {
  const { data } = await deleteChatComposerDraftsBySurfaceId({
    path: { surfaceId },
    throwOnError: true,
  })

  return projectComposerDraftResponse(data)
}

export function queueServerComposerDraftWrite(surfaceId: string, draft: ComposerDraft): void {
  if (discardedSurfaceIds.has(surfaceId)) {
    return
  }

  appendServerDraftOperation(surfaceId, async () => {
    if (discardedSurfaceIds.has(surfaceId)) {
      return
    }
    await writeServerComposerDraft(surfaceId, draft)
  })
}

export function queueServerComposerDraftDelete(surfaceId: string): void {
  appendServerDraftOperation(surfaceId, async () => {
    await deleteServerComposerDraft(surfaceId)
  })
}

export function flushComposerDraftServerQueue(surfaceId: string): Promise<void> {
  return serverDraftQueues.get(surfaceId) ?? Promise.resolve()
}

function appendServerDraftOperation(surfaceId: string, operation: () => Promise<void>): void {
  const previous = serverDraftQueues.get(surfaceId) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(operation)
    .catch(() => undefined)

  serverDraftQueues.set(surfaceId, next)
  void next.finally(() => {
    if (serverDraftQueues.get(surfaceId) === next) {
      serverDraftQueues.delete(surfaceId)
    }
  })
}

function projectComposerDraftResponse(
  response: ComposerDraftApiResponse,
): ComposerDraftServerState {
  return {
    surfaceId: response.surfaceId,
    draft: response.draft
      ? {
          text: response.draft.text,
          contextParts: response.draft.contextParts as ChatContextPart[],
          files: (response.draft.files ?? []) as ComposerDraft['files'],
          pastedTexts: (response.draft.pastedTexts ?? []) as ComposerDraft['pastedTexts'],
        }
      : null,
    revision: response.revision,
    updatedAt: response.updatedAt,
    deletedAt: response.deletedAt,
  }
}
