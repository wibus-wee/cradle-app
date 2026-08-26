import {
  GitBranchLine,
  RightLine as ChevronRightIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { RepoOwnerAvatar } from '~/components/common/repo-owner-avatar'
import { cn } from '~/lib/cn'

export interface WorkspaceRepoRowViewProps {
  /** Display label, usually `owner/repo`. */
  name: string
  /** Repository owner; `null` renders a generic git icon instead of an avatar. */
  owner: string | null
  avatarUrl?: string | null
  expanded: boolean
  onToggleExpanded: () => void
  children: ReactNode
}

/**
 * Presentational merged repository row for the workspace sidebar: one
 * collapsible row per repository, aggregating every machine replica's
 * sessions underneath.
 */
export function WorkspaceRepoRowView({
  name,
  owner,
  avatarUrl,
  expanded,
  onToggleExpanded,
  children,
}: WorkspaceRepoRowViewProps) {
  const { t } = useTranslation('workspace')

  return (
    <div className="flex min-w-0 flex-col" data-testid={`workspace-repo-row-${name}`}>
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-label={t('workspace.repoRow.aria.toggleExpanded', { name })}
        className="-ml-1 group flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        data-testid="workspace-repo-row-toggle"
      >
        <ChevronRightIcon
          className={cn(
            'size-3 shrink-0 text-muted-foreground/70 transition-transform',
            expanded && 'rotate-90',
          )}
          aria-hidden="true"
        />
        {owner
          ? <RepoOwnerAvatar owner={owner} avatarUrl={avatarUrl} className="size-3.5" />
          : <GitBranchLine className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="truncate text-xs font-medium text-sidebar-foreground">
          {name}
        </span>
      </button>

      {expanded
        ? <div className="flex min-w-0 flex-col pl-2">{children}</div>
        : null}
    </div>
  )
}
