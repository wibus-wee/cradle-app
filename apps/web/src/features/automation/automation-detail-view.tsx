import {
  PencilLine as PencilIcon,
  PlayLine as PlayIcon,
} from '@mingcute/react'
import { m } from 'motion/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

import { AutomationArtifactRowView } from './automation-artifact-row-view'
import { AutomationDetailValue } from './automation-detail-value'
import {
  formatScheduleSummary,
  parseRruleToSchedule,
} from './automation-draft'
import {
  formatAutomationDateTime,
  getAutomationRecipe,
  getAutomationRunTime,
  getAutomationTrigger,
} from './automation-presentation'
import { AutomationRunRowView } from './automation-run-row-view'
import { AutomationSectionLabel } from './automation-section-label'
import { AutomationStatusDot } from './automation-status-dot'
import { AutomationStatusText } from './automation-status-text'
import type {
  AutomationArtifact,
  AutomationDefinition,
  AutomationRun,
} from './types'

type AutomationDetailTab = 'overview' | 'runs' | 'artifacts'

export interface AutomationDetailViewProps {
  definition: AutomationDefinition
  latestRun: AutomationRun | null
  runs: readonly AutomationRun[]
  runsLoading: boolean
  artifacts: readonly AutomationArtifact[]
  artifactsLoading: boolean
  workspaceNames: Readonly<Record<string, string>>
  locale: string
  runNowPending: boolean
  now?: number
  onEdit: (definitionId: string) => void
  onRunNow: (definitionId: string) => void
  onStopRun: (runId: string) => void
  onTriageRun: (runId: string, status: 'resolved' | 'archived') => void
}

