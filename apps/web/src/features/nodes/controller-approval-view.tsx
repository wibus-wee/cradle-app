import { CellphoneLine as ControllerIcon, LoadingLine } from '@mingcute/react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'

import type { ControllerGrantScope, ControllerGrantSelection, FabricNode, PendingFabricControllerRequest } from './types'
import {
  CONTROLLER_GRANT_SCOPES,
} from './types'

export interface ControllerApprovalViewProps {
  open: boolean
  request: PendingFabricControllerRequest | null
  identityFingerprint: string | null
  nodes: FabricNode[]
  submitting: boolean
  onOpenChange: (open: boolean) => void
  onApprove: (grants: ControllerGrantSelection[]) => void
}

export function ControllerApprovalView({
  open,
  request,
  identityFingerprint,
  nodes,
  submitting,
  onOpenChange,
  onApprove,
}: ControllerApprovalViewProps) {
  const { t } = useTranslation('nodes')
  const controlId = useId()
  const [selection, setSelection] = useState<Record<string, ControllerGrantScope[]>>({})
  const [validationVisible, setValidationVisible] = useState(false)

  useEffect(() => {
    setSelection({})
    setValidationVisible(false)
  }, [request?.requestId])

  const grants = nodes.flatMap<ControllerGrantSelection>((node) => {
    const scopes = selection[node.nodeId] ?? []
    return scopes.length > 0 ? [{ nodeId: node.nodeId, scopes }] : []
  })
  const hasControlGrant = grants.some(grant => grant.scopes.includes('control'))

  const toggleScope = (nodeId: string, scope: ControllerGrantScope, checked: boolean) => {
    setSelection((current) => {
      const scopes = current[nodeId] ?? []
      const nextScopes = checked
        ? CONTROLLER_GRANT_SCOPES.filter(candidate => candidate === scope || scopes.includes(candidate))
        : scopes.filter(candidate => candidate !== scope)
      return { ...current, [nodeId]: nextScopes }
    })
    setValidationVisible(false)
  }

  const handleApprove = () => {
    if (!hasControlGrant) {
      setValidationVisible(true)
      return
    }
    onApprove(grants)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ControllerIcon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate">
                {t('controllerApproval.title', { name: request?.displayName ?? '' })}
              </DialogTitle>
              {request && (
                <p className="mt-1 text-pretty text-[12px] text-muted-foreground">
                  {request.platform}
                  {' · '}
                  {t('popover.version', { version: request.version })}
                </p>
              )}
            </div>
          </div>
          <DialogDescription className="text-pretty">
            {t('controllerApproval.description')}
          </DialogDescription>
        </DialogHeader>

        {request && identityFingerprint && (
          <div className="flex min-w-0 items-center justify-between gap-3 border-y border-border/60 py-2.5">
            <span className="text-[12px] text-muted-foreground">{t('controllerApproval.identity')}</span>
            <code className="truncate font-mono text-[12px]" title={identityFingerprint}>
              {identityFingerprint}
            </code>
          </div>
        )}

        {nodes.length === 0
          ? (
              <p className="py-4 text-pretty text-[12px] text-muted-foreground">
                {t('controllerApproval.noNodes')}
              </p>
            )
          : (
              <div className="divide-y divide-border/60 border-y border-border/60">
                {nodes.map((node, nodeIndex) => (
                  <section key={node.nodeId} className="py-3" aria-labelledby={`${controlId}-node-${nodeIndex}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 id={`${controlId}-node-${nodeIndex}`} className="text-[13px] font-medium">
                        {node.displayName}
                      </h3>
                      <Badge variant={node.status === 'online' ? 'secondary' : 'outline'}>
                        {t(node.status === 'online' ? 'status.online' : 'status.offline')}
                      </Badge>
                    </div>
                    <div className="mt-2 grid gap-1 sm:grid-cols-3">
                      {CONTROLLER_GRANT_SCOPES.map(scope => (
                        <Label
                          key={scope}
                          className="min-h-10 cursor-pointer rounded-md px-2 text-[12px] font-normal hover:bg-muted"
                        >
                          <Checkbox
                            checked={(selection[node.nodeId] ?? []).includes(scope)}
                            data-testid={`controller-grant-${node.nodeId}-${scope}`}
                            disabled={submitting}
                            onCheckedChange={checked => toggleScope(node.nodeId, scope, checked === true)}
                          />
                          {t(`scope.${scope}`)}
                        </Label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}

        {validationVisible && (
          <p role="alert" className="text-pretty text-[12px] text-destructive">
            {t('controllerApproval.controlRequired')}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t('controllerApproval.cancel')}
          </Button>
          <Button
            type="button"
            data-testid="controller-approval-submit"
            disabled={submitting || nodes.length === 0}
            onClick={handleApprove}
          >
            {submitting && <LoadingLine className="size-4 animate-spin" aria-hidden />}
            {t('controllerApproval.approve')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
