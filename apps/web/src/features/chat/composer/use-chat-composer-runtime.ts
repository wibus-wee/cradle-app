import { useQuery } from '@tanstack/react-query'
import type { FileUIPart } from 'ai'
import { useCallback, useMemo } from 'react'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import type { ModelDescriptor } from '~/features/agent-runtime/types'
import { useProviderTargetModels } from '~/features/agent-runtime/use-agent-models'
import { useGitRepositories } from '~/features/git/use-git'
import { useChatPreferencesQuery } from '~/features/settings/use-chat-preferences'
import { isElectron, platform } from '~/lib/electron'
import {
  ChatRuntimeUiSlot,
  ChatRuntimeUiSlotState,
  ChatRuntimeCompactUiSlotState,
  runtimeCapabilitiesQueryKey,
  getChatRuntimeCapabilities,
  runtimeUiSlotStatesQueryKey,
  getChatRuntimeUiSlotStates
} from '../capabilities/chat-capabilities'
import { ChatContextPart } from '../context/chat-context-parts'
import { SendMessageOptions, SendMessageResult } from '../session/use-chat-session'
import {
  ChatComposerSlashCommand,
  withSlashCommandAvailability,
  CRADLE_APPSHOT_SLASH_COMMAND,
  CRADLE_SIDE_CHAT_SLASH_COMMAND,
  CODEX_USAGE_SLASH_ACTION_ID,
  projectRuntimeComposerSlashCommands
} from '../slash-commands/chat-slash-commands'
import { modelSupportsAttachments } from './composer-attachment-state'

interface ChatComposerSendOverrides {
  providerTargetId?: string
  modelId?: string | null
  thinkingEffort?: SendMessageOptions['thinkingEffort']
}

export interface ChatComposerRuntime {
  disabled: boolean
  isStreaming: boolean
  send: (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
    options?: {
      invertContinuationMode?: boolean
      runtimeSettings?: SendMessageOptions['runtimeSettings']
    }
  ) => SendMessageResult | Promise<SendMessageResult>
  stop: () => void
  slashCommands: ChatComposerSlashCommand[]
  uiSlots: ChatRuntimeUiSlot[]
  slotStates: ChatRuntimeUiSlotState[]
  supportsAttachments: boolean
  tokenUsage: null | {
    tokens: number
    contextWindow: number
  }
  compactState: ChatRuntimeCompactUiSlotState | null
}

interface UseChatComposerRuntimeOptions {
  active?: boolean
  sessionId: string | null
  isStreaming: boolean
  isReady: boolean
  workspaceId?: string | null
  composerModel?: ModelDescriptor | null
  runtimeSettings?: SendMessageOptions['runtimeSettings']
  sendOverridesRef?: React.MutableRefObject<ChatComposerSendOverrides>
  sendMessage: (
    text: string,
    opts?: SendMessageOptions,
    files?: FileUIPart[],
    contextParts?: ChatContextPart[]
  ) => SendMessageResult | Promise<SendMessageResult>
  stop: () => void
}

interface SessionBinding {
  providerTargetId: string | null
  modelId: string | null
  runtimeKind?: string | null
}

const EMPTY_RUNTIME_UI_SLOTS: ChatRuntimeUiSlot[] = []
const EMPTY_RUNTIME_UI_SLOT_STATES: ChatRuntimeUiSlotState[] = []

function invertContinuationMode(
  mode: NonNullable<SendMessageOptions['continuationMode']>
): NonNullable<SendMessageOptions['continuationMode']> {
  return mode === 'queue' ? 'steer' : 'queue'
}

function readCodexReviewAvailability({
  workspaceId,
  gitStatusLoading,
  gitStatusUnavailable
}: {
  workspaceId?: string | null
  gitStatusLoading: boolean
  gitStatusUnavailable: boolean
}): ChatComposerSlashCommand['availability'] {
  if (!workspaceId) {
    return {
      enabled: false,
      reason: 'Requires a workspace-backed Git repository.'
    }
  }
  if (gitStatusLoading) {
    return {
      enabled: false,
      reason: 'Checking Git repository.'
    }
  }
  if (gitStatusUnavailable) {
    return {
      enabled: false,
      reason: 'Git repository unavailable.'
    }
  }
  return undefined
}