export function AutomationDetailView({
  definition,
  latestRun,
  runs,
  runsLoading,
  artifacts,
  artifactsLoading,
  workspaceNames,
  locale,
  runNowPending,
  now,
  onEdit,
  onRunNow,
  onStopRun,
  onTriageRun,
}: AutomationDetailViewProps) {
  const { t } = useTranslation('automation')
  const [activeTab, setActiveTab] = useState<AutomationDetailTab>('overview')
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    null,
  )
  const trigger = getAutomationTrigger(definition)
  const recipe = getAutomationRecipe(definition)
  const summary = trigger
    ? formatScheduleSummary(parseRruleToSchedule(trigger.rrule), t)
    : null
  const selectedArtifact = useMemo(
    () => artifacts.find(artifact => artifact.id === selectedArtifactId)
      ?? artifacts[0]
      ?? null,
    [artifacts, selectedArtifactId],
  )
  const sortedRuns = useMemo(
    () => [...runs].sort(
      (left, right) =>
        getAutomationRunTime(right) - getAutomationRunTime(left),
    ),
    [runs],
  )
  const tabs: Array<{ id: AutomationDetailTab, label: string }> = [
    { id: 'overview', label: t('tab.overview') },
    { id: 'runs', label: t('tab.runs') },
    { id: 'artifacts', label: t('tab.artifacts') },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/40 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            {definition.title}
          </h2>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            {summary && <span>{summary}</span>}
            {summary && definition.workspaceId && (
              <span className="text-muted-foreground/40">·</span>
            )}
            {definition.workspaceId && (
              <span>
                {workspaceNames[definition.workspaceId] ?? t('common.unknown')}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {latestRun && (
            <div className="flex items-center gap-1.5">
              <AutomationStatusDot status={latestRun.status} />
              <AutomationStatusText status={latestRun.status} />
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onEdit(definition.id)}
            aria-label={t('action.edit')}
          >
            <PencilIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onRunNow(definition.id)}
            disabled={runNowPending}
            aria-label={t('action.runNow')}
          >
            {runNowPending
              ? <Spinner className="size-3.5" />
              : <PlayIcon className="size-3.5" />}
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/30 px-4 py-1 scrollbar-none">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              'relative z-10 flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] transition-colors select-none',
              activeTab === id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {activeTab === id && (
              <m.span
                layoutId="automation-detail-tab-pill"
                className="absolute inset-0 rounded-md bg-accent"
                transition={{ type: 'spring', stiffness: 600, damping: 40 }}
                style={{ zIndex: -1 }}
              />
            )}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {activeTab === 'overview' && (
          <m.div
            key="overview"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col gap-3"
          >
            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-[13px]">
                  {t('schedule.section')}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <AutomationDetailValue
                  label={t('detail.rrule')}
                  value={trigger?.rrule ?? t('trigger.noTrigger')}
                  mono
                />
                <AutomationDetailValue
                  label={t('detail.timezone')}
                  value={trigger?.timezone ?? 'UTC'}
                  mono
                />
                <AutomationDetailValue
                  label={t('detail.nextRun')}
                  value={formatAutomationDateTime(
                    definition.nextRunAt,
                    locale,
                    t,
                  )}
                />
                <AutomationDetailValue
                  label={t('detail.workspace')}
                  value={definition.workspaceId
                    ? workspaceNames[definition.workspaceId]
                    ?? t('common.unknown')
                    : t('definition.workspaceNone')}
                />
                <AutomationDetailValue
                  label={t('detail.updated')}
                  value={formatAutomationDateTime(
                    definition.updatedAt ?? definition.createdAt,
                    locale,
                    t,
                  )}
                />
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-[13px]">
                  {t('execution.section')}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <AutomationDetailValue
                  label={t('execution.sessionPolicy.label')}
                  value={recipe?.sessionPolicy === 'heartbeat'
                    ? t('execution.sessionPolicy.heartbeat')
                    : t('execution.sessionPolicy.new')}
                />
                <AutomationDetailValue
                  label={t('execution.isolationPolicy.label')}
                  value={recipe?.isolationPolicy === 'worktree_per_run'
                    ? t('execution.isolationPolicy.worktreePerRun')
                    : t('execution.isolationPolicy.workspace')}
                />
                <AutomationDetailValue
                  label={t('execution.completionPolicy.label')}
                  value={t('execution.completionPolicy.agentComplete')}
                />
                <AutomationDetailValue
                  label={t('execution.noFindings.label')}
                  value={recipe?.completionPolicy?.noFindingsBehavior === 'triage'
                    ? t('execution.noFindings.triage')
                    : t('execution.noFindings.archive')}
                />
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-[13px]">
                    {t('recipe.section')}
                  </CardTitle>
                  <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                    {recipe?.kind ?? t('common.unknown')}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {recipe?.prompt ?? t('recipe.noPromptSnapshot')}
                </pre>
              </CardContent>
            </Card>
          </m.div>
        )}

        {activeTab === 'runs' && (
          <m.div
            key="runs"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
          >
            <AutomationSectionLabel
              label={t('runs.history')}
              count={runs.length}
            />
            {runsLoading && (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                {t('runs.loading')}
              </div>
            )}
            {!runsLoading && sortedRuns.length === 0 && (
              <div className="px-2 py-4 text-xs text-muted-foreground">
                {t('runs.empty')}
              </div>
            )}
            <div className="relative flex flex-col">
              {sortedRuns.length > 1 && (
                <div className="absolute bottom-3 left-[5px] top-3 w-px bg-border/40" />
              )}
              {sortedRuns.map(run => (
                <AutomationRunRowView
                  key={run.id}
                  run={run}
                  locale={locale}
                  now={now}
                  onStop={onStopRun}
                  onTriage={onTriageRun}
                />
              ))}
            </div>
          </m.div>
        )}

        {activeTab === 'artifacts' && (
          <m.div
            key="artifacts"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]"
          >
            <div>
              <AutomationSectionLabel
                label={t('artifact.title')}
                count={artifacts.length}
              />
              <div className="flex flex-col gap-0.5">
                {artifactsLoading && (
                  <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                    <Spinner className="size-3.5" />
                    {t('artifact.loading')}
                  </div>
                )}
                {!artifactsLoading && artifacts.length === 0 && (
                  <div className="px-2 py-4 text-xs text-muted-foreground">
                    {t('artifact.empty')}
                  </div>
                )}
                {artifacts.map(artifact => (
                  <AutomationArtifactRowView
                    key={artifact.id}
                    artifact={artifact}
                    active={artifact.id === selectedArtifact?.id}
                    onSelect={setSelectedArtifactId}
                  />
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <Card size="sm" className="h-full">
                <CardHeader>
                  <CardTitle className="font-mono text-[12px]">
                    {selectedArtifact
                      ? selectedArtifact.title
                      ?? selectedArtifact.name
                      ?? selectedArtifact.id
                      : t('artifact.preview')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {selectedArtifact?.content
                      ?? JSON.stringify(selectedArtifact?.metadata ?? {}, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            </div>
          </m.div>
        )}
      </div>
    </div>
  )
}
