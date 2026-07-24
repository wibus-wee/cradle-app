import {
  BrainLine as BrainIcon,
  ChipLine as CpuIcon,
  ClockLine as ClockIcon,
  DriveLine as HardDriveIcon,
  EyeLine as EyeIcon,
  FileMusicLine as FileAudioIcon,
  HeartbeatLine as ActivityIcon,
  Key2Line as KeyRoundIcon,
  LayersLine as LayersIcon,
  Message1Line as MessageSquareIcon,
  PicLine as ImageIcon,
  Refresh1Line as RefreshCwIcon,
  WarningLine as TriangleAlertIcon,
} from '@mingcute/react'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { useProviderTargetModelMap } from '~/features/agent-runtime/use-agent-models'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import type { ProviderModelOption } from '~/features/composer-toolbar/types'
import { SettingsGroup, SettingsPage } from '~/features/settings/settings-container'
import { SettingsRow } from '~/features/settings/settings-row'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'
import { formatPercentFromRatio, formatShortDurationMs } from '~/lib/number-format'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import {
  ChronicleActivityPipelineContainer,
} from './chronicle-activity-pipeline-container'
import {
  ChronicleDreamRunContainer,
} from './chronicle-dream-run-container'
import {
  ChronicleEmptyState,
} from './chronicle-empty-state'
import {
  ChronicleKnowledgeCardGridView,
} from './chronicle-knowledge-card-grid-view'
import {
  ChronicleMemorySearchView,
} from './chronicle-memory-search-view'
import {
  ChronicleResourceGridContainer,
} from './chronicle-resource-grid-container'
import {
  ChronicleSpeakerProfileGridView,
} from './chronicle-speaker-profile-grid-view'
import {
  formatChronicleDateTime as formatDateTime,
  formatChronicleRelativeTime as formatRelativeTime,
} from './chronicle-time-presenter'
import {
  ChronicleTimelineFeedContainer,
} from './chronicle-timeline-feed-container'
import type {
  ChronicleAccessibilityEvent,
  ChronicleAccessibilitySnapshot,
  ChronicleAudioRawSegment,
  ChronicleAudioTranscript,
  ChronicleConfig,
  ChronicleMessageSource,
  ChronicleSlackSourceDraft,
  ChronicleStatus,
} from './use-chronicle.ts'
import {
  useChronicleAccessibilityEvents,
  useChronicleAccessibilitySnapshots,
  useChronicleActivitySegments,
  useChronicleAudioRawSegments,
  useChronicleAudioTranscripts,
  useChronicleConfig,
  useChronicleDreamRuns,
  useChronicleKnowledgeCard,
  useChronicleKnowledgeCards,
  useChronicleMemories,
  useChronicleMemory,
  useChronicleMemorySearch,
  useChronicleMessageSources,
  useChronicleModelResources,
  useChroniclePipelineRuns,
  useChronicleSlackSourceActions,
  useChronicleSpeakerProfiles,
  useChronicleStatus,
  useChronicleTimeline,
  useRefreshChronicleQueries,
} from './use-chronicle.ts'

const MEMORY_SEARCH_LIMIT = 50
const PRIVACY_RULE_LINE_SPLIT_RE = /\r?\n/
type ChronicleTranslate = TFunction<'chronicle'>

const AccessibilityTreeNodeSchema = z.object({
  role: z.string().nullable().optional().transform(value => value?.trim() || 'AXElement'),
  label: z.union([z.string(), z.number(), z.boolean()]).nullable().optional().transform(value => value === null || value === undefined ? '' : String(value)),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable().optional().transform(value => value === null || value === undefined ? '' : String(value)),
  depth: z.coerce.number().finite().nullable().optional().transform(value => value ?? 0),
  path: z.string().min(1).nullable().optional(),
}).passthrough().transform(node => ({
  role: node.role,
  label: node.label,
  value: node.value,
  depth: node.depth,
  path: node.path ?? `${node.role}:${node.label}:${node.depth}`,
}))
const AccessibilitySnapshotMetadataSchema = z.object({
  artifactPath: z.string().optional(),
}).passthrough()

interface ChronicleSetupNotice {
  title: string
  description: string
  actionLabel: string | null
  actionKind: 'open-providers' | 'select-model' | null
}

function getChronicleSetupNotice({
  t,
  hasConfiguredModel,
  profileCount,
  loadingProfiles,
}: {
  t: ChronicleTranslate
  hasConfiguredModel: boolean
  profileCount: number
  loadingProfiles: boolean
}): ChronicleSetupNotice | null {
  if (hasConfiguredModel) {
    return null
  }
  if (loadingProfiles) {
    return {
      title: t('setup.loadingModels.title'),
      description: t('setup.loadingModels.description'),
      actionLabel: null,
      actionKind: null,
    }
  }
  if (profileCount === 0) {
    return {
      title: t('setup.missingProvider.title'),
      description: t('setup.missingProvider.description'),
      actionLabel: t('setup.missingProvider.action'),
      actionKind: 'open-providers',
    }
  }
  return {
    title: t('setup.missingModel.title'),
    description: t('setup.missingModel.description'),
    actionLabel: t('setup.missingModel.action'),
    actionKind: 'select-model',
  }
}

function getControlDisabledReason({
  t,
  saving,
  blocked,
  reason,
}: {
  t: ChronicleTranslate
  saving: boolean
  blocked: boolean
  reason: string
}): string | null {
  if (saving) {
    return t('common.status.savingSettings')
  }
  return blocked ? reason : null
}

