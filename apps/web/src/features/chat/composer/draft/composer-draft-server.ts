// Server-authoritative composer draft adapter over the generated API client.
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

import type { ComposerDraft } from './composer-draft-store'
import { toPersistedComposerDraft } from './composer-draft-store'

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
    // Attachments never enter the server draft JSON; the wire schema keeps the
    // field but the payload stays text + context parts + pasted texts.
    body: { draft: toPersistedComposerDraft(draft) },
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