export function useChatComposerRuntime({
  active = true,
  sessionId,
  isStreaming,
  isReady,
  workspaceId,
  composerModel,
  runtimeSettings,
  sendOverridesRef,
  sendMessage,
  stop
}: UseChatComposerRuntimeOptions): ChatComposerRuntime {
  const { data: chatPreferences } = useChatPreferencesQuery()
  const sessionQueriesEnabled = active && !!sessionId
  const { data: runtimeCapabilities } = useQuery({
    queryKey: runtimeCapabilitiesQueryKey(sessionId),
    queryFn: ({ signal }) => getChatRuntimeCapabilities(sessionId!, signal),
    enabled: sessionQueriesEnabled,
    staleTime: 60_000,
    retry: false
  })
  const { data: runtimeUiSlotStates } = useQuery({
    queryKey: runtimeUiSlotStatesQueryKey(sessionId, runtimeCapabilities?.runtimeKind),
    queryFn: ({ signal }) => getChatRuntimeUiSlotStates(sessionId!, signal),
    enabled: sessionQueriesEnabled,
    staleTime: 2_000,
    refetchInterval: (query) =>
      active && (isStreaming || shouldPollRuntimeSlotStates(query.state.data?.states ?? [])) ? 5_000 : false,
    retry: false
  })
  const { data: sessionBinding } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId ?? '' } }),
    enabled: sessionQueriesEnabled,
    staleTime: 60_000,
    select: (data) => (data ? (data as SessionBinding) : null)
  })
  const boundProviderTarget = useMemo(() => {
    return sessionBinding?.providerTargetId ? { id: sessionBinding.providerTargetId } : null
  }, [sessionBinding?.providerTargetId])
  const { models: providerSessionModels } = useProviderTargetModels(boundProviderTarget)
  const sessionModels = providerSessionModels
  const hasCodexReviewSlot = useMemo(() => {
    return Boolean(runtimeCapabilities?.uiSlots.some((slot) => slot.id === 'codex:review'))
  }, [runtimeCapabilities?.uiSlots])
  const gitRepositoriesQuery = useGitRepositories(active && hasCodexReviewSlot ? workspaceId : null)
  const currentSessionModel = useMemo(() => {
    if (composerModel) {
      return composerModel
    }
    if (!sessionBinding?.modelId) {
      return null
    }
    return sessionModels.find((candidate) => candidate.id === sessionBinding.modelId) ?? null
  }, [composerModel, sessionBinding?.modelId, sessionModels])
  const supportsAttachments = useMemo(() => {
    return modelSupportsAttachments(currentSessionModel)
  }, [currentSessionModel])
  const cradleSlashCommands = useMemo(() => {
    const appshotCommand = (() => {
      if (!isElectron || platform !== 'darwin') {
        return withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, {
          enabled: false,
          reason: 'Requires the macOS desktop app.'
        })
      }
      if (!supportsAttachments) {
        return withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, {
          enabled: false,
          reason: 'Requires an image-capable model.'
        })
      }
      return withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, undefined)
    })()

    return [CRADLE_SIDE_CHAT_SLASH_COMMAND, appshotCommand]
  }, [supportsAttachments])
  const mapRuntimeUiSlotCommand = useCallback(
    (command: ChatComposerSlashCommand) => {
      if (command.id === 'codex:review') {
        return withSlashCommandAvailability(
          command,
          readCodexReviewAvailability({
            workspaceId,
            gitStatusLoading: gitRepositoriesQuery.isLoading,
            gitStatusUnavailable: gitRepositoriesQuery.isError
              || (gitRepositoriesQuery.isSuccess && (gitRepositoriesQuery.data?.length ?? 0) !== 1)
          })
        )
      }
      if (
        command.action.kind === 'uiAction' &&
        command.action.actionId === CODEX_USAGE_SLASH_ACTION_ID
      ) {
        const usageState = runtimeUiSlotStates?.states.find((state) => state.kind === 'usage')
        return withSlashCommandAvailability(
          command,
          usageState && isRuntimeUsageSlotStateAvailable(usageState)
            ? undefined
            : { enabled: false, reason: 'Usage rate limits are unavailable for this session.' }
        )
      }
      return command
    },
    [
      gitRepositoriesQuery.data?.length,
      gitRepositoriesQuery.isError,
      gitRepositoriesQuery.isLoading,
      gitRepositoriesQuery.isSuccess,
      runtimeUiSlotStates?.states,
      workspaceId,
    ]
  )
  const slashCommands = useMemo(
    () =>
      projectRuntimeComposerSlashCommands({
        capabilities: runtimeCapabilities,
        slotStates: runtimeUiSlotStates?.states ?? [],
        mode: 'session',
        cradleCommands: cradleSlashCommands,
        mapRuntimeUiSlotCommand
      }),
    [cradleSlashCommands, mapRuntimeUiSlotCommand, runtimeCapabilities, runtimeUiSlotStates?.states]
  )

  const compactSlotState = useMemo(() => {
    return (
      (runtimeUiSlotStates?.states ?? []).find(
        (state): state is ChatRuntimeCompactUiSlotState => state.kind === 'compact'
      ) ?? null
    )
  }, [runtimeUiSlotStates?.states])
  const tokenUsage = useMemo<ChatComposerRuntime['tokenUsage']>(() => {
    if (!compactSlotState?.modelContextWindow) {
      return null
    }
    // Use the last turn's window occupancy (current context fill), not the
    // session-cumulative `total` which sums every turn and overflows the window.
    // Mirrors readCompactWindowUsage in context-usage-detail-panel.tsx so the
    // ring and the breakdown panel agree.
    const windowUsage =
      compactSlotState.last.totalTokens > 0 ? compactSlotState.last : compactSlotState.total
    return {
      tokens: windowUsage.totalTokens,
      contextWindow: compactSlotState.modelContextWindow
    }
  }, [compactSlotState])
  const uiSlots = runtimeCapabilities?.uiSlots ?? EMPTY_RUNTIME_UI_SLOTS
  const slotStates = runtimeUiSlotStates?.states ?? EMPTY_RUNTIME_UI_SLOT_STATES

  const send = useCallback(
    (
      text: string,
      files: FileUIPart[],
      contextParts: ChatContextPart[],
      options?: {
        invertContinuationMode?: boolean
        runtimeSettings?: SendMessageOptions['runtimeSettings']
      }
    ) => {
      if (!isReady || (!text.trim() && files.length === 0 && contextParts.length === 0)) {
        return
      }

      const overrides = sendOverridesRef?.current
      const defaultContinuationMode = chatPreferences?.continuationBehavior ?? 'queue'
      const continuationMode = options?.invertContinuationMode
        ? invertContinuationMode(defaultContinuationMode)
        : defaultContinuationMode
      return sendMessage(
        text,
        {
          ...overrides,
          runtimeSettings: options?.runtimeSettings
            ? { ...runtimeSettings, ...options.runtimeSettings }
            : runtimeSettings,
          continuationMode
        },
        files,
        contextParts
      )
    },
    [chatPreferences?.continuationBehavior, isReady, runtimeSettings, sendMessage, sendOverridesRef]
  )

  return {
    disabled: !isReady,
    isStreaming,
    send,
    stop,
    slashCommands,
    uiSlots,
    slotStates,
    supportsAttachments,
    tokenUsage,
    compactState: compactSlotState,
  }
}

function isRuntimeUsageSlotStateAvailable(state: ChatRuntimeUiSlotState): boolean {
  return (
    state.kind === 'usage' &&
    (state.usedPercent !== null ||
      state.secondaryUsedPercent !== null ||
      state.limitName !== null ||
      state.primaryResetsAt !== null ||
      state.secondaryResetsAt !== null ||
      state.creditsBalance !== null ||
      state.rateLimitReachedType !== null)
  )
}

function shouldPollRuntimeSlotStates(states: ChatRuntimeUiSlotState[]): boolean {
  return states.some((state) => {
    if (state.kind === 'goal') {
      return state.status === 'active'
    }
    if (state.kind === 'compact') {
      return state.isCompactRelevant
    }
    if (state.kind === 'status') {
      return state.status === 'active'
    }
    if (state.kind === 'toolActivity') {
      return state.activeCount > 0
    }
    if (state.kind === 'progress') {
      return state.inProgressCount > 0
    }
    if (state.kind === 'terminal') {
      return state.activeCount > 0 || state.backgroundTerminals.length > 0
    }
    if (state.kind === 'mcp') {
      return Boolean(state.recentProgress)
    }
    if (state.kind === 'userInput') {
      return true
    }
    return false
  })
}
