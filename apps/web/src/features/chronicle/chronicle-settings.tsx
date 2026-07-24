import {
  HeartbeatLine as ActivityIcon,
  PicLine as ImageIcon,
  Refresh1Line as RefreshCwIcon,
  WarningLine as TriangleAlertIcon,
} from '@mingcute/react'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { useProviderTargetModelMap } from '~/features/agent-runtime/use-agent-models'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import type { ProviderModelOption } from '~/features/composer-toolbar/types'
import { SettingsGroup, SettingsPage } from '~/features/settings/settings-container'
import { SettingsRow } from '~/features/settings/settings-row'
import { cn } from '~/lib/cn'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import {
  ChronicleAccessibilityEventListView,
} from './chronicle-accessibility-event-list-view'
import {
  ChronicleAccessibilitySnapshotListView,
} from './chronicle-accessibility-snapshot-list-view'
import {
  ChronicleActivityPipelineContainer,
} from './chronicle-activity-pipeline-container'
import {
  ChronicleAudioRawSegmentListView,
} from './chronicle-audio-raw-segment-list-view'
import {
  ChronicleAudioTranscriptListView,
} from './chronicle-audio-transcript-list-view'
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
  ChroniclePrivacyRulesView,
} from './chronicle-privacy-rules-view'
import {
  ChronicleResourceGridContainer,
} from './chronicle-resource-grid-container'
import {
  ChronicleSlackSourceContainer,
} from './chronicle-slack-source-container'
import {
  ChronicleSpeakerProfileGridView,
} from './chronicle-speaker-profile-grid-view'
import {
  ChronicleStatusBadgeView,
} from './chronicle-status-badge-view'
import {
  ChronicleStatusPanelView,
} from './chronicle-status-panel-view'
import {
  ChronicleTimelineFeedContainer,
} from './chronicle-timeline-feed-container'
import type {
  ChronicleConfig,
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
  useChronicleSpeakerProfiles,
  useChronicleStatus,
  useChronicleTimeline,
  useRefreshChronicleQueries,
} from './use-chronicle.ts'

const MEMORY_SEARCH_LIMIT = 50
type ChronicleTranslate = TFunction<'chronicle'>

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
          <ChronicleStatusBadgeView
            running={status?.running ?? false}
            available={status?.available ?? false}
          />
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
        <ChroniclePrivacyRulesView
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
            <ChronicleStatusPanelView
              loading={statusLoading}
              status={status}
              config={config}
              modelLabel={modelLabel}
            />
          </section>

          <SettingsRow label={t('advanced.messageSources.title')} description={t('advanced.messageSources.description')} vertical>
            <ChronicleSlackSourceContainer
              loading={messageSourcesLoading}
              sources={messageSources}
            />
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
            <ChronicleAccessibilitySnapshotListView
              loading={accessibilitySnapshotsLoading}
              snapshots={accessibilitySnapshots}
            />
          </SettingsRow>
          <div className="border-t border-border/60" />

          <SettingsRow label={t('advanced.accessibilityEvents.title')} description={t('advanced.accessibilityEvents.description')} vertical>
            <ChronicleAccessibilityEventListView
              loading={accessibilityEventsLoading}
              events={accessibilityEvents}
            />
          </SettingsRow>
          <div className="border-t border-border/60" />

          <SettingsRow label={t('advanced.audioSegments.title')} description={t('advanced.audioSegments.description')} vertical>
            <ChronicleAudioRawSegmentListView
              loading={audioRawSegmentsLoading}
              segments={audioRawSegments}
            />
          </SettingsRow>
          <div className="border-t border-border/60" />

          <SettingsRow label={t('advanced.transcripts.title')} description={t('advanced.transcripts.description')} vertical>
            <ChronicleAudioTranscriptListView
              loading={audioTranscriptsLoading}
              transcripts={audioTranscripts}
            />
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
