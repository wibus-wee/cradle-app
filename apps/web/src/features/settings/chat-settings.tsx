// Chat settings for default continuation behavior and archived session recovery.
import {
  BrainLine as BrainIcon,
  CheckLine as CheckIcon,
  Message1Line as MessageSquareIcon,
  SearchLine as SearchIcon,
  UnarchiveLine as ArchiveRestoreIcon,
} from '@mingcute/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSessionsByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { postSessionsByIdArchive } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { toastManager } from '~/components/ui/toast'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { runtimeCatalogItemUsesModelSelection } from '~/features/agent-runtime/runtime-catalog'
import type { ModelDescriptor } from '~/features/agent-runtime/types'
import { useProviderTargetModelMap } from '~/features/agent-runtime/use-agent-models'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import { listSelectableComposerProfilesForRuntimes } from '~/features/composer-toolbar/composer-profile-selection'
import { filterThinkingOptionsForModel, selectSupportedThinkingValue } from '~/features/composer-toolbar/constants'
import type { ThinkingOption } from '~/features/composer-toolbar/provider-model-menu'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import { cn } from '~/lib/cn'

import type { WorkspaceSession } from '../workspace/use-session'
import { sessionsQueryKey, useAllSessions } from '../workspace/use-session'
import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'
import type { ContinuationBehavior, TitleGenerationPreferences, TitleGenerationThinkingEffort } from './use-chat-preferences'
import { useChatPreferences } from './use-chat-preferences'
import { useCodexPreferences } from './use-codex-preferences'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

const TITLE_GENERATION_THINKING_LEVELS: TitleGenerationThinkingEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh']

const titleGenerationThinkingLabelKeys = {
  minimal: 'chat.titleGeneration.thinking.minimal.label',
  low: 'chat.titleGeneration.thinking.low.label',
  medium: 'chat.titleGeneration.thinking.medium.label',
  high: 'chat.titleGeneration.thinking.high.label',
  xhigh: 'chat.titleGeneration.thinking.xhigh.label',
} satisfies Record<TitleGenerationThinkingEffort, SettingsKey>

const titleGenerationThinkingDescriptionKeys = {
  minimal: 'chat.titleGeneration.thinking.minimal.description',
  low: 'chat.titleGeneration.thinking.low.description',
  medium: 'chat.titleGeneration.thinking.medium.description',
  high: 'chat.titleGeneration.thinking.high.description',
  xhigh: 'chat.titleGeneration.thinking.xhigh.description',
} satisfies Record<TitleGenerationThinkingEffort, SettingsKey>

function selectTitleGenerationThinkingEffort(
  model: ModelDescriptor | null,
  options: Array<ThinkingOption<TitleGenerationThinkingEffort>>,
  current: TitleGenerationThinkingEffort,
): TitleGenerationThinkingEffort {
  return selectSupportedThinkingValue(model, options, current, 'high')
}

function formatArchivedAt(session: WorkspaceSession): string {
  const timestamp = session.archivedAt ?? session.updatedAt
  return new Date(timestamp * 1000).toLocaleString()
}

function normalizeArchivedSession(session: {
  id: string
  workspaceId: string | unknown | null
  title: string | unknown | null
  providerTargetId: string | unknown | null
  agentId: string | unknown | null
  modelId: string | unknown | null
  linkedIssueId: string | unknown | null
  runtimeKind: WorkspaceSession['runtimeKind']
  status: WorkspaceSession['status']
  pinned: number
  lastReadAt?: number | unknown | null
  archivedAt: number | unknown | null
  createdAt: number
  updatedAt: number
  latestUserMessageAt: number | unknown | null
  latestAssistantMessageAt?: number | unknown | null
  unread?: boolean | unknown
  origin?: string | unknown | null
  isIsolated?: boolean | unknown
  worktreeId?: string | unknown | null
  worktreeBranch?: string | unknown | null
}): WorkspaceSession {
  const latestUserMessageAt = typeof session.latestUserMessageAt === 'number' ? session.latestUserMessageAt : null
  const latestAssistantMessageAt = typeof session.latestAssistantMessageAt === 'number' ? session.latestAssistantMessageAt : null
  return {
    id: session.id,
    workspaceId: typeof session.workspaceId === 'string' ? session.workspaceId : null,
    title: typeof session.title === 'string' ? session.title : null,
    providerTargetId: typeof session.providerTargetId === 'string' ? session.providerTargetId : null,
    agentId: typeof session.agentId === 'string' ? session.agentId : null,
    modelId: typeof session.modelId === 'string' ? session.modelId : null,
    linkedIssueId: typeof session.linkedIssueId === 'string' ? session.linkedIssueId : null,
    runtimeKind: session.runtimeKind,
    status: session.status,
    pinned: session.pinned,
    lastReadAt: typeof session.lastReadAt === 'number' ? session.lastReadAt : null,
    archivedAt: typeof session.archivedAt === 'number' ? session.archivedAt : null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    latestUserMessageAt,
    latestAssistantMessageAt,
    unread: session.unread === true,
    listActivityAt: latestUserMessageAt ?? session.createdAt,
    origin: typeof session.origin === 'string' && session.origin ? session.origin : 'manual',
    isIsolated: session.isIsolated === true,
    worktreeId: typeof session.worktreeId === 'string' ? session.worktreeId : null,
    worktreeBranch: typeof session.worktreeBranch === 'string' ? session.worktreeBranch : null,
  }
}

