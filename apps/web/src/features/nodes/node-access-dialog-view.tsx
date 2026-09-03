import { Delete2Line as RemoveIcon, LoadingLine } from '@mingcute/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { cn } from '~/lib/cn'

import type { FabricNode, NodeGrant } from './types'

export interface NodeAccessDialogViewProps {
  open: boolean
  node: FabricNode | null
  grants: NodeGrant[]
  revokingGrantId?: string | null
  revokingControllerId?: string | null
  onOpenChange: (open: boolean) => void
  onRevokeGrant: (grantId: string) => void
  onRevokeController: (controllerId: string) => void
}

const EASE = 'ease-[cubic-bezier(0.23,1,0.32,1)]'

export function NodeAccessDialogView({
  open,
  node,
  grants,
  revokingGrantId = null,
  revokingControllerId = null,
  onOpenChange,
  onRevokeGrant,
  onRevokeController,
}: NodeAccessDialogViewProps) {
  const { t } = useTranslation('nodes')
  const [revokeGrant, setRevokeGrant] = useState<NodeGrant | null>(null)
  const [revocationMode, setRevocationMode] = useState<'grant' | 'controller'>('grant')
  const revoking = revokingGrantId !== null || revokingControllerId !== null

  useEffect(() => {
    if (revokeGrant && !grants.some(grant => grant.grantId === revokeGrant.grantId && !grant.revokedAt)) {
      setRevokeGrant(null)
      setRevocationMode('grant')
    }
  }, [grants, revokeGrant])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('access.title', { name: node?.displayName ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('access.description')}</DialogDescription>
        </DialogHeader>

        {grants.length === 0
          ? (
              <p className="text-[12px] text-muted-foreground">{t('access.empty')}</p>
            )
          : (
              <ul className="flex min-w-0 flex-col gap-1.5">
                {grants.map(grant => (
                  <li
                    key={grant.grantId}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2 py-1.5',
                      'transition-colors duration-120',
                      EASE,
                      'hover:bg-accent/50',
                      grant.revokedAt && 'opacity-50',
                    )}
                    data-testid={`node-grant-${grant.grantId}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {grant.controllerLabel}
                    </span>
                    <Badge variant="secondary">{t(`scope.${grant.scope}`)}</Badge>
                    {grant.revokedAt
                      ? (
                          <span className="text-[11px] text-muted-foreground">
                            {t('access.revoked')}
                          </span>
                        )
                      : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-lg"
                            className="size-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            disabled={revoking}
                            data-testid={`node-grant-remove-${grant.grantId}`}
                            onClick={() => {
                              setRevokeGrant(grant)
                              setRevocationMode('grant')
                            }}
                            aria-label={t('access.remove')}
                            title={t('access.remove')}
                          >
                            {revokingGrantId === grant.grantId
                              ? <LoadingLine className="size-4 animate-spin" aria-hidden />
                              : <RemoveIcon className="size-4" aria-hidden />}
                          </Button>
                        )}
                  </li>
                ))}
              </ul>
            )}

        <AlertDialog
          open={revokeGrant !== null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && !revoking) {
              setRevokeGrant(null)
              setRevocationMode('grant')
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t(revocationMode === 'controller'
                  ? 'access.revokeControllerTitle'
                  : 'access.revokeTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(revocationMode === 'controller'
                  ? 'access.revokeControllerDescription'
                  : 'access.revokeDescription', {
                  controller: revokeGrant?.controllerLabel ?? '',
                  node: node?.displayName ?? '',
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {revocationMode === 'controller'
                ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={revoking}
                      onClick={() => setRevocationMode('grant')}
                    >
                      {t('access.revokeControllerBack')}
                    </Button>
                  )
                : (
                    <AlertDialogCancel disabled={revoking}>
                      {t('access.revokeCancel')}
                    </AlertDialogCancel>
                  )}
              {revocationMode === 'grant' && (
                <Button
                  type="button"
                  variant="destructive"
                  data-testid="revoke-controller-choice"
                  disabled={revoking}
                  onClick={() => setRevocationMode('controller')}
                >
                  {t('access.revokeEverywhere')}
                </Button>
              )}
              <AlertDialogAction
                variant="destructive"
                data-testid={revocationMode === 'controller'
                  ? 'revoke-controller-confirm'
                  : 'revoke-grant-confirm'}
                disabled={revoking}
                onClick={(event) => {
                  event.preventDefault()
                  if (revokeGrant) {
                    if (revocationMode === 'controller') {
                      onRevokeController(revokeGrant.controllerId)
                    }
                    else {
                      onRevokeGrant(revokeGrant.grantId)
                    }
                  }
                }}
              >
                {revoking && <LoadingLine className="size-4 animate-spin" aria-hidden />}
                {t(revocationMode === 'controller'
                  ? 'access.revokeControllerConfirm'
                  : 'access.revokeConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
