import { useQuery } from '@tanstack/react-query'
import type { FileUIPart } from 'ai'
import { useCallback, useMemo } from 'react'

import type { ModelDescriptor } from '~/features/agent-runtime/types'
import { useProviderTargetModels } from '~/features/agent-runtime/use-agent-models'
import { useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import { useGitRepositories } from '~/features/git/use-git'
import { useChatPreferencesQuery } from '~/features/settings/use-chat-preferences'
import { isElectron, platform } from '~/lib/electron'

import type {
  ChatRuntimeCompactUiSlotState,
  ChatRuntimeUiSlot,
  ChatRuntimeUiSlotState,
} from '../capabilities/chat-capabilities'
import {
  getChatRuntimeCapabilities,
  getChatRuntimeUiSlotStates,
  runtimeCapabilitiesQueryKey,
  runtimeUiSlotStatesQueryKey,
} from '../capabilities/chat-capabilities'
import type { ChatContextPart } from '../context/chat-context-parts'
import { readRunRuntimeSettingsPatch } from '../runtime/runtime-settings-presenter'
import type { SendMessageOptions, SendMessageResult } from '../session/use-chat-session'
import { useSessionBinding } from '../session/use-session-binding'
import type { ChatComposerSlashCommand } from '../slash-commands/chat-slash-commands'
import {
  CRADLE_APPSHOT_SLASH_COMMAND,
  CRADLE_SIDE_CHAT_SLASH_COMMAND,
  projectRuntimeComposerSlashCommands,
  RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID,
  RUNTIME_USAGE_COMMAND_ACTION_ID,
  withSlashCommandAvailability,
} from '../slash-commands/chat-slash-commands'
import { modelSupportsAttachments, modelSupportsImageInput } from './composer-attachment-state'
import { prepareLightOcrAttachments } from './light-ocr'

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
    },
  ) => SendMessageResult | Promise<SendMessageResult>
  stop: () => void
  slashCommands: ChatComposerSlashCommand[]
  uiSlots: ChatRuntimeUiSlot[]
  slotStates: ChatRuntimeUiSlotState[]
  supportsAttachments: boolean
  usesLightOcr: boolean
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
  remoteHostId?: string | null
  composerModel?: ModelDescriptor | null
  sendOverridesRef?: React.MutableRefObject<ChatComposerSendOverrides>
  sendMessage: (
    text: string,
    opts?: SendMessageOptions,
    files?: FileUIPart[],
    contextParts?: ChatContextPart[],
  ) => SendMessageResult | Promise<SendMessageResult>
  stop: () => void
}

const EMPTY_RUNTIME_UI_SLOTS: ChatRuntimeUiSlot[] = []
const EMPTY_RUNTIME_UI_SLOT_STATES: ChatRuntimeUiSlotState[] = []

function invertContinuationMode(
  mode: NonNullable<SendMessageOptions['continuationMode']>,
): NonNullable<SendMessageOptions['continuationMode']> {
  return mode === 'queue' ? 'steer' : 'queue'
}

