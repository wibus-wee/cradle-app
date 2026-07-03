import type { ReactNode } from 'react'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { getSkills } from '~/api-gen/sdk.gen'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import {
  runtimeComposerUsesAliasMatrixModelSelection,
  useRuntimeCatalog,
} from '~/features/agent-runtime/use-runtime-catalog'
import type { MentionItem } from '~/features/chat'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import type { SkillInventoryEntry } from '~/features/skills/types'
import { searchWorkspaceFiles } from '~/features/workspace/use-workspace-files'

import type { ChatViewProps } from './chat-view'
import { searchSessionPluginMentions } from './mentions/plugin-mentions'
import { runtimeSupportsCodexPluginMentions } from './runtime/codex-app-server-bridge'
import type { SkillMentionItem } from './mentions/skill-mention-panel'
import { useProviderTargetClaudeAgentModelAliases, useSessionClaudeAgentModelAliases } from './runtime/claude-session-model-matrix-control'
import type { SendMessageOptions } from './session/use-chat-session'
import { useSessionProviderModelPersistence } from './session/use-session-binding'

const ChatView = lazy(() => import('./chat-view').then(module => ({ default: module.ChatView })))

export function ChatRuntimeView({
  active = true,
  sessionId,
  sessionProviderTargetId,
  sessionModelId,
  sessionThinkingEffort,
  runtimeKind,
  workspaceId,
  agentId,
  composerContextBar,
  composerToolbarAddon,
  hideRuntimeToolbar = false,
  placeholder,
  messageTextTransform,
  prepareSend,
  compactInset = false,
}: {
  active?: boolean
  sessionId: string
  sessionProviderTargetId: string | null
  sessionModelId: string | null
  sessionThinkingEffort: SendMessageOptions['thinkingEffort'] | null
  runtimeKind: RuntimeKind | undefined
  workspaceId: string | null
  agentId: string | null
  composerContextBar?: ReactNode
  composerToolbarAddon?: ReactNode
  hideRuntimeToolbar?: boolean
  placeholder?: string
  messageTextTransform?: ChatViewProps['messageTextTransform']
  prepareSend?: ChatViewProps['prepareSend']
  compactInset?: boolean
}) {
  const persistSessionProviderModel = useSessionProviderModelPersistence(sessionId)
  const composerResetKey = [
    sessionId,
    agentId ?? '',
    sessionProviderTargetId ?? '',
    sessionModelId ?? '',
    sessionThinkingEffort ?? '',
    runtimeKind ?? '',
  ].join(':')
  const { runtimes } = useRuntimeCatalog()
  const runtimeDescriptor = runtimes.find(runtime => runtime.runtimeKind === runtimeKind) ?? null
  const supportsCodexPluginMentions = runtimeSupportsCodexPluginMentions(runtimeDescriptor)
  const composerState = useComposerState({
    context: 'chat',
    workspaceId,
    boundAgentId: agentId,
    boundProviderTargetId: sessionProviderTargetId ?? undefined,
    boundModelId: sessionModelId,
    boundThinkingEffort: sessionThinkingEffort,
    boundRuntimeKind: runtimeKind,
    resetKey: composerResetKey,
  })
  const [pendingProviderTargetId, setPendingProviderTargetId] = useState<string | null>(null)
  const searchFiles = async (query: string, signal?: AbortSignal): Promise<MentionItem[]> => {
    if (!workspaceId) {
      return []
    }
    return searchWorkspaceFiles({ workspaceId, query, limit: 30, signal })
  }
  const searchSkills = async (_query: string, signal?: AbortSignal): Promise<SkillMentionItem[]> => {
    const { data } = await getSkills({
      query: {
        workspaceId: workspaceId ?? undefined,
        agentId: agentId ?? undefined,
      },
      signal,
    })
    const activeSkills: SkillMentionItem[] = []
    for (const skill of (data ?? []) as SkillInventoryEntry[]) {
      if (!skill.active) {
        continue
      }
      activeSkills.push({
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        location: skill.location,
        skillDir: skill.skillDir,
      })
    }
    return activeSkills
  }
  const searchPlugins = (query: string, signal?: AbortSignal) => {
    return searchSessionPluginMentions({
      sessionId,
      supportsCodexPluginMentions,
      providerTargetId: composerState.selection.profileId,
      modelId: composerState.selection.modelId,
      query,
      signal,
    })
  }

  const sendOverridesRef = useRef({
    providerTargetId: undefined as string | undefined,
    modelId: undefined as string | null | undefined,
    thinkingEffort: undefined as SendMessageOptions['thinkingEffort'],
  })
  useLayoutEffect(() => {
    sendOverridesRef.current = {
      providerTargetId: composerState.selection.profileId ?? undefined,
      modelId: composerState.selection.modelId ?? undefined,
      thinkingEffort: composerState.selection.thinkingEffort ?? undefined,
    }
  }, [composerState.selection.modelId, composerState.selection.profileId, composerState.selection.runtimeKind, composerState.selection.thinkingEffort])

  const {
    modelsByProfileId,
    resetManualSelection,
    selection,
    setModelId,
    successfulProfileIds,
  } = composerState
  const selectedProfileId = selection.profileId

  useEffect(() => {
    if (!pendingProviderTargetId) {
      return
    }
    if (selectedProfileId !== pendingProviderTargetId) {
      setPendingProviderTargetId(null)
      return
    }
    const nextModels = modelsByProfileId[pendingProviderTargetId] ?? []
    if (nextModels.length === 0) {
      if (successfulProfileIds.has(pendingProviderTargetId)) {
        resetManualSelection()
        setPendingProviderTargetId(null)
      }
      return
    }
    const nextModelId = nextModels[0]!.id
    setModelId(nextModelId, pendingProviderTargetId)
    void persistSessionProviderModel({ providerTargetId: pendingProviderTargetId, modelId: nextModelId })
    setPendingProviderTargetId(null)
  }, [
    modelsByProfileId,
    pendingProviderTargetId,
    persistSessionProviderModel,
    resetManualSelection,
    selectedProfileId,
    setModelId,
    successfulProfileIds,
    runtimeKind,
  ])

  const sessionComposerState = ({
    ...composerState,
    setProfileId: (id: string) => {
      composerState.setProfileId(id)
      composerState.requestProfileModels(id)
      const nextModels = composerState.modelsByProfileId[id] ?? []
      const nextModelId = nextModels[0]?.id ?? null
      if (!nextModelId) {
        setPendingProviderTargetId(id)
        return
      }
      composerState.setModelId(nextModelId, id)
      setPendingProviderTargetId(null)
      void persistSessionProviderModel({ providerTargetId: id, modelId: nextModelId })
    },
    setModelId: (id: string | null, profileId?: string | null) => {
      composerState.setModelId(id, profileId)
      setPendingProviderTargetId(null)
      const resolvedProfileId = profileId ?? composerState.selection.profileId
      void (resolvedProfileId
        ? persistSessionProviderModel({ providerTargetId: resolvedProfileId, modelId: id })
        : persistSessionProviderModel({ modelId: id }))
    },
    setThinkingEffort: (effort) => {
      composerState.setThinkingEffort(effort)
      void persistSessionProviderModel({ thinkingEffort: effort })
    },
  })

  const selectedProviderKind = sessionComposerState.effectiveProfile?.providerKind
  const selectedApiProviderKind = selectedProviderKind && selectedProviderKind !== 'cli-tool'
    ? selectedProviderKind
    : null
  const usesAliasMatrixModelSelection = runtimeComposerUsesAliasMatrixModelSelection(sessionComposerState.runtimeComposer)

  const providerTargetAliases = useProviderTargetClaudeAgentModelAliases({
    providerTargetId: sessionComposerState.selection.profileId,
    providerKind: selectedApiProviderKind,
    enabled: sessionComposerState.selection.targetMode === 'provider' && usesAliasMatrixModelSelection,
  })
  const claudeModelAliasesSlot = useSessionClaudeAgentModelAliases({
    active,
    sessionId,
    enabled: usesAliasMatrixModelSelection,
    providerTargetId: sessionComposerState.selection.profileId,
    providerKind: selectedApiProviderKind,
    fallbackAliases: providerTargetAliases.aliases,
  })
  const claudeModelAliases = claudeModelAliasesSlot
    ? { slot: claudeModelAliasesSlot, providerSettingsLoading: providerTargetAliases.isLoading }
    : null

  const composerToolbar = hideRuntimeToolbar
    ? null
    : (
        <ComposerToolbar context="chat" state={sessionComposerState} claudeModelAliases={claudeModelAliases} />
      )
  const composerToolbarAddons = (
    <>
      {composerToolbarAddon}
    </>
  )

  return (
    <Suspense fallback={null}>
      <ChatView
        active={active}
        sessionId={sessionId}
        runtimeKind={runtimeKind}
        workspaceId={workspaceId}
        searchFiles={searchFiles}
        searchPlugins={searchPlugins}
        searchSkills={searchSkills}
        composerToolbar={composerToolbar}
        composerToolbarAddon={composerToolbarAddons}
        composerContextBar={composerContextBar}
        hideRuntimeToolbar={hideRuntimeToolbar}
        sendOverridesRef={sendOverridesRef}
        composerModel={sessionComposerState.effectiveModel}
        placeholder={placeholder}
        messageTextTransform={messageTextTransform}
        prepareSend={prepareSend}
        compactInset={compactInset}
      />
    </Suspense>
  )
}
