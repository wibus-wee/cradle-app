import {
  DownLine as DownloadIcon,
  FolderLine as FolderClosedIcon,
  GitBranchLine,
  RightLine as ChevronRightIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import type { RepoWorkspaceShadow } from '~/features/workspace/workspace-repo-clusters'
import { cn } from '~/lib/cn'

export interface WorkspaceRepoClusterViewProps {
  name: string
  replicaCount: number
  expanded: boolean
  shadows: RepoWorkspaceShadow[]
  /** Shadow key currently being mounted, for pending state. */
  mountingKey: string | null
  onToggleExpanded: () => void
  onMountShadow: (shadow: RepoWorkspaceShadow) => void
  children: ReactNode
}

function shadowKey(shadow: RepoWorkspaceShadow): string {
  return `${shadow.nodeId}:${shadow.path}`
}

/**
 * Presentational repo cluster for the workspace sidebar: one collapsible
 * header for a repository with several machine replicas, the replica groups as
 * children, and unmounted remote copies as shadow rows with a mount action.
 */
export function WorkspaceRepoClusterView({
  name,
  replicaCount,
  expanded,
  shadows,
  mountingKey,
  onToggleExpanded,
  onMountShadow,
  children,
}: WorkspaceRepoClusterViewProps) {
  const { t } = useTranslation('workspace')

  return (
    <div className="flex min-w-0 flex-col" data-testid={`workspace-repo-cluster-${name}`}>
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-label={t('workspace.repoCluster.aria.toggleExpanded', { name })}
        className="-ml-1 group flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        data-testid="workspace-repo-cluster-toggle"
      >
        <ChevronRightIcon
          className={cn(
            'size-3 shrink-0 text-muted-foreground/70 transition-transform',
            expanded && 'rotate-90',
          )}
          aria-hidden="true"
        />
        <GitBranchLine className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-xs font-medium text-sidebar-foreground">
          {name}
        </span>
        <span
          className="flex shrink-0 items-center rounded-full bg-fill/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums"
          aria-label={t('workspace.repoCluster.aria.replicaCount', { count: replicaCount })}
          data-testid="workspace-repo-cluster-count"
        >
          {replicaCount}
        </span>
      </button>

      {expanded
        ? (
            <>
              {children}
              {shadows.map(shadow => (
                <div
                  key={shadowKey(shadow)}
                  className="group flex min-w-0 items-center gap-2 rounded-lg py-1 pl-[26px] pr-1.5 opacity-70 hover:opacity-100"
                  data-testid={`workspace-repo-shadow-${shadow.nodeId}`}
                >
                  <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  <span className="truncate text-xs text-muted-foreground">
                    {shadow.nodeName}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground/70">
                    {shadow.path}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      'ml-auto shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                      mountingKey === shadowKey(shadow) && 'animate-pulse opacity-100',
                    )}
                    disabled={mountingKey === shadowKey(shadow)}
                    onClick={() => onMountShadow(shadow)}
                    aria-label={t('workspace.repoCluster.mount')}
                    data-testid={`workspace-repo-shadow-mount-${shadow.nodeId}`}
                  >
                    <DownloadIcon />
                  </Button>
                </div>
              ))}
            </>
          )
        : null}
    </div>
  )
}
