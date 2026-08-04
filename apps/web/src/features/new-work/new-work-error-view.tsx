import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'

export type NewWorkFailureKind
  = | 'dirty-source'
    | 'remote-base-unavailable'
    | 'generic'

export interface NewWorkErrorViewProps {
  kind: NewWorkFailureKind
  message: string | null
  canOpenChanges: boolean
  onOpenChanges: () => void
  onDismiss: () => void
}

export function NewWorkErrorView({
  kind,
  message,
  canOpenChanges,
  onOpenChanges,
  onDismiss,
}: NewWorkErrorViewProps) {
  const { t } = useTranslation('work')
  const dirty = kind === 'dirty-source'
  const remoteBaseUnavailable = kind === 'remote-base-unavailable'

  return (
    <div
      className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3"
      data-testid="new-work-error"
    >
      <div className="text-sm font-medium text-foreground">
        {dirty
          ? t('new.dirtyTitle')
          : remoteBaseUnavailable
            ? t('new.remoteBaseUnavailableTitle')
            : t('new.createFailed')}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">
        {dirty
          ? t('new.dirtyDescription')
          : remoteBaseUnavailable
            ? t('new.remoteBaseUnavailableDescription')
            : message}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canOpenChanges
          ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onOpenChanges}
              >
                {t('new.openChanges')}
              </Button>
            )
          : null}
        <Button
          type="button"
          size="sm"
          onClick={onDismiss}
        >
          {t('new.tryAgain')}
        </Button>
      </div>
    </div>
  )
}
