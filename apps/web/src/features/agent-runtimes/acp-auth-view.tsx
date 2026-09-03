import {
  CheckLine as CheckIcon,
  ExternalLinkLine as ExternalLinkIcon,
  Key2Line as KeyIcon,
  Refresh2Line as RefreshIcon,
  WarningLine as WarningIcon,
} from '@mingcute/react'
import { useState } from 'react'

import type { GetAcpAgentsByAgentIdAuthMethodsResponse } from '~/api-gen/types.gen'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Skeleton } from '~/components/ui/skeleton'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

export type AcpAuthMethod = GetAcpAgentsByAgentIdAuthMethodsResponse['methods'][number]

export interface AcpAuthViewLabels {
  title: string
  loading: string
  loadErrorTitle: string
  loadErrorDescription: string
  retry: string
  noMethods: string
  configuredPrefix: string
  configuredUnavailable: string
  change: string
  clear: string
  clearing: string
  methodLabel: string
  agentKind: string
  terminalKind: string
  unsupported: string
  cancel: string
  authenticate: string
  saving: string
}

export interface AcpAuthViewProps {
  methods: AcpAuthMethod[]
  selectedMethodId: string | null
  isLoading: boolean
  loadError: boolean
  pendingAction: 'save' | 'clear' | null
  labels: AcpAuthViewLabels
  onRetry: () => void
  onSave: (input: { methodId: string }) => void
  onClear: () => void
  onOpenLink: (url: string) => void
}

function methodKindLabel(method: AcpAuthMethod, labels: AcpAuthViewLabels): string {
  if (method.kind === 'agent') {
    return labels.agentKind
  }
  return labels.terminalKind
}

export function AcpAuthView({
  methods,
  selectedMethodId,
  isLoading,
  loadError,
  pendingAction,
  labels,
  onRetry,
  onSave,
  onClear,
  onOpenLink,
}: AcpAuthViewProps) {
  const selectedMethod = methods.find(method => method.id === selectedMethodId)
  const availableSelectedMethod = selectedMethod?.status === 'supported' ? selectedMethod : null
  const firstSupportedMethod = methods.find(method => method.status === 'supported')
  const [isEditing, setIsEditing] = useState(selectedMethodId == null)
  const [draftMethodId, setDraftMethodId] = useState(
    selectedMethod?.status === 'supported' ? selectedMethod.id : (firstSupportedMethod?.id ?? ''),
  )

  const draftMethod = methods.find(method => method.id === draftMethodId)
  const canSave = draftMethod?.status === 'supported' && pendingAction == null

  const selectMethod = (methodId: string) => {
    setDraftMethodId(methodId)
  }

  const cancelEditing = () => {
    setDraftMethodId(selectedMethod?.status === 'supported' ? selectedMethod.id : (firstSupportedMethod?.id ?? ''))
    setIsEditing(false)
  }

  return (
    <section className="flex flex-col gap-3 border-t border-border/60 pt-4" data-testid="acp-auth-section">
      <div className="flex items-center gap-2">
        <KeyIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-[13px] font-medium text-foreground text-balance">{labels.title}</h3>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2" aria-label={labels.loading}>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
      )}

      {!isLoading && loadError && (
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>{labels.loadErrorTitle}</AlertTitle>
          <AlertDescription>{labels.loadErrorDescription}</AlertDescription>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 h-8 after:absolute after:-inset-y-1"
            onClick={onRetry}
          >
            <RefreshIcon />
            {labels.retry}
          </Button>
          {selectedMethodId != null && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-2 ml-1 h-8 text-destructive after:absolute after:-inset-y-1 hover:text-destructive"
              disabled={pendingAction != null}
              onClick={onClear}
            >
              {pendingAction === 'clear' && <Spinner className="size-3.5" />}
              {pendingAction === 'clear' ? labels.clearing : labels.clear}
            </Button>
          )}
        </Alert>
      )}

      {!isLoading && !loadError && methods.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] leading-relaxed text-muted-foreground text-pretty">{labels.noMethods}</p>
          {selectedMethodId != null && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive after:absolute after:-inset-y-1 hover:text-destructive"
              disabled={pendingAction != null}
              onClick={onClear}
            >
              {pendingAction === 'clear' && <Spinner className="size-3.5" />}
              {pendingAction === 'clear' ? labels.clearing : labels.clear}
            </Button>
          )}
        </div>
      )}

      {!isLoading && !loadError && methods.length > 0 && selectedMethodId != null && !isEditing && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-fill/70 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md',
                availableSelectedMethod ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
              )}
            >
              {availableSelectedMethod
                ? <CheckIcon className="size-3.5" aria-hidden="true" />
                : <WarningIcon className="size-3.5" aria-hidden="true" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-foreground">
                {availableSelectedMethod ? `${labels.configuredPrefix}${availableSelectedMethod.name}` : labels.configuredUnavailable}
              </p>
              {availableSelectedMethod && (
                <p className="text-[11px] text-muted-foreground">{methodKindLabel(availableSelectedMethod, labels)}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="after:absolute after:-inset-y-1"
              disabled={pendingAction != null}
              onClick={() => setIsEditing(true)}
            >
              {labels.change}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive after:absolute after:-inset-y-1 hover:text-destructive"
              disabled={pendingAction != null}
              onClick={onClear}
            >
              {pendingAction === 'clear' && <Spinner className="size-3.5" />}
              {pendingAction === 'clear' ? labels.clearing : labels.clear}
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !loadError && methods.length > 0 && (selectedMethodId == null || isEditing) && (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[12px] font-medium text-foreground">{labels.methodLabel}</legend>
            <RadioGroup value={draftMethodId} onValueChange={selectMethod} className="gap-1.5">
              {methods.map(method => (
                <div
                  key={method.id}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors',
                    draftMethodId === method.id ? 'bg-accent' : 'bg-fill/50 hover:bg-fill',
                    method.status === 'unsupported' && 'cursor-not-allowed opacity-60',
                  )}
                  onClick={() => {
                    if (method.status === 'supported') {
                      selectMethod(method.id)
                    }
                  }}
                >
                  <RadioGroupItem
                    value={method.id}
                    disabled={method.status === 'unsupported'}
                    className="mt-0.5"
                    aria-label={method.name}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground">{method.name}</span>
                      <span className="rounded-sm bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {method.status === 'unsupported' ? labels.unsupported : methodKindLabel(method, labels)}
                      </span>
                    </span>
                    {(method.description || method.unavailableReason) && (
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground text-pretty">
                        {method.unavailableReason ?? method.description}
                      </span>
                    )}
                  </span>
                  {method.link && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="after:absolute after:-inset-1.5"
                      aria-label={method.name}
                      onClick={(event) => {
                        event.stopPropagation()
                        event.preventDefault()
                        onOpenLink(method.link!)
                      }}
                    >
                      <ExternalLinkIcon className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              className="h-10 px-3"
              disabled={!canSave}
              onClick={() => {
                if (!draftMethod || !canSave) {
                  return
                }
                onSave({ methodId: draftMethod.id })
              }}
            >
              {pendingAction === 'save' && <Spinner className="size-3.5" />}
              {pendingAction === 'save' ? labels.saving : labels.authenticate}
            </Button>
            {selectedMethodId != null && (
              <Button
                type="button"
                variant="ghost"
                className="h-10 px-3"
                disabled={pendingAction != null}
                onClick={cancelEditing}
              >
                {labels.cancel}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
