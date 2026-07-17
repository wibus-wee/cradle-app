import { Settings2Line as SettingsIcon, ShieldLine as ShieldIcon } from '@mingcute/react'
import type { FileUIPart } from 'ai'
import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSkills, getWorkspacesByWorkspaceIdGitMergeBase } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { toastManager } from '~/components/ui/toast'
import type { ClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import { hasClaudeAgentModelAliases } from '~/features/agent-runtime/claude-agent-config'
import type { ApiProviderKind, RuntimeKind } from '~/features/agent-runtime/types'
import type { RuntimeCatalogComposer } from '~/features/agent-runtime/use-runtime-catalog'
import {
  runtimeComposerAllowsEmptySubmit,
  runtimeComposerUsesAliasMatrixModelSelection,
  runtimeComposerUsesCollapsedInput,
  useRuntimeCatalog,
} from '~/features/agent-runtime/use-runtime-catalog'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import type { RuntimeProviderBinding } from '~/features/composer-toolbar/types'
import type { ComposerStateResult } from '~/features/composer-toolbar/use-composer-state'
import { RemoteHostConnectionNotice } from '~/features/remote-hosts/remote-host-connection-notice'
import { useRemoteHostConnection } from '~/features/remote-hosts/use-remote-host-connection'
import type { SkillInventoryEntry } from '~/features/skills/types'
import { searchWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { cn } from '~/lib/cn'
import { isElectron, platform } from '~/lib/electron'
import { openSettingsSection as openSettingsRouteSection } from '~/navigation/navigation-commands'
import { useNewChatStore } from '~/store/new-chat'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import type {
  RuntimeSettingsPatch,
  RuntimeSettingsPatchValue,
} from '../commands/chat-response-command'
import type { ChatContextPart } from '../context/chat-context-parts'
import type { MentionItem } from '../mentions/mention-panel'
import { searchPluginMentions } from '../mentions/plugin-mentions'
import type { SkillMentionItem } from '../mentions/skill-mention-panel'
import {
  useDraftClaudeAgentModelAliases,
  useProviderTargetClaudeAgentModelAliases,
} from '../runtime/claude-session-model-matrix-control'
import { RuntimeSettingsControl } from '../runtime/runtime-settings-control'
import {
  mergeRuntimeSettings,
  readDefaultRuntimeSettings,
  resolveRuntimeCatalogItem,
} from '../runtime/runtime-settings-presenter'
import type { ChatComposerSlashCommand } from '../slash-commands/chat-slash-commands'
import {
  CRADLE_APPSHOT_SLASH_ACTION_ID,
  CRADLE_APPSHOT_SLASH_COMMAND,
  RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID,
  withSlashCommandAvailability,
} from '../slash-commands/chat-slash-commands'
import { useRuntimeComposerSlashCommands } from '../slash-commands/use-runtime-composer-slash-commands'
import { Composer } from './composer'
import type {
  ComposerSlashCommandActionContext,
  ComposerSlashCommandActionResult,
  ComposerSlashCommandActionTools,
} from './composer-action-context'
import { modelSupportsAttachments, modelSupportsImageInput } from './composer-attachment-state'
import { ComposerSlotStates } from './composer-slot-states'
import { prepareLightOcrAttachments } from './light-ocr'
import { useComposerAppshotCapture } from './use-composer-appshot-capture'

type ChatThinkingEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'

interface DraftClaudeAgentConfig {
  modelAliases: ClaudeAgentModelAliases
}

export type DraftChatRuntimeSettings = Record<
  string,
  RuntimeSettingsPatchValue | DraftClaudeAgentConfig | undefined
> & {
  claudeAgent?: DraftClaudeAgentConfig | null
}

const PLACEHOLDER_HINT_KEYS = [
  'placeholder.task',
  'placeholder.structure',
  'placeholder.risk',
  'placeholder.fixTest',
  'placeholder.refactor',
] as const

export interface DraftChatComposerSubmitOptions {
  runtimeKind: RuntimeKind
  providerBinding: RuntimeProviderBinding
  runtimeComposer: RuntimeCatalogComposer
  agentId?: string
  agentName?: string
  acpAgentId?: string
  acpAgentName?: string
  acpDraftSessionId?: string
  providerTargetId?: string
  providerTargetName?: string
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings: DraftChatRuntimeSettings
}

export type DraftChatComposerSendHandler = (
  text: string,
  files: FileUIPart[],
  contextParts: ChatContextPart[],
  options: DraftChatComposerSubmitOptions,
) => boolean | void | Promise<boolean | void>

interface DraftChatComposerProps {
  workspaceId: string | null
  /**
   * When the selected workspace is mounted from a remote host, load the remote
   * provider catalog and gate send on host connection.
   */
  remoteHostId?: string | null
  active?: boolean
  contextBar?: ReactNode
  replaceText?: string
  replaceTextKey?: number
  onDraftChange?: (draft: string) => void
  onSend: DraftChatComposerSendHandler
  onSendInNewWindow?: DraftChatComposerSendHandler
  onSendIsolated?: DraftChatComposerSendHandler
  testIdPrefix?: string
  sendButtonText?: string
}

interface DraftChatComposerContentProps extends DraftChatComposerProps {
  composerState: ComposerStateResult
}

function useRotatingPlaceholder(hints: string[], active: boolean, interval = 4000): string {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!active) {
      return
    }
    const timer = setInterval(() => {
      setIndex(i => (i + 1) % hints.length)
    }, interval)
    return () => clearInterval(timer)
  }, [active, hints.length, interval])

  return hints[index]
}

