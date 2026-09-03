import {
  CheckLine as CheckIcon,
  CloseLine as XIcon,
  SearchLine as SearchIcon,
} from '@mingcute/react'
import { useMemo, useState } from 'react'

import { cn } from '~/lib/cn'

import type { ReviewFile } from '../shared/types'
import { ChangeBar } from './review-primitives'

/**
 * Status letter, GitHub-legible but toned down: the letter carries the meaning,
 * the color only reinforces it, so a colorblind reader loses nothing.
 */
const STATUS_LETTER: Record<ReviewFile['status'], string> = {
  added: 'A',
  untracked: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
}

const STATUS_COLOR: Record<ReviewFile['status'], string> = {
  added: 'text-[var(--rv-add)]',
  untracked: 'text-[var(--rv-add)]',
  modified: 'text-[var(--rv-warn)]',
  deleted: 'text-[var(--rv-del)]',
  renamed: 'text-[var(--rv-accent)]',
}

interface DirectoryGroup {
  directory: string
  files: ReviewFile[]
}

/**
 * Group by directory and collapse the common prefix every file shares, so a
 * monorepo diff doesn't spend the rail's width repeating `apps/web/src/...`.
 */
function groupByDirectory(files: ReviewFile[]): { groups: DirectoryGroup[], trimmedPrefix: string } {
  if (files.length === 0) {
    return { groups: [], trimmedPrefix: '' }
  }

  const directories = files.map((file) => {
    const index = file.path.lastIndexOf('/')
    return index === -1 ? '' : file.path.slice(0, index)
  })

  let prefix = directories[0] ?? ''
  for (const directory of directories) {
    while (prefix.length > 0 && !`${directory}/`.startsWith(`${prefix}/`)) {
      const index = prefix.lastIndexOf('/')
      prefix = index === -1 ? '' : prefix.slice(0, index)
    }
  }
  // A single-file diff would otherwise trim its whole directory away.
  if (files.length === 1) {
    prefix = ''
  }

  const byDirectory = new Map<string, ReviewFile[]>()
  files.forEach((file, index) => {
    const full = directories[index] ?? ''
    const relative = prefix && full === prefix
      ? '.'
      : prefix
        ? full.slice(prefix.length + 1)
        : full
    const key = relative || '.'
    const list = byDirectory.get(key) ?? []
    list.push(file)
    byDirectory.set(key, list)
  })

  return {
    groups: Array.from(byDirectory.entries(), ([directory, groupFiles]) => ({ directory, files: groupFiles })),
    trimmedPrefix: prefix,
  }
}

function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

export interface ReviewFileRailProps {
  files: ReviewFile[]
  selectedFileId: string | null
  onSelectFile: (file: ReviewFile) => void
  onToggleViewed: (file: ReviewFile) => void
  hiddenFileCount?: number
  width?: number
}

/**
 * The file index for a review. Reads as a document outline rather than a file
 * explorer: no chevrons, no folder icons, no indent guides — just grouped paths
 * with their change weight, because during review you are choosing *what to read
 * next*, not browsing a tree.
 */
