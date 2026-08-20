import { LoadingLine } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
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
  onOpenChange: (open: boolean) => void
  onRevokeGrant: (grantId: string) => void
}

const EASE = 'ease-[cubic-bezier(0.23,1,0.32,1)]'

export function NodeAccessDialogView({
  open,
  node,
  grants,
  revokingGrantId = null,
  onOpenChange,
  onRevokeGrant,
}: NodeAccessDialogViewProps) {
  const { t } = useTranslation('nodes')

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
                          <button
                            type="button"
                            className={cn(
                              'rounded-md px-2 py-1 text-[12px] text-muted-foreground',
                              'transition-all duration-120',
EASE,
                              'hover:bg-destructive/10 hover:text-destructive active:scale-[0.97]',
                            )}
                            disabled={revokingGrantId === grant.grantId}
                            onClick={() => onRevokeGrant(grant.grantId)}
                          >
                            {revokingGrantId === grant.grantId && (
                              <LoadingLine className="size-3 animate-spin" aria-hidden />
                            )}
                            {t('access.remove')}
                          </button>
                        )}
                  </li>
                ))}
              </ul>
            )}
      </DialogContent>
    </Dialog>
  )
}