function readRuntimeCodeReviewAvailability({
  workspaceId,
  gitStatusLoading,
  gitStatusUnavailable,
}: {
  workspaceId?: string | null
  gitStatusLoading: boolean
  gitStatusUnavailable: boolean
}): ChatComposerSlashCommand['availability'] {
  if (!workspaceId) {
    return {
      enabled: false,
      reason: 'Requires a workspace-backed Git repository.',
    }
  }
  if (gitStatusLoading) {
    return {
      enabled: false,
      reason: 'Checking Git repository.',
    }
  }
  if (gitStatusUnavailable) {
    return {
      enabled: false,
      reason: 'Git repository unavailable.',
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
  remoteHostId = null,
  composerModel,
  sendOverridesRef,
  sendMessage,
  stop,
}: UseChatComposerRuntimeOptions): ChatComposerRuntime {
  const { data: chatPreferences } = useChatPreferencesQuery()
  const sessionQueriesEnabled = active && !!sessionId
  const { data: runtimeCapabilities } = useQuery({
    queryKey: runtimeCapabilitiesQueryKey(sessionId),
    queryFn: ({ signal }) => getChatRuntimeCapabilities(sessionId!, signal),
    enabled: sessionQueriesEnabled,
    staleTime: 60_000,
    retry: false,
  })
  const { runtimes } = useRuntimeCatalog()
  const runtimeSteerCapability = useMemo(() => {
    const runtimeKind = runtimeCapabilities?.runtimeKind
    if (!runtimeKind) {
      return 'queue-fallback'
    }
    return (
      runtimes.find(r => r.runtimeKind === runtimeKind)?.capabilities?.steer ?? 'queue-fallback'
    )
  }, [runtimeCapabilities?.runtimeKind, runtimes])

  const { data: runtimeUiSlotStates } = useQuery({
    queryKey: runtimeUiSlotStatesQueryKey(sessionId, runtimeCapabilities?.runtimeKind),
    queryFn: ({ signal }) => getChatRuntimeUiSlotStates(sessionId!, signal),
    enabled: sessionQueriesEnabled,
    staleTime: 2_000,
    refetchInterval: query =>
      active && (isStreaming || shouldPollRuntimeSlotStates(query.state.data?.states ?? []))
        ? 5_000
        : false,
    retry: false,
  })
  const sessionBinding = useSessionBinding(sessionId, sessionQueriesEnabled)
  const boundProviderTarget = useMemo(() => {
    return sessionBinding?.providerTargetId ? { id: sessionBinding.providerTargetId } : null
  }, [sessionBinding?.providerTargetId])
  const { models: providerSessionModels } = useProviderTargetModels(boundProviderTarget, {
    workspaceId,
    hostId: remoteHostId,
  })
  const sessionModels = providerSessionModels
  const hasRuntimeCodeReviewSlot = useMemo(() => {
    return Boolean(
      runtimeCapabilities?.uiSlots.some((slot) => {
        return (
          slot.commandAction?.kind === 'uiAction'
          && slot.commandAction.actionId === RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID
        )
      }),
    )
  }, [runtimeCapabilities?.uiSlots])
  const gitRepositoriesQuery = useGitRepositories(
    active && hasRuntimeCodeReviewSlot ? workspaceId : null,
  )
  const currentSessionModel = useMemo(() => {
    if (composerModel) {
      return composerModel
    }
    if (!sessionBinding?.modelId) {
      return null
    }
    return sessionModels.find(candidate => candidate.id === sessionBinding.modelId) ?? null
  }, [composerModel, sessionBinding?.modelId, sessionModels])
  const usesLightOcr = useMemo(
    () => !modelSupportsImageInput(currentSessionModel),
    [currentSessionModel],
  )
  const supportsAttachments = useMemo(() => {
    return modelSupportsAttachments(currentSessionModel) || usesLightOcr
  }, [currentSessionModel, usesLightOcr])
  const cradleSlashCommands = useMemo(() => {
    const appshotCommand = (() => {
      if (!isElectron || platform !== 'darwin') {
        return withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, {
          enabled: false,
          reason: 'Requires the macOS desktop app.',
        })
      }
      if (!supportsAttachments) {
        return withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, {
          enabled: false,
          reason: 'Requires an image-capable model.',
        })
      }
      return withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, undefined)
    })()

    return [CRADLE_SIDE_CHAT_SLASH_COMMAND, appshotCommand]
  }, [supportsAttachments])
  const mapRuntimeUiSlotCommand = useCallback(
    (command: ChatComposerSlashCommand) => {
      if (
        command.action.kind === 'uiAction'
        && command.action.actionId === RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID
      ) {
        return withSlashCommandAvailability(
          command,
          readRuntimeCodeReviewAvailability({
            workspaceId,
            gitStatusLoading: gitRepositoriesQuery.isLoading,
            gitStatusUnavailable:
              gitRepositoriesQuery.isError
              || (gitRepositoriesQuery.isSuccess && (gitRepositoriesQuery.data?.length ?? 0) !== 1),
          }),
        )
      }
      if (
        command.action.kind === 'uiAction'
        && command.action.actionId === RUNTIME_USAGE_COMMAND_ACTION_ID
      ) {
        const usageState = runtimeUiSlotStates?.states.find(state => state.kind === 'usage')
        return withSlashCommandAvailability(
          command,
          usageState && isRuntimeUsageSlotStateAvailable(usageState)
            ? undefined
            : { enabled: false, reason: 'Usage rate limits are unavailable for this session.' },
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
    ],
  )
  const slashCommands = useMemo(
    () =>
      projectRuntimeComposerSlashCommands({
        capabilities: runtimeCapabilities,
        slotStates: runtimeUiSlotStates?.states ?? [],
        mode: 'session',
        cradleCommands: cradleSlashCommands,
        mapRuntimeUiSlotCommand,
      }),
    [cradleSlashCommands, mapRuntimeUiSlotCommand, runtimeCapabilities, runtimeUiSlotStates?.states],
  )

  const compactSlotState = useMemo(() => {
    return (
      (runtimeUiSlotStates?.states ?? []).find(
        (state): state is ChatRuntimeCompactUiSlotState => state.kind === 'compact',
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
    const windowUsage
      = compactSlotState.last.totalTokens > 0 ? compactSlotState.last : compactSlotState.total
    return {
      tokens: windowUsage.totalTokens,
      contextWindow: compactSlotState.modelContextWindow,
    }
  }, [compactSlotState])
  const uiSlots = runtimeCapabilities?.uiSlots ?? EMPTY_RUNTIME_UI_SLOTS
  const slotStates = runtimeUiSlotStates?.states ?? EMPTY_RUNTIME_UI_SLOT_STATES

  const send = useCallback(
    async (
      text: string,
      files: FileUIPart[],
      contextParts: ChatContextPart[],
      options?: {
        invertContinuationMode?: boolean
        runtimeSettings?: SendMessageOptions['runtimeSettings']
      },
    ) => {
      if (!isReady || (!text.trim() && files.length === 0 && contextParts.length === 0)) {
        return
      }

      const overrides = sendOverridesRef?.current
      const defaultContinuationMode = chatPreferences?.continuationBehavior ?? 'queue'
      const effectiveMode = options?.invertContinuationMode
        ? invertContinuationMode(defaultContinuationMode)
        : defaultContinuationMode
      // Runtimes that lack native steer always queue — skip the round-trip.
      const continuationMode = runtimeSteerCapability === 'native' ? effectiveMode : 'queue'
      const preparedFiles = usesLightOcr ? await prepareLightOcrAttachments(files) : files
      return await sendMessage(
        text,
        {
          ...overrides,
          continuationMode,
          ...(options?.runtimeSettings
            ? { runtimeSettings: readRunRuntimeSettingsPatch(options.runtimeSettings) }
            : {}),
        },
        preparedFiles,
        contextParts,
      )
    },
    [
      chatPreferences?.continuationBehavior,
      isReady,
      runtimeSteerCapability,
      sendMessage,
      sendOverridesRef,
      usesLightOcr,
    ],
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
    usesLightOcr,
    tokenUsage,
    compactState: compactSlotState,
  }
}

function isRuntimeUsageSlotStateAvailable(state: ChatRuntimeUiSlotState): boolean {
  return (
    state.kind === 'usage'
    && (state.usedPercent !== null
      || state.secondaryUsedPercent !== null
      || state.limitName !== null
      || state.primaryResetsAt !== null
      || state.secondaryResetsAt !== null
      || state.creditsBalance !== null
      || state.rateLimitReachedType !== null)
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
    if (state.kind === 'crew') {
      return state.activeCount > 0
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
