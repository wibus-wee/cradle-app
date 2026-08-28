import {
  AddLine as PlusIcon,
  DeleteLine as DeleteIcon,
  SaveLine as SaveIcon,
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

import { AcpAgentIcon } from './acp-agent-icon'
import type { AcpAuthSecret } from './acp-auth-view'

export interface AcpRemoteHeaderDraft {
  id: string
  name: string
  secretId: string
}

export interface AcpRemoteAgentDraft {
  name: string
  connectionType: 'http' | 'websocket'
  endpointUrl: string
  headers: AcpRemoteHeaderDraft[]
}

export interface AcpRemoteAgentSaveInput {
  name: string
  connectionType: 'http' | 'websocket'
  endpointUrl: string
  headerSecretRefs: Record<string, string>
}

export interface AcpRemoteAgentViewLabels {
  createTitle: string
  editTitle: string
  remoteChip: string
  name: string
  namePlaceholder: string
  transport: string
  http: string
  websocket: string
  endpoint: string
  endpointPlaceholderHttp: string
  endpointPlaceholderWebsocket: string
  endpointDescription: string
  headers: string
  headersDescription: string
  headerName: string
  headerNamePlaceholder: string
  secret: string
  secretPlaceholder: string
  noSecrets: string
  addHeader: string
  removeHeader: string
  duplicateHeader: string
  incompleteHeader: string
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

function headerRecord(headers: AcpRemoteHeaderDraft[]): Record<string, string> {
  return Object.fromEntries(headers.map(header => [header.name.trim(), header.secretId]))
}

export function AcpRemoteAgentView({
  mode,
  agentId,
  initialDraft,
  secrets,
  isSecretsLoading,
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
  initialDraft: AcpRemoteAgentDraft
  secrets: AcpAuthSecret[]
  isSecretsLoading: boolean
  labels: AcpRemoteAgentViewLabels
  isSaving: boolean
  isDeleting: boolean
  error: string | null
  deleteInUseMessage?: string
  supplementary?: React.ReactNode
  onSave: (input: AcpRemoteAgentSaveInput) => void
  onDelete?: () => void
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState(initialDraft)
  const normalizedNames = draft.headers.map(header => header.name.trim().toLowerCase()).filter(Boolean)
  const hasDuplicateHeader = new Set(normalizedNames).size !== normalizedNames.length
  const hasIncompleteHeader = draft.headers.some(header => !header.name.trim() || !header.secretId)
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialDraft),
    [draft, initialDraft],
  )
  const canSave = draft.name.trim().length > 0
    && draft.endpointUrl.trim().length > 0
    && !hasDuplicateHeader
    && !hasIncompleteHeader
    && !isSaving
    && (mode === 'create' || isDirty)

  return (
    <div className="flex flex-col gap-5 p-6" data-testid="acp-remote-agent-view">
      <header className="flex items-start gap-3.5">
        <AcpAgentIcon className="size-10 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold text-foreground">
              {mode === 'create' ? labels.createTitle : labels.editTitle}
            </h2>
            <span className="inline-flex shrink-0 items-center rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
              {labels.remoteChip}
            </span>
          </div>
          {agentId && <p className="mt-1 truncate font-mono text-[11px] text-text-tertiary">{agentId}</p>}
        </div>
      </header>

      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canSave) { return }
          onSave({
            name: draft.name.trim(),
            connectionType: draft.connectionType,
            endpointUrl: draft.endpointUrl.trim(),
            headerSecretRefs: headerRecord(draft.headers),
          })
        }}
      >
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="acp-remote-name">{labels.name}</FieldLabel>
            <Input
              id="acp-remote-name"
              value={draft.name}
              onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
              placeholder={labels.namePlaceholder}
              autoComplete="off"
            />
          </Field>

          <Field>
            <FieldLabel>{labels.transport}</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={draft.connectionType}
              onValueChange={(value) => {
                if (value === 'http' || value === 'websocket') {
                  setDraft(current => ({ ...current, connectionType: value }))
                }
              }}
              className="w-full"
            >
              <ToggleGroupItem value="http" className="flex-1">{labels.http}</ToggleGroupItem>
              <ToggleGroupItem value="websocket" className="flex-1">{labels.websocket}</ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <Field>
            <FieldLabel htmlFor="acp-remote-endpoint">{labels.endpoint}</FieldLabel>
            <Input
              id="acp-remote-endpoint"
              value={draft.endpointUrl}
              onChange={event => setDraft(current => ({ ...current, endpointUrl: event.target.value }))}
              placeholder={draft.connectionType === 'http' ? labels.endpointPlaceholderHttp : labels.endpointPlaceholderWebsocket}
              className="font-mono"
              inputMode="url"
              autoComplete="url"
            />
            <FieldDescription className="text-[12px]">{labels.endpointDescription}</FieldDescription>
          </Field>

          <Field data-invalid={hasDuplicateHeader || hasIncompleteHeader || undefined}>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>{labels.headers}</FieldLabel>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDraft(current => ({
                  ...current,
                  headers: [...current.headers, { id: crypto.randomUUID(), name: '', secretId: '' }],
                }))}
              >
                <PlusIcon />
                {labels.addHeader}
              </Button>
            </div>
            <FieldDescription className="text-[12px]">{labels.headersDescription}</FieldDescription>
            {draft.headers.map(header => (
              <div key={header.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-end gap-2">
                <div className="min-w-0">
                  <label className="mb-1 block text-[11px] text-text-tertiary" htmlFor={`acp-header-${header.id}`}>
                    {labels.headerName}
                  </label>
                  <Input
                    id={`acp-header-${header.id}`}
                    value={header.name}
                    onChange={event => setDraft(current => ({
                      ...current,
                      headers: current.headers.map(item => item.id === header.id ? { ...item, name: event.target.value } : item),
                    }))}
                    placeholder={labels.headerNamePlaceholder}
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
                <div className="min-w-0">
                  <span className="mb-1 block text-[11px] text-text-tertiary">{labels.secret}</span>
                  <Select
                    value={header.secretId}
                    onValueChange={secretId => setDraft(current => ({
                      ...current,
                      headers: current.headers.map(item => item.id === header.id ? { ...item, secretId } : item),
                    }))}
                    disabled={isSecretsLoading || secrets.length === 0}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder={isSecretsLoading ? labels.secretPlaceholder : secrets.length === 0 ? labels.noSecrets : labels.secretPlaceholder} /></SelectTrigger>
                    <SelectContent>
                      {secrets.map(secret => <SelectItem key={secret.id} value={secret.id}>{secret.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={labels.removeHeader}
                  onClick={() => setDraft(current => ({ ...current, headers: current.headers.filter(item => item.id !== header.id) }))}
                >
                  <DeleteIcon />
                </Button>
              </div>
            ))}
            {hasDuplicateHeader && <p className="text-[12px] text-destructive" role="alert">{labels.duplicateHeader}</p>}
            {!hasDuplicateHeader && hasIncompleteHeader && <p className="text-[12px] text-destructive" role="alert">{labels.incompleteHeader}</p>}
          </Field>
        </FieldGroup>

        {error && <p className="text-[12px] text-destructive" role="alert">{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!canSave}>
            <SaveIcon />
            {isSaving ? (mode === 'create' ? labels.creating : labels.saving) : (mode === 'create' ? labels.create : labels.save)}
          </Button>
          {mode === 'create' && onCancel && <Button type="button" size="sm" variant="outline" onClick={onCancel}>{labels.cancel}</Button>}
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
                    {deleteInUseMessage && <span className="mt-1.5 block text-destructive">{deleteInUseMessage}</span>}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{labels.deleteCancel}</AlertDialogCancel>
                  <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={onDelete}>
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
