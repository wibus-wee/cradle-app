import { GitCompareLine as BranchIcon } from '@mingcute/react'

import { cn } from '~/lib/cn'

import type { Workspace } from './types'

export interface RemoteWorkspaceCardViewProps {
  workspace: Workspace
  selected: boolean
  onSelect: () => void
}

export function RemoteWorkspaceCardView({
  workspace,
  selected,
  onSelect,
}: RemoteWorkspaceCardViewProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full min-w-0 flex-col gap-1 border-b border-border/40 px-2.5 py-2 text-left last:border-b-0 hover:bg-muted/40',
        selected && 'bg-muted/50',
      )}
    >
      <span className="w-full truncate text-[11.5px] font-medium text-foreground/85">
        {workspace.name}
      </span>
      <span className="w-full truncate font-mono text-[10.5px] text-muted-foreground/70">
        {workspace.locator.path}
      </span>
      {workspace.gitIdentity.branch
        ? (
            <span className="inline-flex max-w-full items-center gap-1 text-[10.5px] text-muted-foreground">
              <BranchIcon className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{workspace.gitIdentity.branch}</span>
            </span>
          )
        : null}
    </button>
  )
}
