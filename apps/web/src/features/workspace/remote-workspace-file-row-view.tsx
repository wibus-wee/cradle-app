import {
  FileNewLine as FileIcon,
  FolderLine as FolderIcon,
} from '@mingcute/react'

import type { WorkspaceFileEntry } from './api/files'

export interface RemoteWorkspaceFileRowViewProps {
  entry: WorkspaceFileEntry
}

export function RemoteWorkspaceFileRowView({
  entry,
}: RemoteWorkspaceFileRowViewProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0">
      {entry.type === 'directory'
        ? (
            <FolderIcon
              className="size-3.5 shrink-0 text-muted-foreground/70"
              aria-hidden="true"
            />
          )
        : (
            <FileIcon
              className="size-3.5 shrink-0 text-muted-foreground/45"
              aria-hidden="true"
            />
          )}
      <span className="min-w-0 truncate text-[11.5px] text-foreground/80">
        {entry.name}
      </span>
    </div>
  )
}
