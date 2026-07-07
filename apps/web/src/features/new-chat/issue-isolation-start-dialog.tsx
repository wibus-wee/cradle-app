import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import type { IssueIsolationContextGroup } from '~/features/session/use-session-isolation'
import { cn } from '~/lib/cn'

export type IssueIsolationStartChoice = 'main' | 'continue' | 'new-isolated'

interface IssueIsolationStartDialogProps {
  open: boolean
  groups: IssueIsolationContextGroup[]
  onOpenChange: (open: boolean) => void
  onConfirm: (choice: IssueIsolationStartChoice, worktreeId?: string) => void
}

export function IssueIsolationStartDialog({
  open,
  groups,
  onOpenChange,
  onConfirm,
}: IssueIsolationStartDialogProps) {
  const { t } = useTranslation('session-isolation')
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(
    groups[0]?.worktreeId ?? null,
  )

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="issue-isolation-start-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('newChat.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('newChat.description')}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2 py-1">
          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start px-3 py-2 text-left"
            onClick={() => onConfirm('main')}
          >
            <span className="text-[13px] font-medium">{t('newChat.main')}</span>
          </Button>

          {groups.length > 0 && (
            <div className="rounded-lg border border-border/60 p-2">
              <p className="mb-2 text-[11px] text-muted-foreground">{t('newChat.continueLabel')}</p>
              <div className="flex flex-col gap-1">
                {groups.map(group => (
                  <button
                    key={group.worktreeId}
                    type="button"
                    onClick={() => setSelectedWorktreeId(group.worktreeId)}
                    className={cn(
                      'rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
                      selectedWorktreeId === group.worktreeId
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                  >
                    <div className="font-medium">{group.name}</div>
                    <div className="text-[10px] opacity-70">{group.branch}</div>
                    <div className="text-[10px] opacity-60">
                      {t('newChat.sessionCount', { count: group.sessionIds.length })}
                    </div>
                  </button>
                ))}
              </div>
              <Button
                type="button"
                className="mt-2 w-full"
                disabled={!selectedWorktreeId}
                onClick={() => {
                  if (selectedWorktreeId) {
                    onConfirm('continue', selectedWorktreeId)
                  }
                }}
              >
                {t('newChat.continueAction')}
              </Button>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            className="h-auto justify-start px-3 py-2 text-left"
            onClick={() => onConfirm('new-isolated')}
          >
            <span className="text-[13px] font-medium">{t('newChat.newIsolated')}</span>
          </Button>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{t('newChat.cancel')}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
