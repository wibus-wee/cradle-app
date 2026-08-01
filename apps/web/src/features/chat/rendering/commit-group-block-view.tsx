import {
  Chat1Line as AddToChatIcon,
  GitCommitLine as GitCommitIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { WorkspaceFileIcon, WorkspaceFileIconSpriteSheet } from '~/components/common/workspace-file-icon'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

export interface CommitGroupData {
  message?: string
  files?: string
  body?: string
}

export interface CommitGroupBlockViewProps extends CommitGroupData {
  /** Link elements keyed by full file path; rendered as the filename of each row. */
  fileLinks?: ReadonlyMap<string, ReactNode>
  onAddToComposer?: (group: CommitGroupData) => void
}

/** Parses the comma-separated `files` attribute into trimmed paths. */
export function parseCommitGroupFiles(files?: string): string[] {
  if (!files) {
    return []
  }
  return files
    .split(',')
    .map(path => path.trim())
    .filter(Boolean)
}

const COLLAPSED_FILE_LIMIT = 5

function splitFilePath(file: string): { directory: string | null, name: string } {
  const lastSlash = file.lastIndexOf('/')
  if (lastSlash < 0) {
    return { directory: null, name: file }
  }
  return { directory: file.slice(0, lastSlash), name: file.slice(lastSlash + 1) }
}

interface CommitGroupFileRowProps {
  file: string
  fileLinks?: ReadonlyMap<string, ReactNode>
}

/** Vercel-style flat file row: type icon, prominent name, dimmed trailing directory. */
function CommitGroupFileRow({ file, fileLinks }: CommitGroupFileRowProps) {
  const { directory, name } = splitFilePath(file)
  return (
    <div
      className={cn(
        'group flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-xs',
        'transition-colors duration-150 ease-out hover:bg-accent/40',
      )}
    >
      <WorkspaceFileIcon path={file} className="size-3.5" />
      <span className="min-w-0 shrink-0 truncate font-mono text-foreground/85">
        {fileLinks?.get(file) ?? name}
      </span>
      {directory
        ? (
            <span className="min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground/45">
              {directory}
            </span>
          )
        : null}
    </div>
  )
}

/** Fixture-driven presentation for a proposed commit group. */
export function CommitGroupBlockView({
  message,
  files,
  body,
  fileLinks,
  onAddToComposer,
}: CommitGroupBlockViewProps) {
  const filePaths = parseCommitGroupFiles(files)
  const hiddenCount = Math.max(0, filePaths.length - COLLAPSED_FILE_LIMIT)
  const [expanded, setExpanded] = useState(false)

  return (
    <section className="my-2 overflow-hidden rounded-lg border border-border/60 bg-muted/20 shadow-xs">
      <WorkspaceFileIconSpriteSheet />
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-fill text-muted-foreground">
          <GitCommitIcon className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">
          {message ?? 'Commit group'}
        </span>
        {filePaths.length > 0
          ? (
              <span className="shrink-0 rounded-full bg-fill px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                {filePaths.length}
                {' '}
                {filePaths.length === 1 ? 'file' : 'files'}
              </span>
            )
          : null}
        {onAddToComposer
          ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground transition-colors hover:text-foreground"
                title="Append a commit prompt for this group to the composer"
                onClick={() => onAddToComposer({ message, files, body })}
              >
                <AddToChatIcon className="size-3" aria-hidden="true" />
                Add to Chat
              </Button>
            )
          : null}
      </div>
      {body
        ? (
            <p className="mx-3 mb-2 whitespace-pre-wrap rounded-md bg-fill/50 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
              {body}
            </p>
          )
        : null}
      {filePaths.length > 0
        ? (
            <div className="border-t border-border/50 px-1.5 py-1.5">
              {filePaths.slice(0, COLLAPSED_FILE_LIMIT).map(file => (
                <CommitGroupFileRow key={file} file={file} fileLinks={fileLinks} />
              ))}
              {hiddenCount > 0
                ? (
                    <>
                      <div
                        className={cn(
                          'grid transition-[grid-template-rows] duration-200 ease-out',
                          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                        )}
                      >
                        <div className="overflow-hidden">
                          <div className="max-h-64 overflow-y-auto overscroll-contain">
                            {filePaths.slice(COLLAPSED_FILE_LIMIT).map(file => (
                              <CommitGroupFileRow key={file} file={file} fileLinks={fileLinks} />
                            ))}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpanded(open => !open)}
                        className={cn(
                          'flex h-7 w-full items-center gap-1.5 rounded-md px-2',
                          'text-[11px] text-muted-foreground',
                          'transition-colors duration-150 ease-out hover:bg-accent/40 hover:text-foreground',
                        )}
                      >
                        <ChevronRightIcon
                          className={cn('size-3 shrink-0 transition-transform duration-200 ease-out', expanded && 'rotate-90')}
                          aria-hidden="true"
                        />
                        {expanded ? 'Show fewer files' : `Show ${hiddenCount} more ${hiddenCount === 1 ? 'file' : 'files'}`}
                      </button>
                    </>
                  )
                : null}
            </div>
          )
        : null}
    </section>
  )
}
