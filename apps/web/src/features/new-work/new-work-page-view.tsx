import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { NewWorkFailureKind } from './new-work-error-view'
import { NewWorkErrorView } from './new-work-error-view'

export interface NewWorkPageViewProps {
  composer: ReactNode
  workspaceCount: number
  loadingWorkspaces: boolean
  failureKind: NewWorkFailureKind | null
  failureMessage: string | null
  canOpenChanges: boolean
  canStartFromRemoteDefault: boolean
  onOpenChanges: () => void
  onStartFromRemoteDefault: () => void
  onDismissFailure: () => void
}

export function NewWorkPageView({
  composer,
  workspaceCount,
  loadingWorkspaces,
  failureKind,
  failureMessage,
  canOpenChanges,
  canStartFromRemoteDefault,
  onOpenChanges,
  onStartFromRemoteDefault,
  onDismissFailure,
}: NewWorkPageViewProps) {
  const { t } = useTranslation('work')

  return (
    <div
      className="flex h-full flex-col bg-background"
      data-testid="new-work-page"
    >
      <div className="flex flex-1 items-center justify-center px-4 pb-8 sm:px-6">
        <div className="w-full max-w-160">
          <div className="mb-5 px-1">
            <h1 className="text-xl font-semibold text-foreground">
              {t('new.title')}
            </h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              {t('new.description')}
            </p>
          </div>

          {composer}

          {!loadingWorkspaces && workspaceCount === 0
            ? (
                <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  {t('new.noLocalWorkspace')}
                </div>
              )
            : null}

          {failureKind
            ? (
                <NewWorkErrorView
                  kind={failureKind}
                  message={failureMessage}
                  canOpenChanges={canOpenChanges}
                  canStartFromRemoteDefault={canStartFromRemoteDefault}
                  onOpenChanges={onOpenChanges}
                  onStartFromRemoteDefault={onStartFromRemoteDefault}
                  onDismiss={onDismissFailure}
                />
              )
            : null}
        </div>
      </div>
    </div>
  )
}
