import { DownSmallLine as ChevronDownIcon, UpSmallLine as ChevronUpIcon } from '@mingcute/react'
import type { MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface WorkspaceRecentSessionListViewProps {
  sessionCount: number
  expanded: boolean
  hiddenSessionCount: number
  children: ReactNode
  onToggleExpanded: () => void
}

export function WorkspaceRecentSessionListView({
  sessionCount,
  expanded,
  hiddenSessionCount,
  children,
  onToggleExpanded,
}: WorkspaceRecentSessionListViewProps) {
  const { t } = useTranslation('workspace')

  const toggleExpanded = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onToggleExpanded()
  }

  return (
    <div className="min-w-0 overflow-hidden" data-testid="recent-session-list">
      {sessionCount > 0
        ? children
        : null}
      {hiddenSessionCount > 0
        ? (
            <button
              type="button"
              onClick={toggleExpanded}
              className="mt-0.5 flex h-6 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-left text-[11px] text-muted-foreground hover:bg-accent/50 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-expanded={expanded}
              data-testid="recent-sessions-toggle"
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
  )
}
