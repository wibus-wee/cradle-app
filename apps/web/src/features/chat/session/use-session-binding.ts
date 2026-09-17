import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'

import { patchSessionsById } from '~/api-gen/sdk.gen'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import {
  applyConfirmedSession,
  applySessionOptimisticPatch,
  readSessionDetailSnapshot,
  rollbackSessionOptimisticPatch,
  sessionDetailOptions,
} from '~/features/session/api/session-projection'

import type { SessionExecution } from './session-execution'
import { readSessionExecution } from './session-execution'
import { readSessionThinkingEffort } from './session-thinking-effort'
import type { SendMessageOptions } from './use-chat-session-types'

export interface ChatSessionBinding {
  sessionId: string
  title: string | null
  workspaceId: string | null
  providerTargetId: string | null
  agentId: string | null
  modelId: string | null
  thinkingEffort: SendMessageOptions['thinkingEffort'] | null
  runtimeKind: RuntimeKind | null
  execution: SessionExecution
}

export type SessionProviderModelPatch = {
  providerTargetId?: string
  modelId?: string | null
  thinkingEffort?: SendMessageOptions['thinkingEffort'] | null
}

interface SessionProviderModelSaveState {
  queue: Promise<void>
  revision: number
  confirmedSession: unknown
}

export function useSessionBinding(
  sessionId: string | null,
  active: boolean,
): ChatSessionBinding | null {
  const query = useQuery({
    ...sessionDetailOptions(sessionId ?? ''),
    enabled: active && !!sessionId,
    staleTime: 60_000,
    select: data => data
      ? {
          sessionId: data.id,
          title: data.title ?? null,
          workspaceId: data.workspaceId ?? null,
          providerTargetId: data.providerTargetId ?? null,
          agentId: data.agentId ?? null,
          modelId: data.modelId ?? null,
          thinkingEffort: readSessionThinkingEffort(data.thinkingEffort),
          runtimeKind: data.runtimeKind ?? null,
          execution: readSessionExecution(data),
        } satisfies ChatSessionBinding
      : null,
  })

  return query.data ?? null
}

export function useSessionProviderModelPersistence(
  sessionId: string,
): (body: SessionProviderModelPatch) => Promise<void> {
  const queryClient = useQueryClient()
  const saveStateRef = useRef<SessionProviderModelSaveState | null>(null)

  return useCallback((body: SessionProviderModelPatch) => {
    const previousSession = readSessionDetailSnapshot(queryClient, sessionId)
    let saveState = saveStateRef.current
    if (!saveState) {
      saveState = {
        queue: Promise.resolve(),
        revision: 0,
        confirmedSession: previousSession,
      }
      saveStateRef.current = saveState
    }

    const revision = saveState.revision + 1
    saveState.revision = revision
    const optimisticPatch = {
      ...('providerTargetId' in body ? { providerTargetId: body.providerTargetId } : {}),
      ...(body.modelId !== undefined ? { modelId: body.modelId } : {}),
      ...(body.thinkingEffort !== undefined ? { thinkingEffort: body.thinkingEffort } : {}),
    }

    applySessionOptimisticPatch(
      queryClient,
      { id: sessionId, ...optimisticPatch },
      { updateDetail: true },
    )

    const saveTask = saveState.queue
      .catch(() => undefined)
      .then(async () => {
        try {
          const { data } = await patchSessionsById({
            path: { id: sessionId },
            body,
          })
          const currentSaveState = saveStateRef.current
          if (data && currentSaveState) {
            currentSaveState.confirmedSession = data
          }
          if (data && currentSaveState?.revision === revision) {
            applyConfirmedSession(queryClient, data)
          }
        }
        catch {
          const currentSaveState = saveStateRef.current
          if (currentSaveState?.revision === revision) {
            rollbackSessionOptimisticPatch(queryClient, {
              sessionId,
              previousSession: currentSaveState.confirmedSession ?? previousSession,
            })
          }
        }
      })

    saveState.queue = saveTask.catch(() => undefined)
    return saveTask
  }, [queryClient, sessionId])
}