function ArchivedSessionRow({
  session,
  restoring,
  onRestore,
}: {
  session: WorkspaceSession
  restoring: boolean
  onRestore: (session: WorkspaceSession) => void
}) {
  const { t } = useTranslation('settings')
  const title = session.title?.trim() || t('chat.archive.untitled' as SettingsKey)
  const meta = session.workspaceId
    ? `${t('chat.archive.metaLabel' as SettingsKey)} ${formatArchivedAt(session)} · ${session.workspaceId}`
    : `${t('chat.archive.metaLabel' as SettingsKey)} ${formatArchivedAt(session)}`

  return (
    <div className="group flex min-w-0 items-center gap-2.5 rounded-md border border-border/50 bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/30">
      <MessageSquareIcon className="size-3.5 shrink-0 !text-muted-foreground/60" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-foreground/90">{title}</div>
        <div className="truncate text-[10.5px] tabular-nums text-muted-foreground/65">{meta}</div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={restoring}
        onClick={() => onRestore(session)}
        aria-label={t('chat.archive.restoreAria', { title })}
      >
        {restoring
          ? <Spinner className="size-3" />
          : <ArchiveRestoreIcon className="size-3" aria-hidden="true" />}
        {t('chat.archive.restore' as SettingsKey)}
      </Button>
    </div>
  )
}

