import { prepareFileTreeInput } from '@pierre/trees'
import { FileTree as PierreFileTree, useFileTree } from '@pierre/trees/react'
import {
  CheckLine as CheckIcon,
  PlaylistLine as ListIcon,
  TreeLine as ListTreeIcon
} from '@mingcute/react'
import { useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'

import type { ReviewFile } from '../shared/types'

interface FileListAsideProps {
  visibleFiles: ReviewFile[]
  selectedFileId: string | null
  onSelectFile: (file: ReviewFile) => void
  onToggleViewed: (file: ReviewFile) => void
  viewedPending: boolean
  hiddenWhitespaceFileCount: number
  hiddenGeneratedFileCount: number
  width: number
}

type ListMode = 'flat' | 'tree'

const STATUS_ORDER: ReviewFile['status'][] = ['modified', 'added', 'deleted', 'renamed', 'untracked']
const STATUS_LETTER: Record<ReviewFile['status'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
}
const STATUS_COLOR: Record<ReviewFile['status'], string> = {
  modified: 'text-amber-600 dark:text-amber-400',
  added: 'text-emerald-600 dark:text-emerald-400',
  deleted: 'text-red-600 dark:text-red-400',
  renamed: 'text-sky-600 dark:text-sky-400',
  untracked: 'text-violet-600 dark:text-violet-400',
}

export function FileListAside({
  visibleFiles,
  selectedFileId,
  onSelectFile,
  onToggleViewed,
  viewedPending,
  hiddenWhitespaceFileCount,
  hiddenGeneratedFileCount,
  width,
}: FileListAsideProps) {
  const [mode, setMode] = useState<ListMode>('flat')

  const grouped = useMemo(() => {
    const map = new Map<ReviewFile['status'], ReviewFile[]>()
    for (const file of visibleFiles) {
      const list = map.get(file.status) ?? []
      list.push(file)
      map.set(file.status, list)
    }
    return STATUS_ORDER
      .filter(status => map.has(status))
      .map(status => ({ status, files: map.get(status)! }))
  }, [visibleFiles])

  return (
    <aside
      className="hidden shrink-0 flex-col border-r border-border/60 bg-background lg:flex"
      style={{ width }}
      data-testid="file-list-aside"
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-3">
        <span className="text-[12px] font-medium text-foreground/70">Files</span>
        <span className="text-[11px] tabular-nums text-muted-foreground/60">{visibleFiles.length}</span>
        <div className="flex-1" />
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value === 'flat' || value === 'tree') {
              setMode(value)
            }
          }}
          variant="outline"
          size="sm"
          className="h-5 gap-px"
          aria-label="File list mode"
        >
          <ToggleGroupItem value="flat" aria-label="Flat list" className="size-5 p-0">
            <ListIcon className="size-3" />
          </ToggleGroupItem>
          <ToggleGroupItem value="tree" aria-label="Directory tree" className="size-5 p-0">
            <ListTreeIcon className="size-3" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {mode === 'tree'
          ? <TreeMode files={visibleFiles} selectedFileId={selectedFileId} onSelectFile={onSelectFile} />
          : (
              <div className="space-y-2">
                {grouped.map(group => (
                  <section key={group.status}>
                    <h2 className="flex items-center gap-1.5 px-3 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/50">
                      <span className={cn('font-mono', STATUS_COLOR[group.status])}>
                        {STATUS_LETTER[group.status]}
                      </span>
                      <span>{group.files.length}</span>
                    </h2>
                    <div>
                      {group.files.map(file => (
                        <FileRow
                          key={file.id}
                          file={file}
                          selected={file.id === selectedFileId}
                          onSelect={() => onSelectFile(file)}
                          onToggleViewed={() => onToggleViewed(file)}
                          viewedPending={viewedPending}
                        />
                      ))}
                    </div>
                  </section>
                ))}

                {(hiddenWhitespaceFileCount > 0 || hiddenGeneratedFileCount > 0) && (
                  <p className="px-3 pt-1 text-[11px] leading-relaxed text-muted-foreground/50">
                    {hiddenWhitespaceFileCount > 0 && `${hiddenWhitespaceFileCount} whitespace-only hidden`}
                    {hiddenWhitespaceFileCount > 0 && hiddenGeneratedFileCount > 0 && ' · '}
                    {hiddenGeneratedFileCount > 0 && `${hiddenGeneratedFileCount} generated hidden`}
                  </p>
                )}
              </div>
            )}
      </div>
    </aside>
  )
}