export function DraftChatComposer(props: DraftChatComposerProps) {
  const composerState = useComposerState({
    context: 'new-chat',
    workspaceId: props.workspaceId,
    remoteHostId: props.remoteHostId,
    // Remote catalogs own providers; local Agents are not executable there.
    enableAgents: !props.remoteHostId,
  })
  return <DraftChatComposerContent {...props} composerState={composerState} />
}

export function DraftChatComposerWithState(props: DraftChatComposerContentProps) {
  return <DraftChatComposerContent {...props} />
}

function DraftChatComposerContent({
  workspaceId,
  remoteHostId = null,
  active = true,
  contextBar,
  replaceText,
  replaceTextKey,
  onDraftChange,
  onSend,
  onSendInNewWindow,
  onSendIsolated,
  testIdPrefix = 'draft-chat',
  sendButtonText,
  composerState,
}: DraftChatComposerContentProps) {
  const { t } = useTranslation('new-chat')
  const { runtimes } = useRuntimeCatalog()
  const { selection, effectiveAgent, effectiveProfile, effectiveModel } = composerState
  const runtimeCatalogItem = resolveRuntimeCatalogItem(runtimes, selection.runtimeKind)
  const defaultRuntimeSettings = readDefaultRuntimeSettings(runtimeCatalogItem)
  const storedRuntimeSettings = useNewChatStore(
    s => s.lastRuntimeSettingsByKind[selection.runtimeKind],
  )
  const patchRuntimeSettings = useNewChatStore(s => s.patchLastRuntimeSettings)
  const runtimeSettings = mergeRuntimeSettings(defaultRuntimeSettings, storedRuntimeSettings ?? {})
  const claudeAgentByProfile = useNewChatStore(s => s.lastClaudeAgentByProfile)
  const setClaudeAgentForProfile = useNewChatStore(s => s.setLastClaudeAgentForProfile)
  const [sending, setSending] = useState(false)
  const [reviewModeOpen, setReviewModeOpen] = useState(false)
  const setSettingsSection = useSettingsOverlayStore(s => s.setSettingsSection)

  const placeholderHints = PLACEHOLDER_HINT_KEYS.map(key => t(key))
  const placeholder = useRotatingPlaceholder(placeholderHints, active)

  const remoteConnection = useRemoteHostConnection(remoteHostId)
  const remoteConnectionBlocked = remoteConnection.isBlocking

  const readinessNotice = (() => {
    if (remoteConnectionBlocked) {
      return null
    }
    if (
      composerState.isLoadingAgents
      || composerState.isLoadingAcpAgents
      || composerState.isLoadingProfiles
      || composerState.isLoadingModels
    ) {
      return null
    }
    if (selection.targetMode === 'agent' && composerState.agents.length === 0) {
      return {
        key: 'agents',
        icon: SettingsIcon,
        message: t('readiness.agent.message'),
        actionLabel: t('readiness.agent.action'),
        disabled: false,
      }
    }
    if (selection.targetMode === 'acp-agent' && composerState.acpAgents.length === 0) {
      return {
        key: 'acp-agent',
        icon: SettingsIcon,
        message: t('readiness.acpAgent.message'),
        actionLabel: t('readiness.acpAgent.action'),
        disabled: false,
      }
    }
    if (
      selection.targetMode === 'provider'
      && composerState.providerBinding !== 'runtime-owned'
      && !effectiveProfile
    ) {
      return {
        key: 'providers',
        icon: SettingsIcon,
        message: t('readiness.provider.message'),
        actionLabel: t('readiness.provider.action'),
        disabled: false,
      }
    }
    return null
  })()

  const searchFiles = async (query: string, signal?: AbortSignal): Promise<MentionItem[]> => {
    if (!workspaceId) {
      return []
    }
    return searchWorkspaceFiles({ workspaceId, query, limit: 30, signal })
  }

  const searchSkills = async (
    _query: string,
    signal?: AbortSignal,
  ): Promise<SkillMentionItem[]> => {
    const { data } = await getSkills({
      query: {
        workspaceId: workspaceId ?? undefined,
        agentId: effectiveAgent?.id ?? undefined,
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

  const openSettingsSection = (section: string) => {
    const settingsSection = section === 'acp-agent' ? 'runtimes' : section
    setSettingsSection(settingsSection)
    openSettingsRouteSection(settingsSection)
  }

  const updateRuntimeSettings = (patch: RuntimeSettingsPatch) => {
    patchRuntimeSettings(selection.runtimeKind, patch)
  }

  const updateClaudeAgentAliases = (next: ClaudeAgentModelAliases) => {
    if (!selection.profileId) {
      return
    }
    setClaudeAgentForProfile(
      selection.profileId,
      hasClaudeAgentModelAliases(next) ? { modelAliases: next } : null,
    )
  }

  const selectedProviderKind = effectiveProfile?.providerKind
  const selectedApiProviderKind: ApiProviderKind | null
    = selectedProviderKind && selectedProviderKind !== 'cli-tool' ? selectedProviderKind : null
  const claudeAgent = selection.profileId
    ? (claudeAgentByProfile[selection.profileId] ?? null)
    : null
  const inputCollapsed
    = selection.targetMode === 'agent'
      && runtimeComposerUsesCollapsedInput(composerState.runtimeComposer)
  const allowEmptySubmit = runtimeComposerAllowsEmptySubmit(composerState.runtimeComposer)
  const usesAliasMatrixModelSelection = runtimeComposerUsesAliasMatrixModelSelection(
    composerState.runtimeComposer,
  )

  const providerTargetAliases = useProviderTargetClaudeAgentModelAliases({
    providerTargetId: selection.profileId,
    providerKind: selectedApiProviderKind,
    enabled: selection.targetMode === 'provider' && usesAliasMatrixModelSelection,
  })
  const claudeModelAliasesSlot = useDraftClaudeAgentModelAliases({
    active,
    enabled: usesAliasMatrixModelSelection,
    providerTargetId: selection.profileId,
    providerKind: selectedApiProviderKind,
    aliases: claudeAgent?.modelAliases ?? providerTargetAliases.aliases,
    loading: providerTargetAliases.isLoading,
    onChange: updateClaudeAgentAliases,
  })
  const claudeModelAliases = claudeModelAliasesSlot
    ? { slot: claudeModelAliasesSlot, providerSettingsLoading: providerTargetAliases.isLoading }
    : null
  const usesLightOcr = !modelSupportsImageInput(effectiveModel)
  const supportsAttachments = modelSupportsAttachments(effectiveModel) || usesLightOcr
  const appshotRuntime = useComposerAppshotCapture({
    active,
    supportsAttachments,
  })
  const cradleSlashCommands = (() => {
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

    return [appshotCommand]
  })()
  const slashCommands = useRuntimeComposerSlashCommands(
    selection.runtimeKind,
    composerState.runtimeComposer,
    cradleSlashCommands,
  )
  const sendDisabled
    = remoteConnectionBlocked
      || (selection.targetMode === 'agent'
        ? !effectiveAgent || sending
        : selection.targetMode === 'acp-agent'
          ? !composerState.effectiveAcpAgent || sending
          : !effectiveProfile || sending)

  const toolbar = (
    <div className="flex min-w-0 items-center gap-1">
      <ComposerToolbar
        context="new-chat"
        state={composerState}
        claudeModelAliases={claudeModelAliases}
      />
    </div>
  )
  const footer = (
    <div className="flex w-full min-w-0 items-center justify-between gap-3 text-muted-foreground">
      <div className="shrink-0">
        <RuntimeSettingsControl
          runtime={runtimeCatalogItem}
          settings={runtimeSettings}
          applied
          disabled={sending}
          showLabels={true}
          onChange={updateRuntimeSettings}
        />
      </div>
      {contextBar && <div className="flex min-w-0 justify-end">{contextBar}</div>}
    </div>
  )

  const handleSendWithTarget = async (
    sendTarget: DraftChatComposerSendHandler,
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
  ) => {
    const trimmedText = text.trim()
    const hasDraft = trimmedText.length > 0 || files.length > 0 || contextParts.length > 0
    const canSubmit
      = !remoteConnectionBlocked
        && (selection.targetMode === 'agent'
          ? !!effectiveAgent && (allowEmptySubmit || hasDraft) && !sending
          : selection.targetMode === 'acp-agent'
            ? !!composerState.effectiveAcpAgent && hasDraft && !sending
            : !!effectiveProfile && hasDraft && !sending)

    if (!canSubmit) {
      return false
    }

    setSending(true)
    const submitRuntimeSettings: DraftChatRuntimeSettings = {
      ...runtimeSettings,
      ...(selection.targetMode === 'provider' && usesAliasMatrixModelSelection && claudeAgent
        ? { claudeAgent }
        : {}),
    }
    const submitOptions: DraftChatComposerSubmitOptions = {
      runtimeKind: selection.runtimeKind,
      providerBinding: composerState.providerBinding,
      runtimeComposer: composerState.runtimeComposer,
      ...(effectiveAgent
        ? {
            agentId: effectiveAgent.id,
            agentName: effectiveAgent.name,
          }
        : composerState.effectiveAcpAgent
          ? {
              acpAgentId: composerState.effectiveAcpAgent.id,
              acpAgentName: composerState.effectiveAcpAgent.name,
              acpDraftSessionId: selection.acpDraftSessionId ?? undefined,
              modelId: selection.modelId ?? undefined,
            }
        : {
            providerTargetId: effectiveProfile?.id,
            providerTargetName: effectiveProfile?.name,
            modelId: usesAliasMatrixModelSelection
              ? (selection.modelId ?? undefined)
              : (selection.modelId ?? effectiveModel?.id),
            thinkingEffort: selection.thinkingEffort ?? undefined,
          }),
      runtimeSettings: submitRuntimeSettings,
    }

    return Promise.resolve()
      .then(async () =>
        sendTarget(
          trimmedText,
          usesLightOcr ? await prepareLightOcrAttachments(files) : files,
          contextParts,
          submitOptions,
        ))
      .then(() => true)
      .finally(() => {
        setSending(false)
      })
  }

  const handleSend = (text: string, files: FileUIPart[], contextParts: ChatContextPart[]) => {
    return handleSendWithTarget(onSend, text, files, contextParts)
  }

  const handleSendInNewWindow = (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
  ) => {
    return onSendInNewWindow
      ? handleSendWithTarget(onSendInNewWindow, text, files, contextParts)
      : handleSend(text, files, contextParts)
  }

  const handleSendIsolated = (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
  ) => {
    return onSendIsolated
      ? handleSendWithTarget(onSendIsolated, text, files, contextParts)
      : handleSend(text, files, contextParts)
  }

  const sendVariants
    = onSendIsolated && workspaceId
      ? [
          {
            id: 'worktree',
            label: t('send.inWorktree'),
            icon: <ShieldIcon className="size-3.5" aria-hidden />,
            submitHandler: handleSendIsolated,
          },
        ]
      : undefined

  const handleSlashCommandAction = async (
    command: ChatComposerSlashCommand,
    _context: ComposerSlashCommandActionContext,
    tools?: ComposerSlashCommandActionTools,
  ): Promise<ComposerSlashCommandActionResult | void> => {
    if (command.action.kind !== 'uiAction') {
      return
    }
    if (command.action.actionId === RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID) {
      setReviewModeOpen(true)
      return { insertText: '' }
    }
    if (command.action.actionId !== CRADLE_APPSHOT_SLASH_ACTION_ID) {
      return
    }
    if (!appshotRuntime.hasNativeCapture) {
      toastManager.add({
        type: 'error',
        title: 'Appshot is unavailable',
        description: 'Appshot capture requires the Electron desktop app.',
      })
      return
    }
    if (!supportsAttachments) {
      toastManager.add({
        type: 'error',
        title: 'Appshot attachment is unavailable',
        description: 'The selected model does not accept image attachments.',
      })
      return
    }

    try {
      await appshotRuntime.capture({ tools })
      return { insertText: '' }
    }
 catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Appshot capture failed',
        description: error instanceof Error ? error.message : 'Unknown Appshot capture error.',
      })
    }
  }

  const submitCodexReviewPrompt = (prompt: string) => {
    void handleSend(prompt, [], [])
  }

  const resolveCodexReviewMergeBase = async (
    baseBranch: string,
    repositoryPath?: string | null,
  ) => {
    if (!workspaceId) {
      return null
    }
    const result = await getWorkspacesByWorkspaceIdGitMergeBase({
      path: { workspaceId },
      query: {
        baseBranch,
        ...(repositoryPath ? { repo: repositoryPath } : {}),
      },
    })
    if (result.error || !result.data) {
      throw new Error(`Failed to resolve merge base (${result.response?.status ?? 'unknown'}).`)
    }
    return result.data.mergeBaseSha
  }

  const reviewSlot = {
    open: reviewModeOpen,
    workspaceId,
    onDismiss: () => setReviewModeOpen(false),
    onSubmitPrompt: submitCodexReviewPrompt,
    resolveMergeBase: resolveCodexReviewMergeBase,
  }

  return (
    <>
      <ComposerSlotStates slots={[]} states={[]} review={reviewSlot} />
      <Composer
        send={{
          submit: handleSend,
          label: sendButtonText,
          submitInNewWindow: handleSendInNewWindow,
          sendVariants,
          isSending: sending,
          sendDisabled,
          allowEmptySend: allowEmptySubmit,
        }}
        commands={{
          commands: slashCommands,
          runAction: handleSlashCommandAction,
        }}
        attachments={{
          supportsAttachments,
          usesLightOcr,
          appendFileParts: appshotRuntime.externalFileParts,
          appendFilePartsKey: appshotRuntime.externalFilePartsKey,
          pendingAppshots: appshotRuntime.pendingAppshots,
          onActionTargetElementChange: appshotRuntime.setActionTargetElement,
        }}
        runtimeSettings={{
          runtimeKind: selection.runtimeKind,
          settings: runtimeSettings,
          disabled: sending,
          onChange: updateRuntimeSettings,
        }}
        slots={{
          toolbar,
          footer,
        }}
        externalSignals={{
          replaceText,
          replaceTextKey,
        }}
        view={{
          placeholder,
          searchFiles,
          searchPlugins: searchPluginMentions,
          searchSkills,
          onDraftChange,
          inputCollapsed,
          surfaceId: 'new-chat',
          className: 'relative',
          cardClassName: cn(
            'overflow-hidden rounded-2xl',
            'border-border/60 bg-background shadow-none',
            'ring-1 ring-inset ring-white/[0.02] dark:ring-white/[0.04]',
            'transition-[border-color,box-shadow] duration-200',
            'focus-within:border-ring/50 focus-within:shadow-[var(--shadow-xs)]',
          ),
          textareaRows: 5,
          textareaClassName:
            'px-5 pt-5 pb-3 text-[15px] leading-[1.75] placeholder:text-muted-foreground/30 min-h-30 max-h-80 rounded-t-2xl disabled:opacity-30',
          attachmentListClassName: 'border-border/60 px-3 py-2',
          actionBarClassName: cn(
            'px-2.5 py-2',
            inputCollapsed ? 'border-t-0' : 'border-t border-border/60',
          ),
          attachButtonClassName: 'text-muted-foreground/30',
          attachIconClassName: 'size-3',
          sendButtonClassName: 'ml-0.5',
        }}
        accessibility={{
          textareaAriaLabel: t('accessibility.message', 'New chat message'),
          sendButtonAriaLabel: t('send.tooltip'),
        }}
        testIds={{
          actionTarget: `${testIdPrefix}-composer-action-target`,
          textarea: `${testIdPrefix}-textarea`,
          fileInput: `${testIdPrefix}-file-input`,
          attachButton: `${testIdPrefix}-attach-btn`,
          sendButton: `${testIdPrefix}-send-btn`,
        }}
      />
      {remoteConnectionBlocked
? (
        <div className="mt-2">
          <RemoteHostConnectionNotice gate={remoteConnection.gate} />
        </div>
      )
: (
        <DraftChatReadinessNotice
          notice={readinessNotice}
          onAction={openSettingsSection}
          testIdPrefix={testIdPrefix}
        />
      )}
    </>
  )
}

function DraftChatReadinessNotice({
  notice,
  onAction,
  testIdPrefix,
}: {
  notice: {
    key: string
    icon: typeof SettingsIcon
    message: string
    actionLabel: string
    disabled: boolean
  } | null
  onAction: (section: string) => void
  testIdPrefix: string
}) {
  if (!notice) {
    return null
  }

  const NoticeIcon = notice.icon

  return (
    <m.div
      className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      data-testid={`${testIdPrefix}-readiness-notice`}
    >
      <NoticeIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <span className="min-w-0 flex-1 leading-relaxed">{notice.message}</span>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => onAction(notice.key)}
        disabled={notice.disabled}
        className="h-7 shrink-0"
      >
        {notice.actionLabel}
      </Button>
    </m.div>
  )
}