function ArchivedSessionList() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const { sessions, loading } = useAllSessions(true)
  const [query, setQuery] = useState('')
  const sortedSessions = sessions.toSorted((a, b) => (b.archivedAt ?? b.updatedAt) - (a.archivedAt ?? a.updatedAt))
  const trimmedQuery = query.trim().toLocaleLowerCase()
  const filteredSessions = (() => {
    if (!trimmedQuery) {
      return sortedSessions
    }

    return sortedSessions.filter((session) => {
      const title = session.title?.trim() || t('chat.archive.untitled' as SettingsKey)
      return [
        title,
        session.id,
        session.workspaceId ?? '',
        session.providerTargetId ?? '',
        session.modelId ?? '',
      ].some(value => value.toLocaleLowerCase().includes(trimmedQuery))
    })
  })()
  const restoreSession = useMutation({
    mutationFn: async (sessionId: string) => {
      const { data } = await postSessionsByIdArchive({
        path: { id: sessionId },
        body: { archived: false },
        throwOnError: true,
      })
      return normalizeArchivedSession(data as Parameters<typeof normalizeArchivedSession>[0])
    },
    onSuccess: async (session) => {
      toastManager.add({ type: 'success', title: t('chat.archive.restored' as SettingsKey) })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(undefined, true) }),
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(session.workspaceId ?? null) }),
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(session.workspaceId ?? null, true) }),
        queryClient.invalidateQueries({ queryKey: getSessionsByIdQueryKey({ path: { id: session.id } }) }),
      ])
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: t('chat.archive.restoreFailed' as SettingsKey),
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })

  return (
    <div className="flex flex-col gap-2" data-testid="chat-archived-sessions">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground">{t('chat.archive.label' as SettingsKey)}</div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('chat.archive.description' as SettingsKey)}</p>
        </div>
        <div className="shrink-0 rounded-full bg-muted/50 px-2 py-0.5 text-[10.5px] tabular-nums text-muted-foreground">
          {trimmedQuery ? `${filteredSessions.length}/${sortedSessions.length}` : sortedSessions.length}
        </div>
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60" aria-hidden="true" />
        <Input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={t('chat.archive.searchPlaceholder' as SettingsKey)}
          aria-label={t('chat.archive.searchPlaceholder' as SettingsKey)}
          className="h-8 pl-8 pr-2 text-[12.5px]"
          data-testid="chat-archived-sessions-search"
        />
      </div>

      {loading
        ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/10 bg-muted/20 px-4 py-5 text-[11px] text-muted-foreground/70">
            <Spinner className="size-3.5" />
            {t('chat.archive.loading' as SettingsKey)}
          </div>
        )
        : sortedSessions.length === 0
          ? (
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-foreground/10 bg-muted/20 px-4 py-5 text-center">
              <ArchiveRestoreIcon className="size-4 !text-muted-foreground/40" aria-hidden="true" />
              <span className="text-[11px] text-muted-foreground/70">{t('chat.archive.empty' as SettingsKey)}</span>
            </div>
          )
          : filteredSessions.length === 0
            ? (
              <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-foreground/10 bg-muted/20 px-4 py-5 text-center">
                <SearchIcon className="size-4 !text-muted-foreground/40" aria-hidden="true" />
                <span className="text-[11px] text-muted-foreground/70">{t('chat.archive.searchEmpty' as SettingsKey)}</span>
              </div>
            )
            : (
              <div className={cn('flex flex-col gap-1.5', filteredSessions.length > 6 && 'max-h-80 overflow-y-auto pr-1')}>
                {filteredSessions.map(session => (
                  <ArchivedSessionRow
                    key={session.id}
                    session={session}
                    restoring={restoreSession.isPending && restoreSession.variables === session.id}
                    onRestore={(target) => {
                      restoreSession.mutate(target.id)
                    }}
                  />
                ))}
              </div>
            )}
    </div>
  )
}

