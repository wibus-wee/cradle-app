import {
  DownSmallLine as ChevronDownIcon,
  UpSmallLine as ChevronUpIcon,
} from '@mingcute/react'
import type { MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface WorkspaceSessionListViewProps {
  workspaceId: string
  sessionCount: number
  expanded: boolean
  hiddenSessionCount: number
  children: ReactNode
  onToggleExpanded: () => void
}

export function WorkspaceSessionListView({
  workspaceId,
  sessionCount,
  expanded,
  hiddenSessionCount,
  children,
  onToggleExpanded,
}: WorkspaceSessionListViewProps) {
  const { t } = useTranslation('workspace')

  const toggleExpanded = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onToggleExpanded()
  }

  return (
    <div className="min-w-0 overflow-hidden">
      <div className="ml-4.25 flex min-w-0 flex-col gap-0.5 border-l border-sidebar-border/50 py-0.5 pl-2">
        {sessionCount === 0
          ? (
              <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
                {t('session.empty')}
              </p>
            )
          : children}
        {hiddenSessionCount > 0
          ? (
              <button
                type="button"
                onClick={toggleExpanded}
                className="mt-0.5 flex h-6 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-left text-[11px] text-muted-foreground hover:bg-accent/50 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-expanded={expanded}
                data-testid={`workspace-sessions-toggle-${workspaceId}`}
              >
                {expanded
                  ? (
                      <ChevronUpIcon
                        className="size-3 shrink-0"
                        aria-hidden="true"
                      />
                    )
                  : (
                      <ChevronDownIcon
                        className="size-3 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                <span className="min-w-0 truncate">
                  {expanded
                    ? t('session.action.showLess')
                    : t('session.action.showAll', {
                        count: hiddenSessionCount,
                      })}
                </span>
              </button>
            )
          : null}
      </div>
    </div>
  )
}