function FileRow({
  file,
  selected,
  onSelect,
  onToggleViewed,
  viewedPending,
}: {
  file: ReviewFile
  selected: boolean
  onSelect: () => void
  onToggleViewed: () => void
  viewedPending: boolean
}) {
  const fileName = file.path.split('/').pop() ?? file.path
  const dir = file.path.slice(0, file.path.length - fileName.length)

  return (
    <div
      className={cn(
        'group relative flex h-7 items-center gap-2 pl-3 pr-2 transition-colors',
        selected ? 'bg-muted' : 'hover:bg-muted/50',
      )}
    >
      {/* Selected indicator — a 2px bar on the left edge, Linear-style. */}
      <span
        className={cn(
          'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full transition-opacity',
          selected ? 'bg-foreground opacity-100' : 'opacity-0',
        )}
        aria-hidden
      />

      <Button
        type="button"
        variant="ghost"
        onClick={onSelect}
        className="h-auto min-w-0 !shrink flex-1 justify-start gap-2 rounded-none px-0 py-0 text-left font-normal hover:bg-transparent"
      >
        <span className={cn('shrink-0 font-mono text-[11px] font-semibold', STATUS_COLOR[file.status])}>
          {STATUS_LETTER[file.status]}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px]">
          <span className={file.isViewed ? 'text-muted-foreground/60 line-through' : 'text-foreground/90'}>
            {fileName}
          </span>
          {dir && <span className="ml-1.5 text-[11px] text-muted-foreground/40">{dir}</span>}
        </span>
      </Button>

      <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground/50">
        <span className="text-emerald-600/80 dark:text-emerald-400/80">
+
{file.additions}
        </span>
        <span className="text-red-600/80 dark:text-red-400/80">
−
{file.deletions}
        </span>
      </span>

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onToggleViewed}
        disabled={viewedPending}
        className={cn(
          'size-4 shrink-0 rounded-full border',
          file.isViewed
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-border text-transparent opacity-0 hover:border-muted-foreground group-hover:opacity-100',
        )}
        aria-label={file.isViewed ? 'Mark unviewed' : 'Mark viewed'}
        title={file.isViewed ? 'Mark unviewed' : 'Mark viewed'}
      >
        <CheckIcon className="size-2.5" />
      </Button>
    </div>
  )
}

function TreeMode({
  files,
  selectedFileId,
  onSelectFile,
}: {
  files: ReviewFile[]
  selectedFileId: string | null
  onSelectFile: (file: ReviewFile) => void
}) {
  const paths = useMemo(() => files.map(file => file.path), [files])
  const fileByPath = useMemo(() => new Map(files.map(file => [file.path, file])), [files])
  const gitStatus = useMemo(
    () => files.map(file => ({ path: file.path, status: file.status })),
    [files],
  )
  const preparedInput = useMemo(() => prepareFileTreeInput(paths, { flattenEmptyDirectories: true }), [paths])

  const { model } = useFileTree({
    preparedInput,
    density: 'compact',
    gitStatus,
    icons: { set: 'complete', colored: true },
    initialExpansion: 'open',
    onSelectionChange: (selectedPaths) => {
      const path = selectedPaths[0]
      if (!path) {
        return
      }
      const file = fileByPath.get(path)
      if (file) {
        onSelectFile(file)
      }
    },
  })

  void selectedFileId

  return <PierreFileTree model={model} className="h-full" />
}
