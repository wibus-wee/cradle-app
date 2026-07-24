import {
  ArrowLeftLine as ArrowLeftIcon,
  PlayLine as PlayIcon,
  PlusLine as PlusIcon,
  Refresh1Line as RefreshCwIcon,
  WarningLine as TriangleAlertIcon,
} from '@mingcute/react'
import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { BetaNotice } from '~/components/common/beta-notice'
import { Button } from '~/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import type { Workspace } from '~/features/workspace/types'

import { AutomationDefinitionRowView } from './automation-definition-row-view'
import { AutomationDraftRowView } from './automation-draft-row-view'
import { AutomationSectionLabel } from './automation-section-label'
import { AutomationTriageRowView } from './automation-triage-row-view'
import type { AutomationDefinition, AutomationRun } from './types'

export interface AutomationDashboardViewProps {
  definitions: readonly AutomationDefinition[]
  triageRuns: readonly AutomationRun[]
  workspaces: readonly Workspace[]
  selectedAutomationId: string | null
  selectedLatestRun: AutomationRun | null
  workspaceFilter: string | null
  hasDraft: boolean
  definitionsLoading: boolean
  triageLoading: boolean
  error: string | null
  automationReady: boolean
  runNowPending: boolean
  contentKey: string
  content: ReactNode
  onBack?: () => void
  onCreate: () => void
  onRefresh: () => void
  onRunNow: () => void
  onSelectDefinition: (definitionId: string) => void
  onSelectDraft: () => void
  onWorkspaceFilterChange: (workspaceId: string | null) => void
}

export function AutomationDashboardView({
  definitions,
  triageRuns,
  workspaces,
  selectedAutomationId,
  selectedLatestRun,
  workspaceFilter,
  hasDraft,
  definitionsLoading,
  triageLoading,
  error,
  automationReady,
  runNowPending,
  contentKey,
  content,
  onBack,
  onCreate,
  onRefresh,
  onRunNow,
  onSelectDefinition,
  onSelectDraft,
  onWorkspaceFilterChange,
}: AutomationDashboardViewProps) {
  const { t } = useTranslation('automation')

  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden bg-background"
      data-testid="automation-dashboard"
      data-automation-ready={automationReady ? 'true' : 'false'}
    >
      <BetaNotice
        title={t('beta.title')}
        description={t('beta.description')}
      />

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/50 px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          {onBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onBack}
              aria-label={t('action.backToHome')}
            >
              <ArrowLeftIcon className="size-4" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground">
              {t('page.title')}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {t('page.description')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={onCreate}
            disabled={hasDraft}
          >
            <PlusIcon className="size-3.5" />
            <span className="hidden sm:inline">{t('action.create')}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
          >
            <RefreshCwIcon className="size-3.5" />
            <span className="hidden sm:inline">{t('action.refresh')}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!selectedAutomationId || runNowPending}
            onClick={onRunNow}
          >
            {runNowPending
              ? <Spinner className="size-3.5" />
              : <PlayIcon className="size-3.5" />}
            <span className="hidden sm:inline">{t('action.runNow')}</span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="m-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:m-4">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-medium">{t('error.apiUnavailable')}</div>
            <div className="mt-1 break-words text-xs opacity-80">{error}</div>
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(180px,42%)_minmax(0,1fr)] divide-y divide-border/40 overflow-hidden md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-1 md:divide-x md:divide-y-0">
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="border-b border-border/40 px-3 py-2.5">
            <AutomationSectionLabel
              label={t('triage.title', { defaultValue: 'Triage' })}
              count={triageRuns.length}
            />
            <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
              {triageRuns.slice(0, 5).map(run => (
                <AutomationTriageRowView
                  key={run.id}
                  run={run}
                  definitionTitle={
                    definitions.find(
                      definition =>
                        definition.id === run.automationDefinitionId,
                    )?.title ?? run.automationDefinitionId
                  }
                  onSelect={onSelectDefinition}
                />
              ))}
              {!triageLoading && triageRuns.length === 0 && (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">
                  {t('triage.empty', { defaultValue: 'No unread runs' })}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-2.5">
            <AutomationSectionLabel
              label={t('definitions.title')}
              count={definitions.length}
            />
            <Select
              value={workspaceFilter ?? ''}
              onValueChange={value =>
                onWorkspaceFilterChange(value || null)}
            >
              <SelectTrigger className="h-6 max-w-32 text-[11px]">
                <SelectValue
                  placeholder={t('definitions.filterAllWorkspaces')}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">
                  {t('definitions.filterAllWorkspaces')}
                </SelectItem>
                {workspaces.map(workspace => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
            {hasDraft && (
              <AutomationDraftRowView onSelect={onSelectDraft} />
            )}
            {definitionsLoading && (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                {t('loading.automations')}
              </div>
            )}
            {!definitionsLoading && definitions.length === 0 && (
              <div className="px-2 py-4 text-xs text-muted-foreground">
                {t('definitions.empty')}
              </div>
            )}
            {definitions.map(definition => (
              <AutomationDefinitionRowView
                key={definition.id}
                definition={definition}
                active={definition.id === selectedAutomationId}
                latestRun={definition.id === selectedAutomationId
                  ? selectedLatestRun
                  : definition.latestRun ?? null}
                onSelect={onSelectDefinition}
              />
            ))}
          </div>
        </aside>

        <main className="min-h-0 min-w-0 overflow-y-auto">
          <m.div
            key={contentKey}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              type: 'spring',
              stiffness: 500,
              damping: 35,
              mass: 0.8,
            }}
            className="h-full"
          >
            {content}
          </m.div>
        </main>
      </div>
    </div>
  )
}
