import { FolderOpenLine } from '@mingcute/react'

import { CommandItem } from '~/components/ui/command'

import type { WorkspaceSearchHit } from './types'

export interface WorkspaceRowProps {
  data: WorkspaceSearchHit
  onSelect: (workspaceId: string) => void
}

export function WorkspaceRow({ data: workspace, onSelect }: WorkspaceRowProps) {
  return (
    <CommandItem
      value={`workspace-${workspace.id}`}
      onSelect={() => onSelect(workspace.id)}
      className="py-0.5"
      data-testid={`global-search-workspace-result-${workspace.id}`}
    >
      <FolderOpenLine className="size-4 shrink-0 text-muted-foreground/65" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate text-[13px]">{workspace.name}</span>
        {workspace.identifier
          ? (
              <span className="truncate font-mono text-[10px] uppercase text-muted-foreground/40">
                {workspace.identifier}
              </span>
            )
          : null}
      </span>
    </CommandItem>
  )
}