function prependFocusedItem<T extends { id: string }>(items: T[], focusedItem: T | null): T[] {
  if (!focusedItem) {
    return items
  }

  return [
    focusedItem,
    ...items.filter(item => item.id !== focusedItem.id),
  ]
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ChronicleSettings() {
  const { t } = useTranslation('chronicle')
  const { config, loading: configLoading, saving, updateConfig } = useChronicleConfig()
  const { status, loading: statusLoading } = useChronicleStatus()
  const { resources, loading: resourcesLoading } = useChronicleModelResources()
  const { sources: messageSources, loading: messageSourcesLoading } = useChronicleMessageSources()
  const { snapshots: accessibilitySnapshots, loading: accessibilitySnapshotsLoading } = useChronicleAccessibilitySnapshots()
  const { events: accessibilityEvents, loading: accessibilityEventsLoading } = useChronicleAccessibilityEvents()
  const { transcripts: audioTranscripts, loading: audioTranscriptsLoading } = useChronicleAudioTranscripts()
  const { segments: audioRawSegments, loading: audioRawSegmentsLoading } = useChronicleAudioRawSegments()
  const { profiles: speakerProfiles, loading: speakerProfilesLoading } = useChronicleSpeakerProfiles()
  const { segments: activitySegments, loading: activitySegmentsLoading } = useChronicleActivitySegments()
  const { runs: pipelineRuns, loading: pipelineRunsLoading } = useChroniclePipelineRuns()
  const { cards: knowledgeCards, loading: knowledgeCardsLoading } = useChronicleKnowledgeCards()
  const { runs: dreamRuns, loading: dreamRunsLoading } = useChronicleDreamRuns()
  const { entries: timelineEntries, loading: timelineLoading } = useChronicleTimeline()
  const { entries: memoryEntries, loading: memoriesLoading } = useChronicleMemories(MEMORY_SEARCH_LIMIT)
  const [searchQuery, setSearchQuery] = useState('')
  const {
    entries: searchedMemoryEntries,
    hasQuery: hasSearchQuery,
    searching: searchingMemories,
  } = useChronicleMemorySearch(searchQuery, MEMORY_SEARCH_LIMIT)
  const refreshChronicle = useRefreshChronicleQueries()
  const { providerOptions, isLoading: providerTargetsLoading } = useProviderTargets()
  const setSettingsSection = useSettingsOverlayStore(state => state.setSettingsSection)
  const chronicleFocusTarget = useSettingsOverlayStore(state => state.chronicleFocusTarget)
  const clearChronicleFocusTarget = useSettingsOverlayStore(state => state.clearChronicleFocusTarget)
  const { entry: focusedMemoryEntry, loading: focusedMemoryLoading } = useChronicleMemory(
    chronicleFocusTarget?.type === 'memory' ? chronicleFocusTarget.id : null,
  )
  const { card: focusedKnowledgeCard, loading: focusedKnowledgeLoading } = useChronicleKnowledgeCard(
    chronicleFocusTarget?.type === 'knowledge' ? chronicleFocusTarget.id : null,
  )
  const memorySectionRef = useRef<HTMLDivElement>(null)
  const knowledgeSectionRef = useRef<HTMLDivElement>(null)

  const profiles = useMemo(
    () => providerOptions.filter(profile => profile.enabled),
    [providerOptions],
  )
  const selectedProfile = useMemo(
    () => profiles.find(profile => profile.id === config?.profileId) ?? null,
    [config?.profileId, profiles],
  )
  const initialModelProfileIds = useMemo(() => [config?.profileId ?? null], [config?.profileId])
  const {
    modelsByProviderTargetId: modelsByProfileId,
    loadingProviderTargetIds: loadingProfileIds,
    successfulProviderTargetIds: successfulProfileIds,
    requestProviderTargetModels: requestProfileModels,
  } = useProviderTargetModelMap(
    profiles,
    initialModelProfileIds,
  )
  const selectedModels = selectedProfile ? modelsByProfileId[selectedProfile.id] ?? [] : []
  const selectedModel = selectedModels.find(model => model.id === config?.modelId) ?? null
  const baseMemoryEntries = hasSearchQuery ? searchedMemoryEntries : memoryEntries
  const visibleMemoryEntries = useMemo(
    () => prependFocusedItem(baseMemoryEntries, focusedMemoryEntry),
    [baseMemoryEntries, focusedMemoryEntry],
  )
  const visibleKnowledgeCards = useMemo(
    () => prependFocusedItem(knowledgeCards, focusedKnowledgeCard),
    [knowledgeCards, focusedKnowledgeCard],
  )
  const focusedMemoryVisible = chronicleFocusTarget?.type === 'memory'
    && visibleMemoryEntries.some(entry => entry.id === chronicleFocusTarget.id)
  const focusedKnowledgeVisible = chronicleFocusTarget?.type === 'knowledge'
    && visibleKnowledgeCards.some(card => card.id === chronicleFocusTarget.id)
  const modelLabel = status?.configuredModel ?? selectedModel?.id ?? config?.modelId ?? null
  const canEnable = Boolean(selectedProfile && config?.modelId)
  const disabledRootReason = canEnable ? t('control.reason.enableCaptureFirst') : t('control.reason.selectModelAndEnableCapture')
  const setupNotice = getChronicleSetupNotice({
    t,
    hasConfiguredModel: canEnable,
    profileCount: profiles.length,
    loadingProfiles: providerTargetsLoading || loadingProfileIds.size > 0,
  })
  const captureDisabledReason = getControlDisabledReason({
    t,
    saving,
    blocked: !canEnable,
    reason: t('control.reason.selectModelFirst'),
  })
  const activityDisabledReason = getControlDisabledReason({
    t,
    saving,
    blocked: !config?.enabled,
    reason: disabledRootReason,
  })
  const audioDisabledReason = getControlDisabledReason({
    t,
    saving,
    blocked: !config?.enabled,
    reason: disabledRootReason,
  })
  const audioSourceDisabledReason = getControlDisabledReason({
    t,
    saving,
    blocked: !config?.enabled || !config?.audioCaptureEnabled,
    reason: !config?.enabled ? disabledRootReason : t('control.reason.enableAudioFirst'),
  })
  const dependencyNotice = canEnable && !config?.enabled
    ? {
        title: t('dependencyNotice.title'),
        description: t('dependencyNotice.description'),
      }
    : null
  const settingsChronicleReady = !configLoading
    && !statusLoading
    && !resourcesLoading
    && !messageSourcesLoading
    && !accessibilitySnapshotsLoading
    && !accessibilityEventsLoading
    && !audioTranscriptsLoading
    && !audioRawSegmentsLoading
    && !speakerProfilesLoading
    && !activitySegmentsLoading
    && !pipelineRunsLoading
    && !knowledgeCardsLoading
    && !dreamRunsLoading
    && !timelineLoading
    && !memoriesLoading
    && !providerTargetsLoading
    && loadingProfileIds.size === 0
    && !focusedMemoryLoading
    && !focusedKnowledgeLoading
    && !searchingMemories

  const localizedCaptureStatus = !canEnable
    ? t('control.status.waitingForModel')
    : config?.enabled
      ? t('common.status.enabled')
      : t('common.status.notEnabled')
  const localizedActivityStatus = !config?.enabled
    ? t('control.status.waitingForCapture')
    : config?.activityPipelineEnabled ?? false
      ? t('common.status.enabled')
      : t('common.status.disabled')
  const localizedDreamStatus = !config?.enabled
    ? t('control.status.waitingForCapture')
    : config?.dreamSchedulerEnabled ?? false
      ? config?.dreamSchedulerApplyMerge
        ? t('control.status.autoMerge')
        : t('control.status.previewOnly')
      : t('common.status.disabled')
  const localizedAudioStatus = !config?.enabled
    ? t('control.status.waitingForCapture')
    : config?.audioCaptureEnabled
      ? t('common.status.enabled')
      : t('common.status.notEnabled')

  useEffect(() => {
    if (!chronicleFocusTarget) {
      return
    }

    const sectionRef = chronicleFocusTarget.type === 'memory' ? memorySectionRef : knowledgeSectionRef
    const focusVisible = chronicleFocusTarget.type === 'memory' ? focusedMemoryVisible : focusedKnowledgeVisible
    if (!focusVisible) {
      return
    }

    sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    const timeout = window.setTimeout(clearChronicleFocusTarget, 4_000)
    return () => window.clearTimeout(timeout)
  }, [chronicleFocusTarget, clearChronicleFocusTarget, focusedKnowledgeVisible, focusedMemoryVisible])

  if (configLoading) {
    return null
  }

  return (
    <SettingsPage
      title={t('page.title')}
      description={t('page.description')}
      action={(
        <div className="flex items-center gap-2">
          <StatusBadge running={status?.running ?? false} available={status?.available ?? false} />
          <Button type="button" variant="outline" size="xs" onClick={refreshChronicle} className="transition-transform active:scale-[0.96]">
            <RefreshCwIcon className="size-3" />
            {t('common.action.refresh')}
          </Button>
        </div>
      )}
      maxWidth="4xl"
      data-testid="chronicle-settings"
      data-settings-chronicle-ready={settingsChronicleReady ? 'true' : 'false'}
    >
      {/* Setup / dependency notices */}
      {setupNotice && (
        <Alert className="border-amber-500/20 bg-amber-500/5 text-amber-800 dark:text-amber-300">
          <TriangleAlertIcon className="size-4" aria-hidden="true" />
          <AlertTitle>{setupNotice.title}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 text-[12px] leading-5 md:flex-row md:items-center md:justify-between">
            <span>{setupNotice.description}</span>
            {setupNotice.actionLabel && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit border-amber-500/30 bg-background/70 text-amber-800 transition-transform hover:bg-amber-500/10 active:scale-[0.96] dark:text-amber-200"
                disabled={saving}
                onClick={() => {
                  if (setupNotice.actionKind === 'open-providers') {
                    setSettingsSection('providers')
                    return
                  }
                  const trigger = document.querySelector<HTMLElement>('[data-testid="chronicle-provider-model-selector"]')
                  trigger?.focus()
                  trigger?.click()
                }}
              >
                {setupNotice.actionLabel}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {dependencyNotice && (
        <Alert className="border-border bg-muted/30">
          <TriangleAlertIcon className="size-4 !text-muted-foreground" aria-hidden="true" />
          <AlertTitle>{dependencyNotice.title}</AlertTitle>
          <AlertDescription className="text-[12px] leading-5">
            {dependencyNotice.description}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Section: Controls ── */}
      <SettingsGroup>
        <SettingsRow
          label={t('control.capture.title')}
          description={canEnable ? t('control.capture.description.enabled') : t('control.capture.description.blocked')}
          labelAccessory={(
            <StatusBadgeInline tone={config?.enabled ? 'enabled' : captureDisabledReason ? 'warning' : 'disabled'}>
              {localizedCaptureStatus}
            </StatusBadgeInline>
          )}
        >
          <Switch
            checked={config?.enabled ?? false}
            onCheckedChange={(enabled) => {
              void updateConfig(enabled
                ? { enabled, activityPipelineEnabled: false, dreamSchedulerEnabled: false }
                : { enabled })
            }}
            disabled={saving || !canEnable}
          />
        </SettingsRow>

        <ChronicleModelRow
          saving={saving}
          profiles={profiles}
          selectedProfileId={config?.profileId ?? null}
          selectedModelId={config?.modelId ?? null}
          selectedModel={selectedModel}
          modelsByProfileId={modelsByProfileId}
          loadingProfileIds={loadingProfileIds}
          successfulProfileIds={successfulProfileIds}
          requestProfileModels={requestProfileModels}
          onUpdateConfig={updateConfig}
        />

        <SettingsRow
          label={t('control.activity.title')}
          description={config?.enabled ? t('control.activity.description.enabled') : t('control.activity.description.blocked')}
          labelAccessory={(
            <StatusBadgeInline tone={config?.enabled && (config?.activityPipelineEnabled ?? false) ? 'enabled' : activityDisabledReason ? 'warning' : 'disabled'}>
              {localizedActivityStatus}
            </StatusBadgeInline>
          )}
        >
          <Switch
            checked={config?.activityPipelineEnabled ?? false}
            onCheckedChange={activityPipelineEnabled => void updateConfig({ activityPipelineEnabled })}
            disabled={saving || !config?.enabled}
          />
        </SettingsRow>

        <SettingsRow
          label={t('control.dream.title')}
          description={config?.enabled ? t('control.dream.description.enabled') : t('control.dream.description.blocked')}
          labelAccessory={(
            <StatusBadgeInline tone={config?.enabled && (config?.dreamSchedulerEnabled ?? false) ? 'enabled' : activityDisabledReason ? 'warning' : 'disabled'}>
              {localizedDreamStatus}
            </StatusBadgeInline>
          )}
        >
          <Switch
            checked={config?.dreamSchedulerEnabled ?? false}
            onCheckedChange={dreamSchedulerEnabled => void updateConfig({ dreamSchedulerEnabled })}
            disabled={saving || !config?.enabled}
          />
        </SettingsRow>

        <SettingsRow
          label={t('control.audio.title')}
          description={config?.enabled ? t('control.audio.description.enabled') : t('control.audio.description.blocked')}
          labelAccessory={(
            <StatusBadgeInline tone={config?.enabled && config?.audioCaptureEnabled ? 'enabled' : audioDisabledReason || audioSourceDisabledReason ? 'warning' : 'disabled'}>
              {localizedAudioStatus}
            </StatusBadgeInline>
          )}
        >
          <div className="flex items-center gap-2">
            <select
              className="h-8 max-w-40 rounded-md border border-border bg-background px-2 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              value={config?.audioSource ?? 'microphone'}
              onChange={event => void updateConfig({ audioSource: event.target.value as ChronicleConfig['audioSource'] })}
              disabled={saving || !config?.enabled || !config?.audioCaptureEnabled}
            >
              <option value="microphone">{t('control.audio.source.microphone')}</option>
              <option value="system">{t('control.audio.source.system')}</option>
              <option value="mixed">{t('control.audio.source.mixed')}</option>
            </select>
            <Switch
              checked={config?.audioCaptureEnabled ?? false}
              onCheckedChange={audioCaptureEnabled => void updateConfig({ audioCaptureEnabled })}
              disabled={saving || !config?.enabled}
            />
          </div>
        </SettingsRow>
      </SettingsGroup>

      {/* ── Section: Data Sources ── */}
      <SettingsGroup
        label={t('sources.title')}
        description={t('sources.description')}
        action={(
          <Badge variant="secondary" className="text-[11px] tabular-nums">
            {t('sources.metric.total', {
              screen: status?.totalAccessibilitySnapshots ?? 0,
              messages: status?.totalMessages ?? 0,
              audio: status?.totalAudioTranscripts ?? 0,
            })}
          </Badge>
        )}
      >
        <SettingsRow
          label={t('sources.screen.title')}
          description={t('sources.screen.description')}
          labelAccessory={<Badge variant="outline" className="text-[11px] tabular-nums">{status?.totalAccessibilitySnapshots ?? 0}</Badge>}
        >
          <Badge variant="outline" className="text-[11px]">{t('sources.screen.active')}</Badge>
        </SettingsRow>

        <SettingsRow
          label={t('sources.slack.title')}
          description={t('sources.slack.description')}
          labelAccessory={<Badge variant="outline" className="text-[11px] tabular-nums">{status?.totalMessages ?? 0}</Badge>}
        >
          <Badge variant={messageSources.length > 0 ? 'secondary' : 'outline'} className="text-[11px]">
            {messageSources.length > 0 ? t('common.status.enabled') : t('common.status.disconnected')}
          </Badge>
        </SettingsRow>

        <SettingsRow
          label={t('sources.audio.title')}
          description={t('sources.audio.description')}
          labelAccessory={<Badge variant="outline" className="text-[11px] tabular-nums">{status?.totalAudioTranscripts ?? 0}</Badge>}
        >
          <Badge variant={config?.audioCaptureEnabled ? 'secondary' : 'outline'} className="text-[11px]">
            {config?.audioCaptureEnabled ? t('common.status.enabled') : t('common.status.notEnabled')}
          </Badge>
        </SettingsRow>
      </SettingsGroup>

      {/* ── Section: Memory & Knowledge ── */}
      <SettingsGroup
        label={t('memorySection.title')}
        description={t('memorySection.description')}
        action={(
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-[11px] tabular-nums">
              {t('hero.metric.memories')}
              {' '}
              {status?.totalSummaries ?? 0}
            </Badge>
            <Badge variant="secondary" className="text-[11px] tabular-nums">
              {t('hero.metric.knowledgeCards')}
              {' '}
              {status?.totalKnowledgeCards ?? 0}
            </Badge>
          </div>
        )}
      >
        <SettingsRow label={t('recentActivity.title')} description={t('recentActivity.description')} vertical>
          {timelineLoading
            ? <ChronicleEmptyState icon={<ImageIcon className="size-4" />} title={t('recentActivity.loading')} />
            : timelineEntries.length === 0
              ? <ChronicleEmptyState icon={<ImageIcon className="size-4" />} title={t('recentActivity.empty')} />
              : <ChronicleTimelineFeedContainer entries={timelineEntries} />}
        </SettingsRow>

        <div ref={memorySectionRef}>
          <SettingsRow label={t('memorySearch.title')} description={t('memorySearch.description')} vertical>
            <ChronicleMemorySearchView
              query={searchQuery}
              loading={memoriesLoading || searchingMemories || focusedMemoryLoading}
              entries={visibleMemoryEntries}
              focusedMemoryId={chronicleFocusTarget?.type === 'memory' ? chronicleFocusTarget.id : null}
              onQueryChange={setSearchQuery}
            />
          </SettingsRow>
        </div>

        <div ref={knowledgeSectionRef}>
          <SettingsRow label={t('knowledge.title')} description={t('knowledge.description')} vertical>
            <ChronicleKnowledgeCardGridView
              loading={knowledgeCardsLoading || focusedKnowledgeLoading}
              cards={visibleKnowledgeCards}
              focusedKnowledgeId={chronicleFocusTarget?.type === 'knowledge' ? chronicleFocusTarget.id : null}
            />
          </SettingsRow>
        </div>

        <SettingsRow label={t('speakers.title')} description={t('speakers.description')} vertical>
          <ChronicleSpeakerProfileGridView
            loading={speakerProfilesLoading}
            profiles={speakerProfiles}
          />
        </SettingsRow>
      </SettingsGroup>

      {/* ── Section: Privacy ── */}
      <SettingsGroup label={t('privacySection.title')} description={t('privacySection.description')} bare className="p-4">
        <PrivacyRulesPanel
          config={config}
          saving={saving}
          onUpdateConfig={updateConfig}
        />
      </SettingsGroup>

      {/* ── Section: Advanced & Diagnostics ── */}
      <details className="group rounded-xl border border-border bg-card">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] font-medium text-foreground">
          {t('advanced.summary.title')}
          <span className="text-[12px] font-normal text-muted-foreground">{t('advanced.summary.description')}</span>
        </summary>
        <div className="border-t border-border/60 px-4 pb-4 pt-3">
          <section className="py-2">
            <StatusPanel
              loading={statusLoading}
              running={status?.running ?? false}
              available={status?.available ?? false}
              pid={status?.pid ?? null}
              lastSummaryAt={status?.lastSummaryAt ?? null}
              lastExitAt={status?.lastExitAt ?? null}
              lastExitCode={status?.lastExitCode ?? null}
              totalSummaries={status?.totalSummaries ?? 0}
              totalMessages={status?.totalMessages ?? 0}
              lastMessageAt={status?.lastMessageAt ?? null}
              totalAccessibilitySnapshots={status?.totalAccessibilitySnapshots ?? 0}
              lastAccessibilitySnapshotAt={status?.lastAccessibilitySnapshotAt ?? null}
              totalAccessibilityEvents={status?.totalAccessibilityEvents ?? 0}
              lastAccessibilityEventAt={status?.lastAccessibilityEventAt ?? null}
              totalAudioTranscripts={status?.totalAudioTranscripts ?? 0}
              lastAudioTranscriptAt={status?.lastAudioTranscriptAt ?? null}
              totalAudioRawSegments={status?.totalAudioRawSegments ?? 0}
              lastAudioRawSegmentAt={status?.lastAudioRawSegmentAt ?? null}
              totalActivitySegments={status?.totalActivitySegments ?? 0}
              totalPipelineRuns={status?.totalPipelineRuns ?? 0}
              totalKnowledgeCards={status?.totalKnowledgeCards ?? 0}
              totalDreamRuns={status?.totalDreamRuns ?? 0}
              activityPipelineEnabled={status?.activityPipelineEnabled ?? config?.activityPipelineEnabled ?? false}
              activityPipelineRunning={status?.activityPipelineRunning ?? false}
              activityPipelineIntervalMs={status?.activityPipelineIntervalMs ?? config?.activityPipelineIntervalMs ?? 120_000}
              activityPipelineBatchSize={status?.activityPipelineBatchSize ?? config?.activityPipelineBatchSize ?? 3}
              dreamSchedulerEnabled={status?.dreamSchedulerEnabled ?? config?.dreamSchedulerEnabled ?? false}
              dreamSchedulerRunning={status?.dreamSchedulerRunning ?? false}
              dreamSchedulerIntervalMs={status?.dreamSchedulerIntervalMs ?? config?.dreamSchedulerIntervalMs ?? 86_400_000}
              dreamSchedulerApplyMerge={status?.dreamSchedulerApplyMerge ?? config?.dreamSchedulerApplyMerge ?? false}
              audioCaptureEnabled={status?.audioCaptureEnabled ?? config?.audioCaptureEnabled ?? false}
              audioRuntimeStatus={status?.audioRuntimeStatus ?? 'disabled'}
              modelLabel={modelLabel}
              storageRoot={config?.storageRoot ?? null}
            />
          </section>

          <SettingsRow label={t('advanced.messageSources.title')} description={t('advanced.messageSources.description')} vertical>
            <SlackSourcePanel loading={messageSourcesLoading} sources={messageSources} />
          </SettingsRow>
          <div className="border-t border-border/60" />

          <AdvancedDiagnosticSection title={t('advanced.resources.title')} description={t('advanced.resources.description')}>
            <ChronicleResourceGridContainer
              loading={resourcesLoading}
              resources={resources}
            />
          </AdvancedDiagnosticSection>
          <div className="border-t border-border/60" />

          <SettingsRow label={t('advanced.accessibilitySnapshots.title')} description={t('advanced.accessibilitySnapshots.description')} vertical>
            {accessibilitySnapshotsLoading
              ? <ChronicleEmptyState icon={<EyeIcon className="size-4" />} title={t('advanced.accessibilitySnapshots.loading')} />
              : accessibilitySnapshots.length === 0
                ? <ChronicleEmptyState icon={<EyeIcon className="size-4" />} title={t('advanced.accessibilitySnapshots.empty')} />
                : <AccessibilitySnapshotList snapshots={accessibilitySnapshots} />}
          </SettingsRow>
          <div className="border-t border-border/60" />

          <SettingsRow label={t('advanced.accessibilityEvents.title')} description={t('advanced.accessibilityEvents.description')} vertical>
            {accessibilityEventsLoading
              ? <ChronicleEmptyState icon={<ActivityIcon className="size-4" />} title={t('advanced.accessibilityEvents.loading')} />
              : accessibilityEvents.length === 0
                ? <ChronicleEmptyState icon={<ActivityIcon className="size-4" />} title={t('advanced.accessibilityEvents.empty')} />
                : <AccessibilityEventList events={accessibilityEvents} />}
          </SettingsRow>
          <div className="border-t border-border/60" />

          <SettingsRow label={t('advanced.audioSegments.title')} description={t('advanced.audioSegments.description')} vertical>
            {audioRawSegmentsLoading
              ? <ChronicleEmptyState icon={<FileAudioIcon className="size-4" />} title={t('advanced.audioSegments.loading')} />
              : audioRawSegments.length === 0
                ? <ChronicleEmptyState icon={<FileAudioIcon className="size-4" />} title={t('advanced.audioSegments.empty')} />
                : <AudioRawSegmentList segments={audioRawSegments} />}
          </SettingsRow>
          <div className="border-t border-border/60" />

          <SettingsRow label={t('advanced.transcripts.title')} description={t('advanced.transcripts.description')} vertical>
            {audioTranscriptsLoading
              ? <ChronicleEmptyState icon={<FileAudioIcon className="size-4" />} title={t('advanced.transcripts.loading')} />
              : audioTranscripts.length === 0
                ? <ChronicleEmptyState icon={<FileAudioIcon className="size-4" />} title={t('advanced.transcripts.empty')} />
                : <AudioTranscriptList transcripts={audioTranscripts} />}
          </SettingsRow>
          <div className="border-t border-border/60" />

          <AdvancedDiagnosticSection title={t('advanced.activitySegments.title')} description={t('advanced.activitySegments.description')}>
            {activitySegmentsLoading || pipelineRunsLoading
              ? <ChronicleEmptyState icon={<ActivityIcon className="size-4" />} title={t('advanced.activitySegments.loading')} />
              : activitySegments.length === 0
                ? <ChronicleEmptyState icon={<ActivityIcon className="size-4" />} title={t('advanced.activitySegments.empty')} />
                : (
                    <ChronicleActivityPipelineContainer
                      segments={activitySegments}
                      runs={pipelineRuns}
                    />
                  )}
          </AdvancedDiagnosticSection>
          <div className="border-t border-border/60" />

          <SettingsRow label={t('advanced.dreamRuns.title')} description={t('advanced.dreamRuns.description')} vertical>
            <ChronicleDreamRunContainer loading={dreamRunsLoading} runs={dreamRuns} />
          </SettingsRow>
        </div>
      </details>
    </SettingsPage>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadgeInline({ tone, children }: { tone: 'enabled' | 'disabled' | 'warning' | 'muted', children: ReactNode }) {
  return (
    <Badge
      variant={tone === 'enabled' ? 'secondary' : 'outline'}
      className={cn(
        'text-[11px]',
        {
          'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300': tone === 'enabled',
          'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-200': tone === 'warning',
          'text-muted-foreground': tone === 'disabled' || tone === 'muted',
        },
      )}
    >
      {children}
    </Badge>
  )
}

function AdvancedDiagnosticSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="py-3">
      <div className="mb-3 min-w-0">
        <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
        {description && (
          <p className="mt-0.5 max-w-3xl text-[12px] text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

function StatusBadge({ running, available }: { running: boolean, available: boolean }) {
  const { t } = useTranslation('chronicle')

  if (running) {
    return <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">{t('common.status.running')}</Badge>
  }
  if (available) {
    return <Badge variant="secondary">{t('common.status.ready')}</Badge>
  }
  return <Badge variant="outline">{t('common.status.notConfigured')}</Badge>
}

function ChronicleModelRow({
  saving,
  profiles,
  selectedProfileId,
  selectedModelId,
  selectedModel,
  modelsByProfileId,
  loadingProfileIds,
  successfulProfileIds,
  requestProfileModels,
  onUpdateConfig,
}: {
  saving: boolean
  profiles: ProviderModelOption[]
  selectedProfileId: string | null
  selectedModelId: string | null
  selectedModel: Parameters<typeof ProviderModelPicker>[0]['selectedModel']
  modelsByProfileId: ReturnType<typeof useProviderTargetModelMap>['modelsByProviderTargetId']
  loadingProfileIds: ReturnType<typeof useProviderTargetModelMap>['loadingProviderTargetIds']
  successfulProfileIds: ReturnType<typeof useProviderTargetModelMap>['successfulProviderTargetIds']
  requestProfileModels: ReturnType<typeof useProviderTargetModelMap>['requestProviderTargetModels']
  onUpdateConfig: (updates: Partial<ChronicleConfig>) => Promise<ChronicleConfig | null>
}) {
  const { t } = useTranslation('chronicle')
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null)
  const displayProfileId = pendingProfileId ?? selectedProfileId
  const displayModelId = pendingProfileId ? null : selectedModelId
  const displaySelectedModel = pendingProfileId ? null : selectedModel
  const isLoadingDisplayModels = displayProfileId ? loadingProfileIds.has(displayProfileId) : false
  const modelStatus = displayModelId ? t('control.status.selected') : t('control.status.notSelected')

  useEffect(() => {
    if (!pendingProfileId) {
      return
    }
    if (saving) {
      return
    }
    if (!profiles.some(profile => profile.id === pendingProfileId)) {
      setPendingProfileId(null)
      return
    }
    const nextModel = (modelsByProfileId[pendingProfileId] ?? [])[0] ?? null
    if (!nextModel) {
      if (successfulProfileIds.has(pendingProfileId)) {
        setPendingProfileId(null)
      }
      return
    }
    void onUpdateConfig({ profileId: pendingProfileId, modelId: nextModel.id })
    setPendingProfileId(null)
  }, [modelsByProfileId, onUpdateConfig, pendingProfileId, profiles, saving, successfulProfileIds])

  return (
    <SettingsRow
      label={t('control.model.title')}
      description={t('control.model.description')}
      labelAccessory={(
        <StatusBadgeInline tone={displayModelId ? 'enabled' : 'warning'}>
          {modelStatus}
        </StatusBadgeInline>
      )}
    >
      <ProviderModelPicker
        providerTargets={profiles}
        selectedProviderTargetId={displayProfileId}
        selectedModelId={displayModelId}
        selectedModel={displaySelectedModel}
        modelsByProviderTargetId={modelsByProfileId}
        loadingProviderTargetIds={loadingProfileIds}
        thinkingValue={null}
        thinkingOptions={[]}
        isLoadingSelectedModels={isLoadingDisplayModels}
        emptyProviderTargetsLabel={t('control.model.emptyProfiles')}
        emptySelectionLabel={t('control.model.emptySelection')}
        menuSide="bottom"
        menuAlign="end"
        triggerTestId="chronicle-provider-model-selector"
        disabled={saving}
        onRequestProviderTargetModels={requestProfileModels}
        onSelectProviderTarget={(profileId) => {
          requestProfileModels(profileId)
          const nextModel = (modelsByProfileId[profileId] ?? [])[0] ?? null
          if (!nextModel) {
            setPendingProfileId(profileId)
            return
          }
          setPendingProfileId(null)
          void onUpdateConfig({ profileId, modelId: nextModel.id })
        }}
        onSelectModel={(model, profileId) => {
          if (!model) {
            return
          }
          setPendingProfileId(null)
          void onUpdateConfig({ profileId, modelId: model })
        }}
        onSelectThinking={() => {}}
      />
    </SettingsRow>
  )
}

export function PrivacyRulesPanel({
  config,
  saving,
  onUpdateConfig,
}: {
  config: ChronicleConfig | null
  saving: boolean
  onUpdateConfig: (updates: Partial<ChronicleConfig>) => Promise<ChronicleConfig | null>
}) {
  const { t } = useTranslation('chronicle')
  const [draft, setDraft] = useState<PrivacyRulesDraft>({
    appBundleText: '',
    titlePatternText: '',
    urlPatternText: '',
  })
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setDraft({
      appBundleText: formatPrivacyRuleLines(config?.privacySensitiveAppBundleIds ?? []),
      titlePatternText: formatPrivacyRuleLines(config?.privacySensitiveTitlePatterns ?? []),
      urlPatternText: formatPrivacyRuleLines(config?.privacySensitiveUrlPatterns ?? []),
    })
    setSaved(false)
  }, [
    config?.privacySensitiveAppBundleIds,
    config?.privacySensitiveTitlePatterns,
    config?.privacySensitiveUrlPatterns,
  ])

  const nextAppBundleIds = parsePrivacyRuleLines(draft.appBundleText)
  const nextTitlePatterns = parsePrivacyRuleLines(draft.titlePatternText)
  const nextUrlPatterns = parsePrivacyRuleLines(draft.urlPatternText)
  const ruleCount = nextAppBundleIds.length + nextTitlePatterns.length + nextUrlPatterns.length
  const hasChanges = config
    ? !stringListsEqual(nextAppBundleIds, config.privacySensitiveAppBundleIds)
    || !stringListsEqual(nextTitlePatterns, config.privacySensitiveTitlePatterns)
    || !stringListsEqual(nextUrlPatterns, config.privacySensitiveUrlPatterns)
    : false

  return (
    <div className="flex flex-col">
      <SettingsRow
        label={t('privacy.closedEyes.title')}
        description={t('privacy.closedEyes.description')}
        labelAccessory={(
          <Badge variant="outline" className="text-[11px]">
            {t('common.status.unavailable')}
          </Badge>
        )}
      >
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value="always-record"
            disabled
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="auto" aria-label={t('privacy.closedEyes.mode.auto.ariaLabel')} className="h-7 px-2 text-[11px]">
              {t('privacy.closedEyes.mode.auto')}
            </ToggleGroupItem>
            <ToggleGroupItem value="always-record" aria-label={t('privacy.closedEyes.mode.alwaysRecord.ariaLabel')} className="h-7 px-2 text-[11px]">
              {t('privacy.closedEyes.mode.alwaysRecord')}
            </ToggleGroupItem>
            <ToggleGroupItem value="always-pause" aria-label={t('privacy.closedEyes.mode.alwaysPause.ariaLabel')} className="h-7 px-2 text-[11px]">
              {t('privacy.closedEyes.mode.alwaysPause')}
            </ToggleGroupItem>
          </ToggleGroup>
          <Switch
            aria-label={t('privacy.closedEyes.toggle')}
            checked={false}
            disabled
          />
        </div>
      </SettingsRow>
      <div className="border-t border-border/60" />

      <SettingsRow
        label={t('privacy.title')}
        description={t('privacy.help')}
        labelAccessory={<Badge variant="outline" className="text-[11px]">{ruleCount === 0 ? t('common.status.notConfigured') : t('privacy.ruleCount', { count: ruleCount })}</Badge>}
        vertical
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <PrivacyRuleTextarea
            label="App bundle id"
            placeholder={t('privacy.appBundle.placeholder')}
            value={draft.appBundleText}
            onChange={appBundleText => setDraft(current => ({ ...current, appBundleText }))}
            disabled={saving || !config}
          />
          <PrivacyRuleTextarea
            label={t('privacy.titlePattern.label')}
            placeholder={t('privacy.titlePattern.placeholder')}
            value={draft.titlePatternText}
            onChange={titlePatternText => setDraft(current => ({ ...current, titlePatternText }))}
            disabled={saving || !config}
          />
          <PrivacyRuleTextarea
            label={t('privacy.urlPattern.label')}
            placeholder={t('privacy.urlPattern.placeholder')}
            value={draft.urlPatternText}
            onChange={urlPatternText => setDraft(current => ({ ...current, urlPatternText }))}
            disabled={saving || !config}
          />
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          {saveError && <span className="text-[12px] text-destructive">{saveError}</span>}
          {!saveError && saved && <span className="text-[12px] text-muted-foreground">{t('common.status.saved')}</span>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="sm:ml-auto"
            disabled={!config || saving || !hasChanges}
            onClick={() => {
              setSaveError(null)
              setSaved(false)
              void onUpdateConfig({
                privacySensitiveAppBundleIds: nextAppBundleIds,
                privacySensitiveTitlePatterns: nextTitlePatterns,
                privacySensitiveUrlPatterns: nextUrlPatterns,
              })
                .then((updated) => {
                  if (updated) {
                    setSaved(true)
                  }
                })
                .catch((error: unknown) => {
                  setSaveError(error instanceof Error ? error.message : t('common.error.saveFailed'))
                })
            }}
          >
            {t('privacy.saveRules')}
          </Button>
        </div>
      </SettingsRow>
    </div>
  )
}

interface PrivacyRulesDraft {
  appBundleText: string
  titlePatternText: string
  urlPatternText: string
}

function PrivacyRuleTextarea({
  label,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <Textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        className="min-h-24 resize-y font-mono text-[12px] leading-5"
      />
    </label>
  )
}

function formatPrivacyRuleLines(values: string[]): string {
  return values.join('\n')
}

function parsePrivacyRuleLines(value: string): string[] {
  const rules: string[] = []
  const seen = new Set<string>()
  for (const line of value.split(PRIVACY_RULE_LINE_SPLIT_RE)) {
    const rule = line.trim()
    if (!rule || seen.has(rule)) {
      continue
    }
    seen.add(rule)
    rules.push(rule)
  }
  return rules
}

function stringListsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function SlackSourcePanel({ loading, sources }: { loading: boolean, sources: ChronicleMessageSource[] }) {
  const { t } = useTranslation('chronicle')
  const { saveSource, syncSource, saving, syncing } = useChronicleSlackSourceActions()
  const [draft, setDraft] = useState<ChronicleSlackSourceDraft>({
    label: 'Slack',
    token: '',
    signingSecret: '',
    channelIds: '',
    enabled: true,
    realtimeMode: 'events-api',
  })
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null)
  const canSave = draft.label.trim().length > 0
    && draft.token.trim().length > 0
    && draft.channelIds.trim().length > 0
    && (draft.realtimeMode !== 'events-api' || draft.signingSecret.trim().length > 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-foreground/5 bg-background p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <MessageSquareIcon className="size-3.5 !text-muted-foreground" />
          <span className="text-[13px] font-medium text-foreground">{t('slack.title')}</span>
          <Badge variant="outline" className="ml-auto text-[11px]">
            {sources.length === 0 ? t('common.status.disconnected') : t('slack.sourceCount', { count: sources.length })}
          </Badge>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <Input
            value={draft.label}
            onChange={event => setDraft(current => ({ ...current, label: event.target.value }))}
            placeholder={t('slack.placeholder.label')}
            className="h-9 text-[13px]"
          />
          <Input
            value={draft.channelIds}
            onChange={event => setDraft(current => ({ ...current, channelIds: event.target.value }))}
            placeholder={t('slack.placeholder.channelIds')}
            className="h-9 font-mono text-[13px]"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={draft.realtimeMode}
            onValueChange={(value) => {
              if (value === 'polling' || value === 'events-api') {
                setDraft(current => ({ ...current, realtimeMode: value }))
              }
            }}
            variant="outline"
            size="sm"
            spacing={0}
          >
            <ToggleGroupItem value="events-api" aria-label="Slack Events API" className="h-8 px-2 text-[12px]">
              Events API
            </ToggleGroupItem>
            <ToggleGroupItem value="polling" aria-label={t('slack.mode.pollingAriaLabel')} className="h-8 px-2 text-[12px]">
              {t('slack.mode.polling')}
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="text-[12px] text-muted-foreground">
            {draft.realtimeMode === 'events-api' ? t('slack.mode.eventsDescription') : t('slack.mode.pollingDescription')}
          </span>
        </div>

        <div className="mt-2 flex gap-2">
          <div className="relative min-w-0 flex-1">
            <KeyRoundIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60" />
            <Input
              value={draft.token}
              type="password"
              onChange={event => setDraft(current => ({ ...current, token: event.target.value }))}
              placeholder="xoxb- Slack bot token"
              className="h-9 pl-8 font-mono text-[13px]"
            />
          </div>
          {draft.realtimeMode === 'events-api' && (
            <div className="relative min-w-0 flex-1">
              <KeyRoundIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60" />
              <Input
                value={draft.signingSecret}
                type="password"
                onChange={event => setDraft(current => ({ ...current, signingSecret: event.target.value }))}
                placeholder="Slack signing secret"
                className="h-9 pl-8 font-mono text-[13px]"
              />
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canSave || saving}
            onClick={() => {
              void saveSource(draft).then(() => {
                setDraft({ label: 'Slack', token: '', signingSecret: '', channelIds: '', enabled: true, realtimeMode: 'events-api' })
              })
            }}
          >
            {t('common.action.save')}
          </Button>
        </div>

        <p className="mt-2 text-[12px] text-muted-foreground">
          {t('slack.secretHelp')}
        </p>
      </div>

      {loading
        ? <ChronicleEmptyState icon={<MessageSquareIcon className="size-4" />} title={t('slack.loading')} />
        : sources.length === 0
          ? <ChronicleEmptyState icon={<MessageSquareIcon className="size-4" />} title={t('slack.empty')} />
          : (
              <div className="flex flex-col gap-2">
                {sources.map(source => (
                  <div key={source.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <MessageSquareIcon className="size-3.5 shrink-0 !text-muted-foreground" />
                      <span className="truncate text-[13px] font-medium text-foreground">{source.label}</span>
                      <Badge variant="outline" className="ml-auto text-[11px]">{source.status}</Badge>
                    </div>
                    <div className="mt-2 grid gap-1 text-[12px] text-muted-foreground md:grid-cols-2">
                      <span className="truncate font-mono">{source.channelIds.join(', ') || t('slack.noChannels')}</span>
                      <span className="truncate md:text-right">
                        {t('slack.lastMessage')}
                        {' '}
                        {formatRelativeTime(t, source.lastMessageAt)}
                      </span>
                      <span className="truncate">
                        {t('slack.mode.label')}
                        {' '}
                        {formatSlackRealtimeMode(t, source.realtimeMode)}
                      </span>
                      <span className="truncate font-mono md:text-right">
                        {source.realtimeMode === 'events-api'
                          ? `${getServerUrl()}/chronicle/message-sources/${source.id}/slack/events`
                          : t('slack.pollingEnabled')}
                      </span>
                      {source.lastError && <span className="truncate text-destructive md:col-span-2">{source.lastError}</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={syncing || source.status === 'syncing'}
                        onClick={() => {
                          void syncSource(source.id).then((result) => {
                            setLastSyncMessage(`${result.message}; ${result.ingested} imported`)
                          })
                        }}
                      >
                        <RefreshCwIcon className="size-3.5" />
                        {t('common.action.sync')}
                      </Button>
                      <span className="text-[12px] text-muted-foreground">
                        {t('slack.lastSync')}
                        {' '}
                        {formatRelativeTime(t, source.lastSyncAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

      {lastSyncMessage && <p className="text-[12px] text-muted-foreground">{lastSyncMessage}</p>}
    </div>
  )
}

function formatTranscriptStatus(t: ChronicleTranslate, status: ChronicleAudioTranscript['status']): string {
  if (status === 'recording') { return t('common.status.recording') }
  if (status === 'completed') { return t('common.status.completed') }
  if (status === 'imported') { return t('common.status.imported') }
  return t('common.status.error')
}

function formatSlackRealtimeMode(t: ChronicleTranslate, mode: ChronicleMessageSource['realtimeMode']): string {
  if (mode === 'events-api') { return 'Events API' }
  if (mode === 'socket-mode') { return 'Socket Mode' }
  return t('slack.mode.polling')
}

function formatAudioRuntimeStatus(t: ChronicleTranslate, status: ChronicleStatus['audioRuntimeStatus']): string {
  if (status === 'armed') { return t('common.status.armed') }
  if (status === 'unavailable') { return t('common.status.unavailable') }
  return t('common.status.disabled')
}

function formatAccessibilityStatus(t: ChronicleTranslate, status: ChronicleAccessibilitySnapshot['status']): string {
  if (status === 'permission-denied') { return t('accessibility.status.permissionDenied') }
  if (status === 'unavailable') { return t('common.status.unavailable') }
  if (status === 'error') { return t('common.status.error') }
  return t('resource.state.available')
}

function formatAccessibilityEventNotification(t: ChronicleTranslate, notification: string): string {
  if (notification === 'AXFocusedWindowChanged') { return t('accessibility.notification.focusedWindowChanged') }
  if (notification === 'AXFocusedUIElementChanged') { return t('accessibility.notification.focusedElementChanged') }
  if (notification === 'AXWindowCreated') { return t('accessibility.notification.windowCreated') }
  if (notification === 'AXWindowMoved') { return t('accessibility.notification.windowMoved') }
  if (notification === 'AXWindowResized') { return t('accessibility.notification.windowResized') }
  return notification
}

function formatAudioSegmentTitle(t: ChronicleTranslate, segment: ChronicleAudioRawSegment): string {
  if (segment.source === 'system') { return t('audioRaw.title.system') }
  if (segment.source === 'mixed') { return t('audioRaw.title.mixed') }
  return t('audioRaw.title.microphone')
}

function formatAudioProcessingStatus(t: ChronicleTranslate, status: ChronicleAudioRawSegment['vadStatus']): string {
  if (status === 'pending') { return t('common.status.pending') }
  if (status === 'ready') { return t('common.status.completed') }
  if (status === 'error') { return t('common.status.error') }
  return t('audioRaw.processing.notConnected')
}

function getAccessibilityTreeDepthClass(depth: number): string {
  if (depth <= 0) { return 'pl-0' }
  if (depth === 1) { return 'pl-2' }
  if (depth === 2) { return 'pl-4' }
  if (depth === 3) { return 'pl-6' }
  return 'pl-8'
}

// ---------------------------------------------------------------------------
// Data display components (preserved from original)
// ---------------------------------------------------------------------------

function AccessibilitySnapshotList({ snapshots }: { snapshots: ChronicleAccessibilitySnapshot[] }) {
  const { t } = useTranslation('chronicle')

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {snapshots.map((snapshot) => {
        const artifactPath = AccessibilitySnapshotMetadataSchema.parse(snapshot.metadata).artifactPath
        return (
          <article key={snapshot.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
            <div className="mb-2 flex min-w-0 items-center gap-2">
              <EyeIcon className="size-3.5 shrink-0 !text-muted-foreground" />
              <span className="truncate text-[13px] font-medium text-foreground">
                {snapshot.windowTitle ?? snapshot.appBundleId ?? t('accessibility.snapshotFallback.title')}
              </span>
              <Badge
                variant={snapshot.status === 'ready' ? 'secondary' : 'outline'}
                className={cn(
                  'ml-auto text-[11px]',
                  {
                    'border-destructive/20 bg-destructive/10 text-destructive': snapshot.status === 'error',
                    'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300': snapshot.status === 'permission-denied',
                  },
                )}
              >
                {formatAccessibilityStatus(t, snapshot.status)}
              </Badge>
            </div>
            <p className="line-clamp-4 text-[13px] leading-5 text-foreground">
              {snapshot.text ?? t('accessibility.snapshotFallback.text')}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
              <span className="truncate font-mono">{formatDateTime(t, snapshot.capturedAt)}</span>
              <span className="truncate text-right">
                {t('accessibility.elementCount', { count: snapshot.elementCount })}
              </span>
              <span className="truncate">{snapshot.provider}</span>
              <span className="truncate text-right">{snapshot.appBundleId ?? t('common.status.unknownApp')}</span>
            </div>
            {artifactPath && (
              <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground/70">
                {artifactPath}
              </p>
            )}
            <AccessibilityTreePreview tree={snapshot.tree} />
          </article>
        )
      })}
    </div>
  )
}

function AccessibilityTreePreview({ tree }: { tree: unknown[] }) {
  const nodes = tree.reduce<Array<z.output<typeof AccessibilityTreeNodeSchema>>>((items, node) => {
    if (items.length >= 4) {
      return items
    }

    const parsed = AccessibilityTreeNodeSchema.safeParse(node)
    if (parsed.success) {
      items.push(parsed.data)
    }
    return items
  }, [])

  if (nodes.length === 0) {
    return null
  }

  return (
    <div className="mt-2 space-y-1 border-t border-foreground/5 pt-2">
      {nodes.map(node => (
        <div key={node.path} className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono">{node.role}</span>
          <span className={cn('min-w-0 flex-1 truncate', getAccessibilityTreeDepthClass(node.depth))}>
            {node.label || node.value || node.path}
          </span>
        </div>
      ))}
    </div>
  )
}

function AccessibilityEventList({ events }: { events: ChronicleAccessibilityEvent[] }) {
  const { t } = useTranslation('chronicle')

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {events.map(event => (
        <article key={event.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <ActivityIcon className="size-3.5 shrink-0 !text-muted-foreground" />
            <span className="truncate text-[13px] font-medium text-foreground">
              {formatAccessibilityEventNotification(t, event.notification)}
            </span>
            <Badge variant="outline" className="ml-auto text-[11px]">
              {event.droppedBefore > 0 ? `${event.droppedBefore} dropped` : 'captured'}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
            <span className="truncate font-mono">{formatDateTime(t, event.capturedAt)}</span>
            <span className="truncate text-right">{event.appBundleId ?? t('common.status.unknownApp')}</span>
            <span className="truncate">{event.provider}</span>
            <span className="truncate text-right">{event.pid === null ? t('accessibility.unknownProcess') : `PID ${event.pid}`}</span>
            <span className="truncate">
              {event.snapshotId ? t('accessibility.snapshotLinked') : t('accessibility.snapshotNotLinked')}
            </span>
            <span className="truncate text-right">
              {event.accessibilitySnapshotId ? t('accessibility.windowClueLinked') : t('accessibility.windowClueNotLinked')}
            </span>
          </div>
          <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground/70">{event.sourceId}</p>
        </article>
      ))}
    </div>
  )
}

function AudioTranscriptList({ transcripts }: { transcripts: ChronicleAudioTranscript[] }) {
  const { t } = useTranslation('chronicle')

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {transcripts.map(transcript => (
        <article key={transcript.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <FileAudioIcon className="size-3.5 shrink-0 !text-muted-foreground" />
            <span className="truncate text-[13px] font-medium text-foreground">
              {transcript.title ?? transcript.windowTitle ?? t('timeline.fallback.audioTranscript')}
            </span>
            <Badge variant="outline" className="ml-auto text-[11px]">{formatTranscriptStatus(t, transcript.status)}</Badge>
          </div>
          <p className="line-clamp-4 text-[13px] leading-5 text-foreground">
            {transcript.previewText || t('audioTranscript.emptyPreview')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-mono">{formatDateTime(t, transcript.startedAt)}</span>
            <span>
              {t('audioTranscript.segmentCount', { count: transcript.segmentCount })}
            </span>
            {transcript.language && <span>{transcript.language}</span>}
            {transcript.source === 'asr' && <span>{t('audioTranscript.asrTranscript')}</span>}
          </div>
        </article>
      ))}
    </div>
  )
}

function AudioRawSegmentList({ segments }: { segments: ChronicleAudioRawSegment[] }) {
  const { t } = useTranslation('chronicle')

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {segments.map(segment => (
        <article key={segment.id} className="rounded-lg border border-foreground/5 bg-background p-3 shadow-sm">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            <FileAudioIcon className="size-3.5 shrink-0 !text-muted-foreground" />
            <span className="truncate text-[13px] font-medium text-foreground">
              {formatAudioSegmentTitle(t, segment)}
            </span>
            <Badge variant={segment.active ? 'secondary' : 'outline'} className="ml-auto text-[11px]">
              {segment.active ? t('audioRaw.active') : t('audioRaw.quiet')}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px] text-muted-foreground">
            <span className="truncate">
              {formatDateTime(t, segment.recordedAt)}
            </span>
            <span className="truncate text-right">
              {formatShortDurationMs(segment.durationMs)}
            </span>
            <span className="truncate">
              RMS
              {' '}
              {formatPercentFromRatio(segment.rms)}
            </span>
            <span className="truncate text-right">
              Peak
              {' '}
              {formatPercentFromRatio(segment.peak)}
            </span>
            <span className="truncate">
              {segment.sampleRate}
              {' '}
              Hz
            </span>
            <span className="truncate text-right">
              {segment.channels}
              {' '}
              {t('audioRaw.channels')}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <AudioProcessingBadge label="VAD" status={segment.vadStatus} />
            <AudioProcessingBadge label="ASR" status={segment.asrStatus} />
            <AudioProcessingBadge label={t('audioRaw.speaker')} status={segment.speakerStatus} />
          </div>
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground/70">
            <p className="truncate font-mono">{segment.audioPath}</p>
            <p className="truncate font-mono">{segment.metadataPath}</p>
          </div>
        </article>
      ))}
    </div>
  )
}

function AudioProcessingBadge({
  label,
  status,
}: {
  label: string
  status: ChronicleAudioRawSegment['vadStatus']
}) {
  const { t } = useTranslation('chronicle')

  return (
    <Badge variant="outline" className="text-[11px]">
      {label}
      {' '}
      {formatAudioProcessingStatus(t, status)}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Status panel (advanced)
// ---------------------------------------------------------------------------

interface StatusPanelProps {
  loading: boolean
  running: boolean
  available: boolean
  pid: number | null
  lastSummaryAt: string | number | null
  lastExitAt: string | number | null
  lastExitCode: number | null
  totalSummaries: number
  totalMessages: number
  lastMessageAt: string | number | null
  totalAccessibilitySnapshots: number
  lastAccessibilitySnapshotAt: string | number | null
  totalAccessibilityEvents: number
  lastAccessibilityEventAt: string | number | null
  totalAudioTranscripts: number
  lastAudioTranscriptAt: string | number | null
  totalAudioRawSegments: number
  lastAudioRawSegmentAt: string | number | null
  totalActivitySegments: number
  totalPipelineRuns: number
  totalKnowledgeCards: number
  totalDreamRuns: number
  activityPipelineEnabled: boolean
  activityPipelineRunning: boolean
  activityPipelineIntervalMs: number
  activityPipelineBatchSize: number
  dreamSchedulerEnabled: boolean
  dreamSchedulerRunning: boolean
  dreamSchedulerIntervalMs: number
  dreamSchedulerApplyMerge: boolean
  audioCaptureEnabled: boolean
  audioRuntimeStatus: ChronicleStatus['audioRuntimeStatus']
  modelLabel: string | null
  storageRoot: string | null
}

function StatusPanel({
  loading,
  running,
  available,
  pid,
  lastSummaryAt,
  lastExitAt,
  lastExitCode,
  totalSummaries,
  totalMessages,
  lastMessageAt,
  totalAccessibilitySnapshots,
  lastAccessibilitySnapshotAt,
  totalAccessibilityEvents,
  lastAccessibilityEventAt,
  totalAudioTranscripts,
  lastAudioTranscriptAt,
  totalAudioRawSegments,
  lastAudioRawSegmentAt,
  totalActivitySegments,
  totalPipelineRuns,
  totalKnowledgeCards,
  totalDreamRuns,
  activityPipelineEnabled,
  activityPipelineRunning,
  activityPipelineIntervalMs,
  activityPipelineBatchSize,
  dreamSchedulerEnabled,
  dreamSchedulerRunning,
  dreamSchedulerIntervalMs,
  dreamSchedulerApplyMerge,
  audioCaptureEnabled,
  audioRuntimeStatus,
  modelLabel,
  storageRoot,
}: StatusPanelProps) {
  const { t } = useTranslation('chronicle')

  if (loading) {
    return <ChronicleEmptyState icon={<ActivityIcon className="size-4" />} title={t('status.loading')} />
  }

  return (
    <div className="rounded-lg border border-foreground/5 bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ActivityIcon className="size-3.5 !text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">{t('status.title')}</span>
        <StatusBadge running={running} available={available} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-10 xl:grid-cols-12">
        <StatusItem
          icon={<EyeIcon className="size-3.5" />}
          label={t('status.item.service')}
          value={running ? t('status.service.running', { pid: pid ?? t('common.status.unknown') }) : t('common.status.stopped')}
        />
        <StatusItem
          icon={<ClockIcon className="size-3.5" />}
          label={t('status.item.lastMemory')}
          value={formatRelativeTime(t, lastSummaryAt)}
          detail={formatDateTime(t, lastSummaryAt)}
        />
        <StatusItem
          icon={<BrainIcon className="size-3.5" />}
          label={t('status.item.memories')}
          value={String(totalSummaries)}
        />
        <StatusItem
          icon={<MessageSquareIcon className="size-3.5" />}
          label="Slack"
          value={String(totalMessages)}
          detail={formatRelativeTime(t, lastMessageAt)}
        />
        <StatusItem
          icon={<EyeIcon className="size-3.5" />}
          label={t('status.item.windows')}
          value={String(totalAccessibilitySnapshots)}
          detail={formatRelativeTime(t, lastAccessibilitySnapshotAt)}
        />
        <StatusItem
          icon={<ActivityIcon className="size-3.5" />}
          label={t('status.item.events')}
          value={String(totalAccessibilityEvents)}
          detail={formatRelativeTime(t, lastAccessibilityEventAt)}
        />
        <StatusItem
          icon={<FileAudioIcon className="size-3.5" />}
          label={t('status.item.transcripts')}
          value={String(totalAudioTranscripts)}
          detail={formatRelativeTime(t, lastAudioTranscriptAt)}
        />
        <StatusItem
          icon={<FileAudioIcon className="size-3.5" />}
          label={t('status.item.audio')}
          value={String(totalAudioRawSegments)}
          detail={audioCaptureEnabled ? formatRelativeTime(t, lastAudioRawSegmentAt) : formatAudioRuntimeStatus(t, audioRuntimeStatus)}
        />
        <StatusItem
          icon={<ActivityIcon className="size-3.5" />}
          label={t('status.item.activities')}
          value={String(totalActivitySegments)}
        />
        <StatusItem
          icon={<CpuIcon className="size-3.5" />}
          label={t('status.item.pipeline')}
          value={String(totalPipelineRuns)}
        />
        <StatusItem
          icon={<BrainIcon className="size-3.5" />}
          label={t('status.item.knowledge')}
          value={String(totalKnowledgeCards)}
        />
        <StatusItem
          icon={<ClockIcon className="size-3.5" />}
          label={t('status.item.preview')}
          value={String(totalDreamRuns)}
        />
      </div>

      <div className="mt-3 grid gap-2 border-t border-foreground/5 pt-3 text-[12px] text-muted-foreground md:grid-cols-2">
        <div className="flex min-w-0 items-center gap-2">
          <HardDriveIcon className="size-3.5 shrink-0" />
          <span className="truncate">{storageRoot ?? t('status.storageUnavailable')}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 md:justify-end">
          <CpuIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {activityPipelineEnabled
              ? t('status.pipelineSummary', {
                  state: activityPipelineRunning ? t('common.status.running') : t('common.status.ready'),
                  seconds: Math.round(activityPipelineIntervalMs / 1000),
                  count: activityPipelineBatchSize,
                })
              : t('status.pipelineDisabled')}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <LayersIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {dreamSchedulerEnabled
              ? t('status.dreamSummary', {
                  state: dreamSchedulerRunning ? t('common.status.running') : t('common.status.ready'),
                  mode: dreamSchedulerApplyMerge ? t('control.status.autoMerge') : t('control.status.previewOnly'),
                  hours: Math.round(dreamSchedulerIntervalMs / 3_600_000),
                })
              : t('status.dreamDisabled')}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 md:justify-end">
          <CpuIcon className="size-3.5 shrink-0" />
          <span className="truncate">{modelLabel ?? t('status.noModel')}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {lastExitCode === null
              ? t('status.noExitRecord')
              : t('status.lastExit', { code: lastExitCode, time: formatDateTime(t, lastExitAt) })}
          </span>
        </div>
      </div>
    </div>
  )
}

function StatusItem({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <span className="mt-1 block truncate text-[13px] font-medium tabular-nums text-foreground">{value}</span>
      {detail && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/70">{detail}</span>}
    </div>
  )
}
