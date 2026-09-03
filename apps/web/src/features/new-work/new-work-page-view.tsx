import { NewFolderLine as FolderPlusIcon } from '@mingcute/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'

import type { NewWorkFailureKind } from './new-work-error-view'
import { NewWorkErrorView } from './new-work-error-view'

export interface NewWorkPageViewProps {
  composer: ReactNode
  workspaceCount: number
  loadingWorkspaces: boolean
  addingWorkspace: boolean
  failureKind: NewWorkFailureKind | null
  failureMessage: string | null
  canOpenChanges: boolean
  onOpenChanges: () => void
  onAddWorkspace: () => void
  onDismissFailure: () => void
}

export function NewWorkPageView({
  composer,
  workspaceCount,
  loadingWorkspaces,
  addingWorkspace,
  failureKind,
  failureMessage,
  canOpenChanges,
  onOpenChanges,
  onAddWorkspace,
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
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  <span>{t('new.noLocalWorkspace')}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onAddWorkspace}
                    disabled={addingWorkspace}
                    className="shrink-0"
                  >
                    <FolderPlusIcon className="size-3.5" aria-hidden="true" />
                    {addingWorkspace ? t('new.addingProject') : t('new.addProject')}
                  </Button>
                </div>
              )
            : null}

          {failureKind
            ? (
                <NewWorkErrorView
                  kind={failureKind}
                  message={failureMessage}
                  canOpenChanges={canOpenChanges}
                  onOpenChanges={onOpenChanges}
                  onDismiss={onDismissFailure}
                />
              )
            : null}
        </div>
      </div>
    </div>
  )
}