export function ReviewFileRail({
  files,
  selectedFileId,
  onSelectFile,
  onToggleViewed,
  hiddenFileCount = 0,
  width,
}: ReviewFileRailProps) {
  const [query, setQuery] = useState('')

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return files
    }
    return files.filter(file => file.path.toLowerCase().includes(needle))
  }, [files, query])

  const { groups, trimmedPrefix } = useMemo(() => groupByDirectory(matched), [matched])

  const viewedCount = files.filter(file => file.isViewed).length
  const totals = files.reduce(
    (accumulator, file) => ({
      additions: accumulator.additions + file.additions,
      deletions: accumulator.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  )

  return (
    <aside
      className="flex min-h-0 shrink-0 flex-col border-r border-[var(--rv-line)] bg-[var(--rv-bg-subtle)]"
      style={{ width }}
      aria-label="Changed files"
      data-testid="review-file-list"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--rv-line)] px-3">
        <SearchIcon className="size-3.5 shrink-0 text-[var(--rv-fg-subtle)]" aria-hidden />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.stopPropagation()
              setQuery('')
            }
          }}
          placeholder="Filter files"
          aria-label="Filter files"
          className={cn(
            'min-w-0 flex-1 bg-transparent text-[12px] text-[var(--rv-fg)]',
            'placeholder:text-[var(--rv-fg-subtle)] focus:outline-none',
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            title="Clear file filter"
            aria-label="Clear file filter"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-[var(--rv-fg-subtle)] transition-colors hover:bg-[var(--rv-bg-hover)] hover:text-[var(--rv-fg)]"
          >
            <XIcon className="size-3" aria-hidden />
          </button>
        )}
        <span data-rv-num className="shrink-0 text-[11px] text-[var(--rv-fg-subtle)]">
          {matched.length}
        </span>
      </div>

      {trimmedPrefix && (
        <div
          className="shrink-0 truncate px-3 py-1.5 font-[var(--rv-font-mono)] text-[10.5px] text-[var(--rv-fg-subtle)]"
          title={trimmedPrefix}
        >
          {trimmedPrefix}
          /
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {groups.map(group => (
          <section key={group.directory}>
            {group.directory !== '.' && (
              <h3
                className={cn(
                  'sticky top-0 z-10 truncate bg-[var(--rv-bg-subtle)] px-3 pb-1 pt-2.5',
                  'font-[var(--rv-font-mono)] text-[10.5px] text-[var(--rv-fg-subtle)]',
                )}
                title={group.directory}
              >
                {group.directory}
              </h3>
            )}
            <ul role="list">
              {group.files.map((file) => {
                const selected = file.id === selectedFileId
                return (
                  <li key={file.id}>
                    <div
                      className={cn(
                        'group/file relative flex h-[26px] items-center gap-2 pl-3 pr-2',
                        'transition-colors duration-100',
                        selected ? 'bg-[var(--rv-bg-active)]' : 'hover:bg-[var(--rv-bg-hover)]',
                      )}
                    >
                      {selected && (
                        <span
                          aria-hidden
                          className="absolute inset-y-[3px] left-0 w-[2px] rounded-r-full bg-[var(--rv-accent)]"
                        />
                      )}
                      <span
                        aria-label={file.status}
                        className={cn(
                          'w-[9px] shrink-0 text-center font-[var(--rv-font-mono)] text-[10.5px] font-semibold',
                          STATUS_COLOR[file.status],
                        )}
                      >
                        {STATUS_LETTER[file.status]}
                      </span>

                      <button
                        type="button"
                        onClick={() => onSelectFile(file)}
                        title={file.path}
                        className={cn(
                          'min-w-0 flex-1 truncate text-left text-[12px] leading-none',
                          file.isViewed && !selected
                            ? 'text-[var(--rv-fg-subtle)] line-through decoration-[var(--rv-fg-subtle)]/40'
                            : selected
                              ? 'text-[var(--rv-fg)]'
                              : 'text-[var(--rv-fg-muted)] group-hover/file:text-[var(--rv-fg)]',
                        )}
                      >
                        {basename(file.path)}
                      </button>

                      {!file.isBinary && (
                        <ChangeBar
                          additions={file.additions}
                          deletions={file.deletions}
                          className="shrink-0 opacity-70 group-hover/file:opacity-0"
                        />
                      )}

                      <button
                        type="button"
                        onClick={() => onToggleViewed(file)}
                        aria-pressed={file.isViewed}
                        title={file.isViewed ? 'Mark as not viewed' : 'Mark as viewed'}
                        className={cn(
                          'absolute right-2 inline-flex size-[15px] shrink-0 items-center justify-center rounded-[3px]',
                          'border transition-colors duration-100',
                          file.isViewed
                            ? 'border-[var(--rv-accent)] bg-[var(--rv-accent)] text-[var(--rv-accent-fg)]'
                            : cn(
                                'border-[var(--rv-edge)] text-transparent opacity-0',
                                'group-hover/file:opacity-100 hover:border-[var(--rv-fg-muted)]',
                              ),
                        )}
                      >
                        <CheckIcon className="size-2.5" aria-hidden />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        {matched.length === 0 && (
          <p className="px-3 py-6 text-center text-[11.5px] text-[var(--rv-fg-subtle)]">
            {files.length === 0 ? 'No changed files' : `No file matches “${query}”`}
          </p>
        )}
      </div>

      <div
        className={cn(
          'flex h-8 shrink-0 items-center justify-between gap-2 border-t border-[var(--rv-line)] px-3',
          'text-[11px] text-[var(--rv-fg-subtle)]',
        )}
      >
        <span data-rv-num>
          {viewedCount}
          {' / '}
          {files.length}
          {' viewed'}
          {hiddenFileCount > 0 && ` · ${hiddenFileCount} hidden`}
        </span>
        <span data-rv-num className="inline-flex gap-1.5">
          <span className="text-[var(--rv-add)]">
            +
            {totals.additions}
          </span>
          <span className="text-[var(--rv-del)]">
            −
            {totals.deletions}
          </span>
        </span>
      </div>
    </aside>
  )
}
