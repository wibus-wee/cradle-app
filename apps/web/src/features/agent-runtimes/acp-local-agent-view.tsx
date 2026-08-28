import {
  AddLine as PlusIcon,
  DeleteLine as DeleteIcon,
  SaveLine as SaveIcon,
  TerminalBoxLine as TerminalIcon,
} from '@mingcute/react'
import { useMemo, useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

import { AcpAgentIcon } from './acp-agent-icon'
import type { AcpLocalDistributionType } from './use-acp-registry'

export interface AcpLocalAgentDraft {
  name: string
  distributionType: AcpLocalDistributionType
  command: string
  argumentsText: string
  environmentText: string
}

export interface AcpLocalAgentSaveInput {
  name: string
  distributionType: AcpLocalDistributionType
  cmd: string
  args: string[]
  env: Record<string, string>
}

export interface AcpLocalAgentViewLabels {
  createTitle: string
  editTitle: string
  localChip: string
  name: string
  namePlaceholder: string
  launchMethod: string
  launchMethodCommand: string
  launchMethodNpx: string
  launchMethodUvx: string
  command: string
  packageName: string
  commandPlaceholder: string
  npxPlaceholder: string
  uvxPlaceholder: string
  arguments: string
  argumentsDescription: string
  argumentsPlaceholder: string
  environment: string
  environmentDescription: string
  environmentPlaceholder: string
  environmentInvalid: string
  save: string
  saving: string
  create: string
  creating: string
  delete: string
  deleting: string
  deleteTitle: string
  deleteDescription: string
  deleteCancel: string
  deleteConfirm: string
  cancel: string
}

function parseArguments(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function parseEnvironment(text: string): {
  env: Record<string, string>
  invalidLines: number[]
} {
  const entries: Array<readonly [string, string]> = []
  const invalidLines: number[] = []

  text.split('\n').forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line) {
      return
    }
    const separator = line.indexOf('=')
    const key = separator > 0 ? line.slice(0, separator).trim() : ''
    if (!key) {
      invalidLines.push(index + 1)
      return
    }
    entries.push([key, line.slice(separator + 1)] as const)
  })

  return { env: Object.fromEntries(entries), invalidLines }
}

