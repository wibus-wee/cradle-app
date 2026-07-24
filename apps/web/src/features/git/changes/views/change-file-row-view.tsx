import { WorkspaceFileIcon } from '~/components/common/workspace-file-icon'
import { cn } from '~/lib/cn'

import type { GitFileStatus } from '../../shared/types'

function getFileDisplay(path: string): { directory: string | null, name: string } {
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash < 0) {
    return { directory: null, name: path }
  }

  return {
    directory: path.slice(0, lastSlash),
    name: path.slice(lastSlash + 1),
  }
}

function getStatusLabel(status: GitFileStatus['status']): string {
  switch (status) {
    case 'added':
      return 'A'
    case 'modified':
      return 'M'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'untracked':
      return 'U'
  }
}

export interface ChangeFileRowViewProps {
  file: GitFileStatus
  onClick: (path: string) => void
}

export function ChangeFileRowView({
  file,
  onClick,
}: ChangeFileRowViewProps) {
  const display = getFileDisplay(file.path)

  return (
    <button
      type="button"
      className="flex h-7 min-w-0 w-full items-center gap-2 border-b border-border/25 px-2 text-left text-xs last:border-b-0 hover:bg-accent/35"
      title={file.workspacePath}
      data-testid="changes-file-row"
      data-path={file.path}
      data-workspace-path={file.workspacePath}
      data-status={file.status}
      onClick={() => onClick(file.path)}
    >
      <WorkspaceFileIcon path={file.path} />
      <span className="shrink-0 truncate text-foreground/85">{display.name}</span>
      <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/45">
        {display.directory}
      </span>
      <span
        className={cn(
          'flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm px-1 text-[9px] font-semibold uppercase tabular-nums',
          {
            'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400': file.status === 'added',
            'bg-sky-500/10 text-sky-600 dark:text-sky-400': file.status === 'modified',
            'bg-red-500/10 text-red-600 dark:text-red-400': file.status === 'deleted',
            'bg-violet-500/10 text-violet-600 dark:text-violet-400': file.status === 'renamed',
            'bg-amber-500/10 text-amber-600 dark:text-amber-400': file.status === 'untracked',
          },
        )}
      >
        {getStatusLabel(file.status)}
      </span>
    </button>
  )
}
