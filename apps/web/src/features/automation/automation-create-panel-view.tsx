import {
  CheckLine as CheckIcon,
  CloseLine as XIcon,
  SparklesLine as SparklesIcon,
  WarningLine as TriangleAlertIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import type { Workspace } from '~/features/workspace/types'

import type { CreateAutomationDraft } from './automation-draft'
import { AutomationFormField } from './automation-form-field'
import { AutomationScheduleBuilderView } from './automation-schedule-builder-view'

export interface AutomationCreatePanelViewProps {
  draft: CreateAutomationDraft
  workspaces: readonly Workspace[]
  runtimePicker: ReactNode
  runtimeDescription: string
  selectedModelLabel: string | null
  saving: boolean
  error: string | null
  saveEnabled: boolean
  mode: 'create' | 'edit'
  onChange: (draft: CreateAutomationDraft) => void
  onCancel: () => void
  onSave: () => void
}

export function AutomationCreatePanelView({
  draft,
  workspaces,
  runtimePicker,
  runtimeDescription,
  selectedModelLabel,
  saving,
  error,
  saveEnabled,
  mode,
  onChange,
  onCancel,
  onSave,
}: AutomationCreatePanelViewProps) {
  const { t } = useTranslation('automation')
  const isEditing = mode === 'edit'

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/40 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-dashed border-foreground/15 text-muted-foreground">
              <SparklesIcon className="size-3.5" />
            </span>
            <h2 className="text-base font-semibold text-foreground text-balance">
              {isEditing ? t('edit.title') : t('create.title')}
            </h2>
          </div>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            {isEditing ? t('edit.description') : t('create.description')}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onCancel}
          aria-label={t('create.cancelAria')}
        >
          <XIcon className="size-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <section className="grid gap-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-[13px] font-medium text-foreground">
                  {t('definition.section')}
                </h3>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {t('definition.description')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
                <span className="text-[12px] text-muted-foreground">
                  {t('definition.enabled')}
                </span>
                <Switch
                  size="sm"
                  checked={draft.enabled}
                  onCheckedChange={enabled =>
                    onChange({ ...draft, enabled })}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <AutomationFormField label={t('definition.titleLabel')}>
                <Input
                  value={draft.title}
                  onChange={event =>
                    onChange({ ...draft, title: event.target.value })}
                  placeholder={t('definition.titlePlaceholder')}
                />
              </AutomationFormField>
              <AutomationFormField label={t('definition.descriptionLabel')}>
                <Input
                  value={draft.description}
                  onChange={event =>
                    onChange({ ...draft, description: event.target.value })}
                  placeholder={t('definition.descriptionPlaceholder')}
                />
              </AutomationFormField>
            </div>
            <AutomationFormField
              label={t('definition.workspaceLabel')}
              description={t('definition.workspaceDescription')}
            >
              <Select
                value={draft.workspaceId ?? ''}
                onValueChange={value =>
                  onChange({
                    ...draft,
                    workspaceId: value || null,
                    isolationPolicy: value
                      ? draft.isolationPolicy
                      : 'workspace',
                  })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={t('definition.workspacePlaceholder')}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">
                    {t('definition.workspaceNone')}
                  </SelectItem>
                  {workspaces.map(workspace => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </AutomationFormField>
          </section>

          <div className="border-t border-foreground/5" />

          <section className="grid gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-foreground">
                {t('execution.section')}
              </h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {t('execution.description')}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <AutomationFormField
                label={t('execution.sessionPolicy.label')}
                description={t('execution.sessionPolicy.description')}
              >
                <Select
                  value={draft.sessionPolicy}
                  onValueChange={(sessionPolicy) => {
                    if (
                      sessionPolicy !== 'new'
                      && sessionPolicy !== 'heartbeat'
                    ) {
                      return
                    }
                    onChange({
                      ...draft,
                      sessionPolicy,
                      isolationPolicy: sessionPolicy === 'heartbeat'
                        ? 'workspace'
                        : draft.isolationPolicy,
                    })
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">
                      {t('execution.sessionPolicy.new')}
                    </SelectItem>
                    <SelectItem value="heartbeat">
                      {t('execution.sessionPolicy.heartbeat')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </AutomationFormField>
              <AutomationFormField
                label={t('execution.isolationPolicy.label')}
                description={t('execution.isolationPolicy.description')}
              >
                <Select
                  value={draft.isolationPolicy}
                  onValueChange={(isolationPolicy) => {
                    if (
                      isolationPolicy === 'workspace'
                      || isolationPolicy === 'worktree_per_run'
                    ) {
                      onChange({ ...draft, isolationPolicy })
                    }
                  }}
                  disabled={!draft.workspaceId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="workspace">
                      {t('execution.isolationPolicy.workspace')}
                    </SelectItem>
                    <SelectItem
                      value="worktree_per_run"
                      disabled={draft.sessionPolicy === 'heartbeat'}
                    >
                      {t('execution.isolationPolicy.worktreePerRun')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </AutomationFormField>
              <AutomationFormField
                label={t('execution.completionPolicy.label')}
                description={t('execution.completionPolicy.description')}
              >
                <div className="flex h-8 items-center rounded-lg border border-input px-2.5 text-sm text-foreground">
                  {t('execution.completionPolicy.agentComplete')}
                </div>
              </AutomationFormField>
              <AutomationFormField
                label={t('execution.noFindings.label')}
                description={t('execution.noFindings.description')}
              >
                <Select
                  value={draft.noFindingsBehavior}
                  onValueChange={(noFindingsBehavior) => {
                    if (
                      noFindingsBehavior === 'archive'
                      || noFindingsBehavior === 'triage'
                    ) {
                      onChange({ ...draft, noFindingsBehavior })
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="archive">
                      {t('execution.noFindings.archive')}
                    </SelectItem>
                    <SelectItem value="triage">
                      {t('execution.noFindings.triage')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </AutomationFormField>
            </div>
          </section>

          <div className="border-t border-foreground/5" />

          <section className="grid gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-foreground">
                {t('schedule.section')}
              </h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {t('schedule.description')}
              </p>
            </div>
            <AutomationScheduleBuilderView
              schedule={draft.schedule}
              timezone={draft.timezone}
              misfirePolicy={draft.misfirePolicy}
              onScheduleChange={schedule =>
                onChange({ ...draft, schedule })}
              onTimezoneChange={timezone =>
                onChange({ ...draft, timezone })}
              onMisfirePolicyChange={misfirePolicy =>
                onChange({ ...draft, misfirePolicy })}
            />
          </section>

          <div className="border-t border-foreground/5" />

          <section className="grid gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-foreground">
                {t('runtime.section')}
              </h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {runtimeDescription}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border px-2 py-2">
              {runtimePicker}
              {selectedModelLabel && (
                <span className="ml-auto max-w-full truncate px-1 text-[11px] text-muted-foreground">
                  {selectedModelLabel}
                </span>
              )}
            </div>
          </section>

          <div className="border-t border-foreground/5" />

          <section className="grid gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-foreground">
                {t('recipe.section')}
              </h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {t('recipe.description')}
              </p>
            </div>
            <AutomationFormField label={t('recipe.promptLabel')}>
              <Textarea
                value={draft.prompt}
                onChange={event =>
                  onChange({ ...draft, prompt: event.target.value })}
                placeholder={t('recipe.promptPlaceholder')}
                className="min-h-40 resize-y text-[13px] leading-relaxed"
              />
            </AutomationFormField>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
              <AutomationFormField
                label={t('artifact.nameLabel')}
                description={t('artifact.nameDescription')}
              >
                <Input
                  value={draft.artifactName}
                  onChange={event =>
                    onChange({ ...draft, artifactName: event.target.value })}
                  placeholder={t('artifact.namePlaceholder')}
                />
              </AutomationFormField>
              <AutomationFormField
                label={t('artifact.kindLabel')}
                description={t('artifact.kindDescription')}
              >
                <div className="flex h-8 items-center rounded-lg border border-input px-2.5 text-sm text-muted-foreground">
                  {t('artifact.kindMarkdown')}
                </div>
              </AutomationFormField>
            </div>
          </section>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/40 px-4 py-3 sm:px-5">
        <p className="text-[11px] text-muted-foreground">
          {isEditing ? t('edit.footer') : t('create.footer')}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={saving}
          >
            {t('action.cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={saving || !saveEnabled}
          >
            {saving
              ? <Spinner className="size-3.5" />
              : <CheckIcon className="size-3.5" />}
            {isEditing
              ? t('action.saveChanges')
              : t('action.createAutomation')}
          </Button>
        </div>
      </footer>
    </div>
  )
}