export function AcpLocalAgentView({
  mode,
  agentId,
  initialDraft,
  labels,
  isSaving,
  isDeleting,
  error,
  deleteInUseMessage,
  supplementary,
  onSave,
  onDelete,
  onCancel,
}: {
  mode: 'create' | 'edit'
  agentId?: string
  initialDraft: AcpLocalAgentDraft
  labels: AcpLocalAgentViewLabels
  isSaving: boolean
  isDeleting: boolean
  error: string | null
  deleteInUseMessage?: string
  supplementary?: React.ReactNode
  onSave: (input: AcpLocalAgentSaveInput) => void
  onDelete?: () => void
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState(initialDraft)
  const environment = useMemo(() => parseEnvironment(draft.environmentText), [draft.environmentText])
  const isDirty = draft.name !== initialDraft.name
    || draft.distributionType !== initialDraft.distributionType
    || draft.command !== initialDraft.command
    || draft.argumentsText !== initialDraft.argumentsText
    || draft.environmentText !== initialDraft.environmentText
  const canSave = draft.name.trim().length > 0
    && draft.command.trim().length > 0
    && environment.invalidLines.length === 0
    && !isSaving
    && (mode === 'create' || isDirty)
  const commandPlaceholder = draft.distributionType === 'npx'
    ? labels.npxPlaceholder
    : draft.distributionType === 'uvx'
      ? labels.uvxPlaceholder
      : labels.commandPlaceholder

  return (
    <div className="flex flex-col gap-5 p-6" data-testid="acp-local-agent-view">
      <header className="flex items-start gap-3.5">
        <AcpAgentIcon className="size-10 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold text-foreground">
              {mode === 'create' ? labels.createTitle : labels.editTitle}
            </h2>
            <span className="inline-flex shrink-0 items-center rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
              {labels.localChip}
            </span>
          </div>
          {agentId && (
            <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary">{agentId}</p>
          )}
        </div>
      </header>

      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canSave) {
            return
          }
          onSave({
            name: draft.name.trim(),
            distributionType: draft.distributionType,
            cmd: draft.command.trim(),
            args: parseArguments(draft.argumentsText),
            env: environment.env,
          })
        }}
      >
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="acp-local-name">{labels.name}</FieldLabel>
            <Input
              id="acp-local-name"
              value={draft.name}
              onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
              placeholder={labels.namePlaceholder}
              autoComplete="off"
              data-testid="acp-local-name"
            />
          </Field>

          <Field>
            <FieldLabel>{labels.launchMethod}</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={draft.distributionType}
              onValueChange={(value) => {
                if (value === 'command' || value === 'npx' || value === 'uvx') {
                  setDraft(current => ({ ...current, distributionType: value }))
                }
              }}
              className="w-full"
              data-testid="acp-local-launch-method"
            >
              <ToggleGroupItem value="command" className="flex-1 gap-1.5">
                <TerminalIcon />
                {labels.launchMethodCommand}
              </ToggleGroupItem>
              <ToggleGroupItem value="npx" className="flex-1">{labels.launchMethodNpx}</ToggleGroupItem>
              <ToggleGroupItem value="uvx" className="flex-1">{labels.launchMethodUvx}</ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <Field>
            <FieldLabel htmlFor="acp-local-command">
              {draft.distributionType === 'command' ? labels.command : labels.packageName}
            </FieldLabel>
            <Input
              id="acp-local-command"
              value={draft.command}
              onChange={event => setDraft(current => ({ ...current, command: event.target.value }))}
              placeholder={commandPlaceholder}
              className="font-mono"
              autoComplete="off"
              data-testid="acp-local-command"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="acp-local-arguments">{labels.arguments}</FieldLabel>
            <Textarea
              id="acp-local-arguments"
              value={draft.argumentsText}
              onChange={event => setDraft(current => ({ ...current, argumentsText: event.target.value }))}
              placeholder={labels.argumentsPlaceholder}
              className="min-h-20 resize-y font-mono text-xs"
              data-testid="acp-local-arguments"
            />
            <FieldDescription className="text-[12px]">{labels.argumentsDescription}</FieldDescription>
          </Field>

          <Field data-invalid={environment.invalidLines.length > 0 || undefined}>
            <FieldLabel htmlFor="acp-local-environment">{labels.environment}</FieldLabel>
            <Textarea
              id="acp-local-environment"
              value={draft.environmentText}
              onChange={event => setDraft(current => ({ ...current, environmentText: event.target.value }))}
              placeholder={labels.environmentPlaceholder}
              className="min-h-20 resize-y font-mono text-xs"
              aria-invalid={environment.invalidLines.length > 0 || undefined}
              data-testid="acp-local-environment"
            />
            <FieldDescription className="text-[12px]">{labels.environmentDescription}</FieldDescription>
            {environment.invalidLines.length > 0 && (
              <p className="text-[12px] text-destructive" role="alert">
                {labels.environmentInvalid.replace('{{lines}}', environment.invalidLines.join(', '))}
              </p>
            )}
          </Field>
        </FieldGroup>

        {error && <p className="text-[12px] text-destructive" role="alert">{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!canSave} data-testid="acp-local-save">
            {mode === 'create' ? <PlusIcon /> : <SaveIcon />}
            {isSaving
              ? mode === 'create' ? labels.creating : labels.saving
              : mode === 'create' ? labels.create : labels.save}
          </Button>
          {mode === 'create' && onCancel && (
            <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={isSaving}>
              {labels.cancel}
            </Button>
          )}
          {mode === 'edit' && onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" size="sm" variant="destructive" disabled={isDeleting}>
                  <DeleteIcon />
                  {isDeleting ? labels.deleting : labels.delete}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{labels.deleteTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {labels.deleteDescription}
                    {deleteInUseMessage && (
                      <span className="mt-1.5 block text-destructive">{deleteInUseMessage}</span>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{labels.deleteCancel}</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-white hover:bg-destructive/90"
                    onClick={onDelete}
                    data-testid="acp-local-delete-confirm"
                  >
                    {labels.deleteConfirm}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </form>

      {supplementary}
    </div>
  )
}