function ThinkingEffortPicker({
  value,
  options,
  disabled,
  onChange,
}: {
  value: TitleGenerationThinkingEffort
  options: Array<ThinkingOption<TitleGenerationThinkingEffort>>
  disabled: boolean
  onChange: (value: TitleGenerationThinkingEffort) => void
}) {
  const selected = options.find(option => option.value === value) ?? options[0]

  return (
    <Menu>
      <MenuTrigger render={<Button type="button" variant="ghost" size="xs" disabled={disabled} data-testid="chat-title-generation-thinking" />}>
        <BrainIcon className="size-3.5 shrink-0 !text-muted-foreground/70" aria-hidden="true" />
        <span className="max-w-24 truncate">{selected?.label}</span>
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        {options.map(option => (
          <MenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn('flex-col items-start', value === option.value && 'text-primary font-medium')}
          >
            <div className="flex w-full items-center gap-2">
              <span className="font-medium">{option.label}</span>
              <CheckIcon className={cn('ml-auto size-3.5 shrink-0', value === option.value ? '!text-primary' : '!text-transparent')} />
            </div>
            <span className="text-[11px] text-muted-foreground/60">{option.description}</span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}

function TitleGenerationSettings({
  prefs,
  saving,
  save,
}: {
  prefs: TitleGenerationPreferences
  saving: boolean
  save: (patch: Partial<TitleGenerationPreferences>) => void
}) {
  const { t } = useTranslation('settings')
  const [pendingProviderTargetId, setPendingProviderTargetId] = useState<string | null>(null)
  const { providerOptions } = useProviderTargets()
  const { runtimes } = useRuntimeCatalog()
  const titleGenerationRuntimeKinds = useMemo(
    () => runtimes
      .filter(runtime =>
        runtime.capabilities?.supportsTitleGeneration === true
        && runtimeCatalogItemUsesModelSelection(runtime))
      .map(runtime => runtime.runtimeKind),
    [runtimes],
  )
  const profiles = useMemo(
    () => listSelectableComposerProfilesForRuntimes({
      profiles: providerOptions,
      runtimeKinds: titleGenerationRuntimeKinds,
      runtimes,
    }),
    [providerOptions, runtimes, titleGenerationRuntimeKinds],
  )
  const selectedProviderTargetId = pendingProviderTargetId ?? prefs.providerTargetId
  const initialModelProfileIds = [prefs.providerTargetId, pendingProviderTargetId]
  const {
    modelsByProviderTargetId,
    loadingProviderTargetIds,
    successfulProviderTargetIds,
    requestProviderTargetModels,
  } = useProviderTargetModelMap(profiles, initialModelProfileIds)
  const selectedModels = selectedProviderTargetId ? modelsByProviderTargetId[selectedProviderTargetId] ?? [] : []
  const pendingProviderTargetExists = pendingProviderTargetId
    ? profiles.some(profile => profile.id === pendingProviderTargetId)
    : false
  const pendingProviderFirstModel = pendingProviderTargetId
    ? modelsByProviderTargetId[pendingProviderTargetId]?.[0] ?? null
    : null
  const selectedModelId = pendingProviderTargetId ? null : prefs.modelId
  const selectedModel = selectedModels.find(model => model.id === selectedModelId) ?? null
  const thinkingOptions = useMemo(
    () => TITLE_GENERATION_THINKING_LEVELS.map(value => ({
      value,
      label: t(titleGenerationThinkingLabelKeys[value]),
      description: t(titleGenerationThinkingDescriptionKeys[value]),
    })),
    [t],
  )
  const supportedThinkingOptions = selectedProviderTargetId && selectedModel ? filterThinkingOptionsForModel(selectedModel, thinkingOptions) : thinkingOptions
  const selectedThinkingEffort = selectedProviderTargetId && selectedModel
    ? selectTitleGenerationThinkingEffort(selectedModel, thinkingOptions, prefs.thinkingEffort)
    : prefs.thinkingEffort
  const selectThinkingForCurrentSelection = (thinkingEffort: TitleGenerationThinkingEffort): TitleGenerationThinkingEffort => {
    if (!selectedProviderTargetId || !selectedModel) {
      return thinkingEffort
    }
    return selectTitleGenerationThinkingEffort(selectedModel, thinkingOptions, thinkingEffort)
  }
  const saveResolvedModel = useCallback((providerTargetId: string, model: ModelDescriptor) => {
    save({
      providerTargetId,
      modelId: model.id,
      thinkingEffort: selectTitleGenerationThinkingEffort(model, thinkingOptions, prefs.thinkingEffort),
    })
  }, [prefs.thinkingEffort, save, thinkingOptions])

  useEffect(() => {
    if (!pendingProviderTargetId) {
      return
    }
    if (!pendingProviderTargetExists) {
      setPendingProviderTargetId(null)
      return
    }
    if (saving) {
      return
    }
    if (!pendingProviderFirstModel) {
      if (successfulProviderTargetIds.has(pendingProviderTargetId)) {
        save({ providerTargetId: pendingProviderTargetId, modelId: null })
        setPendingProviderTargetId(null)
      }
      return
    }
    saveResolvedModel(pendingProviderTargetId, pendingProviderFirstModel)
    setPendingProviderTargetId(null)
  }, [pendingProviderFirstModel, pendingProviderTargetExists, pendingProviderTargetId, save, saveResolvedModel, saving, successfulProviderTargetIds])

  return (
    <SettingsRow
      label={t('chat.titleGeneration.label' as SettingsKey)}
      description={t('chat.titleGeneration.description' as SettingsKey)}
    >
      <div className="flex items-center justify-end gap-1.5">
        <ProviderModelPicker
          providerTargets={profiles}
          selectedProviderTargetId={selectedProviderTargetId}
          selectedModelId={selectedModelId}
          selectedModel={selectedModel}
          modelsByProviderTargetId={modelsByProviderTargetId}
          loadingProviderTargetIds={loadingProviderTargetIds}
          thinkingValue={null}
          thinkingOptions={[]}
          emptyProviderTargetsLabel={t('chat.titleGeneration.emptyProfiles' as SettingsKey)}
          emptySelectionLabel={t('chat.titleGeneration.followCurrent' as SettingsKey)}
          menuSide="bottom"
          menuAlign="end"
          triggerTestId="chat-title-generation-model"
          disabled={saving}
          leadingSelection={{
            label: t('chat.titleGeneration.followCurrent' as SettingsKey),
            description: t('chat.titleGeneration.followCurrent.description' as SettingsKey),
            active: !selectedProviderTargetId,
            onSelect: () => {
              setPendingProviderTargetId(null)
              save({ providerTargetId: null, modelId: null })
            },
          }}
          onRequestProviderTargetModels={requestProviderTargetModels}
          onSelectProviderTarget={(providerTargetId) => {
            requestProviderTargetModels(providerTargetId)
            const nextModel = (modelsByProviderTargetId[providerTargetId] ?? [])[0] ?? null
            if (nextModel) {
              setPendingProviderTargetId(null)
              saveResolvedModel(providerTargetId, nextModel)
              return
            }
            if (successfulProviderTargetIds.has(providerTargetId)) {
              setPendingProviderTargetId(null)
              save({ providerTargetId, modelId: null })
              return
            }
            setPendingProviderTargetId(providerTargetId)
          }}
          onSelectModel={(modelId, providerTargetId) => {
            setPendingProviderTargetId(null)
            const nextModel = (modelsByProviderTargetId[providerTargetId] ?? []).find(model => model.id === modelId) ?? null
            save({
              providerTargetId,
              modelId,
              thinkingEffort: nextModel
                ? selectTitleGenerationThinkingEffort(nextModel, thinkingOptions, prefs.thinkingEffort)
                : prefs.thinkingEffort,
            })
          }}
          onSelectThinking={() => undefined}
        />
        <ThinkingEffortPicker
          value={selectedThinkingEffort}
          options={supportedThinkingOptions}
          disabled={saving}
          onChange={thinkingEffort => save({ thinkingEffort: selectThinkingForCurrentSelection(thinkingEffort) })}
        />
      </div>
    </SettingsRow>
  )
}

export function ChatSettings() {
  const { t } = useTranslation('settings')
  const { prefs, isSaving, savePrefs } = useChatPreferences()
  const { prefs: codexPrefs, isSaving: isSavingCodexPrefs, savePrefs: saveCodexPrefs } = useCodexPreferences()
  const handleTitleGenerationChange = (titleGeneration: Partial<TitleGenerationPreferences>) => {
    void savePrefs({ titleGeneration })
  }

  if (!prefs) {
    return null
  }

  const handleBehaviorChange = (value: string) => {
    if (value !== 'queue' && value !== 'steer') {
      return
    }
    void savePrefs({ continuationBehavior: value as ContinuationBehavior })
  }

  const handleCradleUserAgentChange = (useCradleUserAgent: boolean) => {
    void saveCodexPrefs({ useCradleUserAgent })
  }

  return (
    <SettingsPage
      title={t('chat.page.title')}
      description={t('chat.page.description')}
      data-testid="chat-settings"
    >
      <SettingsGroup>
        <SettingsRow
          label={t('chat.codexUserAgent.label' as SettingsKey)}
          description={t('chat.codexUserAgent.description' as SettingsKey)}
        >
          <Switch
            checked={codexPrefs?.useCradleUserAgent ?? true}
            onCheckedChange={handleCradleUserAgentChange}
            disabled={!codexPrefs || isSavingCodexPrefs}
            aria-label={t('chat.codexUserAgent.label' as SettingsKey)}
            data-testid="chat-codex-user-agent"
          />
        </SettingsRow>

        <TitleGenerationSettings
          prefs={prefs.titleGeneration}
          saving={isSaving}
          save={handleTitleGenerationChange}
        />

        <SettingsRow
          label={t('chat.continuation.label')}
          description={t('chat.continuation.description')}
        >
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={prefs.continuationBehavior}
            onValueChange={handleBehaviorChange}
            disabled={isSaving}
            aria-label={t('chat.continuation.label')}
            data-testid="chat-continuation-behavior"
          >
            <ToggleGroupItem value="queue" aria-label={t('chat.continuation.queue')}>
              {t('chat.continuation.queue')}
            </ToggleGroupItem>
            <ToggleGroupItem value="steer" aria-label={t('chat.continuation.steer')}>
              {t('chat.continuation.steer')}
            </ToggleGroupItem>
          </ToggleGroup>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup bare className="p-4">
        <ArchivedSessionList />
      </SettingsGroup>
    </SettingsPage>
  )
}
