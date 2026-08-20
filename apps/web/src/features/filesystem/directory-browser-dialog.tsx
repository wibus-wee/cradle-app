import {
  ArrowUpLine as ArrowUpIcon,
  CodeLine as CodeIcon,
  DownloadLine as DownloadIcon,
  FileLine as FileIcon,
  FileLine as FileTextIcon,
  FolderLine as FolderIcon,
  Home2Line as HomeIcon,
  MonitorLine as MonitorIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { getFilesystemBrowse, getFilesystemFavorites } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Spinner } from '~/components/ui/spinner'
import { fetchNodeUpstreamJson } from '~/features/nodes/upstream-fetch'
import { cn } from '~/lib/cn'

const LAST_PATH_KEY = 'directory-browser-last-path'

const FilesystemFavoriteEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  icon: z.string(),
})

const FilesystemFavoriteEntryListSchema = z.array(FilesystemFavoriteEntrySchema)

const FilesystemBrowseEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'directory']),
})

const FilesystemBrowseResultSchema = z.object({
  current: z.string(),
  parent: z.string().nullable().default(null),
  entries: z.array(FilesystemBrowseEntrySchema),
})

type FilesystemFavoriteEntry = z.infer<typeof FilesystemFavoriteEntrySchema>
type FilesystemBrowseEntry = z.infer<typeof FilesystemBrowseEntrySchema>
type FilesystemBrowseResult = z.infer<typeof FilesystemBrowseResultSchema>

interface DirectoryBrowserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (path: string) => void
  title?: string
  description?: string
  /**
   * When set, browse the connected remote Cradle Server filesystem via
   * `/nodes/:nodeId/upstream/filesystem/*` instead of the local server.
   */
  nodeId?: string | null
}

function lastPathStorageKey(nodeId: string | null | undefined): string {
  return nodeId ? `${LAST_PATH_KEY}:remote:${nodeId}` : LAST_PATH_KEY
}

async function browseFilesystem(
  nodeId: string | null | undefined,
  path: string | undefined,
): Promise<FilesystemBrowseResult> {
  if (nodeId) {
    const query = path ? `?path=${encodeURIComponent(path)}` : ''
    const data = await fetchNodeUpstreamJson<unknown>(nodeId, `/filesystem/browse${query}`)
    return FilesystemBrowseResultSchema.parse(data)
  }
  const result = await getFilesystemBrowse({
    query: path ? { path } : {},
  })
  return FilesystemBrowseResultSchema.parse(result.data)
}

async function listFilesystemFavorites(
  nodeId: string | null | undefined,
): Promise<FilesystemFavoriteEntry[]> {
  if (nodeId) {
    const data = await fetchNodeUpstreamJson<unknown>(nodeId, '/filesystem/favorites')
    return FilesystemFavoriteEntryListSchema.parse(data)
  }
  const result = await getFilesystemFavorites()
  return FilesystemFavoriteEntryListSchema.parse(result.data)
}

export function DirectoryBrowserDialog({
  open,
  onOpenChange,
  onSelect,
  title,
  description,
  nodeId = null,
}: DirectoryBrowserDialogProps) {
  const { t } = useTranslation('filesystem')
  const resolvedTitle = title ?? t('directory.title')
  const pathKey = lastPathStorageKey(nodeId)
  const [currentPath, setCurrentPath] = useState<string | undefined>(() => {
    return localStorage.getItem(pathKey) ?? undefined
  })
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null)
  const hostKey = nodeId ?? 'local'
  const lastHostKeyRef = useRef(hostKey)

  // Only re-seed the path when the dialog opens for a different host, or first open.
  // Avoid resetting on every open — that forces a cold fetch and blanks the list.
  useEffect(() => {
    if (!open) {
      return
    }
    if (lastHostKeyRef.current !== hostKey) {
      lastHostKeyRef.current = hostKey
      const stored = localStorage.getItem(pathKey) ?? undefined
      setCurrentPath(stored)
    }
    setSelectedEntry(null)
  }, [hostKey, open, pathKey])

  const { data: favoritesData } = useQuery<FilesystemFavoriteEntry[]>({
    queryKey: ['filesystem-favorites', hostKey],
    queryFn: () => listFilesystemFavorites(nodeId),
    enabled: open,
    staleTime: 60_000,
  })

  const {
    data,
    isPending,
    isFetching,
    isError,
    error,
  } = useQuery<FilesystemBrowseResult>({
    queryKey: ['filesystem-browse', hostKey, currentPath ?? ''],
    queryFn: () => browseFilesystem(nodeId, currentPath),
    enabled: open,
    staleTime: 30_000,
    // Keep the previous directory visible while the next one loads — critical for
    // remote/relay latency so navigation doesn't flash a full-page spinner.
    placeholderData: keepPreviousData,
  })

  const currentDirectory = data?.current ?? null
  const showInitialSpinner = isPending && !data
  const directories = data?.entries.filter(entry => entry.type === 'directory') ?? []
  const files = data?.entries.filter(entry => entry.type === 'file') ?? []

  const navigateTo = (path: string) => {
    setCurrentPath(path)
    setSelectedEntry(null)
    localStorage.setItem(pathKey, path)
  }

  const handleConfirm = () => {
    const chosen = selectedEntry ?? currentDirectory
    if (chosen) {
      onSelect(chosen)
      onOpenChange(false)
    }
  }

  const handleListingKeyDown = (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget) {
      return
    }

    if (directories.length === 0) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedEntry(current => selectDirectoryByOffset(directories, current, 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedEntry(current => selectDirectoryByOffset(directories, current, -1))
      return
    }

    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    const target = selectedEntry ?? directories[0]?.path ?? null
    if (!target) {
      return
    }

    if (event.metaKey || event.ctrlKey) {
      onSelect(target)
      onOpenChange(false)
      return
    }

    navigateTo(target)
  }

  const handleDirectoryKeyDown = (path: string, event: React.KeyboardEvent) => {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    if (event.metaKey || event.ctrlKey) {
      onSelect(path)
      onOpenChange(false)
      return
    }

    navigateTo(path)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl h-140 flex flex-col gap-0 p-0 overflow-hidden" data-testid="directory-browser-dialog">
        <div className="flex flex-1 min-h-0">
          <nav className="w-44 shrink-0 border-r py-3 px-2 flex flex-col gap-0.5">
            <DialogTitle className="px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              {resolvedTitle}
            </DialogTitle>
            {favoritesData?.map(fav => (
              <SidebarItem
                key={fav.path}
                icon={<FavoriteIcon name={fav.icon} />}
                label={fav.name}
                active={currentDirectory === fav.path}
                onClick={() => navigateTo(fav.path)}
              />
            ))}
          </nav>

          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            <PathBar
              nodeId={nodeId}
              currentPath={currentDirectory ?? currentPath ?? ''}
              fetching={isFetching && !showInitialSpinner}
              onNavigate={navigateTo}
              onGoUp={data?.parent ? () => navigateTo(data.parent!) : undefined}
            />

            <ScrollArea className="flex-1 min-h-0">
              {showInitialSpinner && (
                <div className="flex items-center justify-center h-full min-h-40">
                  <Spinner className="size-4 !text-muted-foreground" />
                </div>
              )}

              {isError && !data && (
                <div className="flex flex-col items-center justify-center h-full min-h-40 gap-1 px-6">
                  <p className="text-xs font-medium text-destructive">{t('directory.error')}</p>
                  <p className="text-[11px] text-muted-foreground text-center">
                    {(error as Error).message}
                  </p>
                </div>
              )}

              {!showInitialSpinner && data && directories.length === 0 && files.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full min-h-40 gap-1">
                  <p className="text-xs text-muted-foreground">{t('directory.empty')}</p>
                </div>
              )}

              {!showInitialSpinner && data && (directories.length > 0 || files.length > 0) && (
                <section
                  className={cn(
                    'py-0.5 outline-none',
                    isFetching && 'opacity-60',
                  )}
                  tabIndex={0}
                  aria-busy={isFetching}
                  aria-label={t('directory.listing')}
                  onKeyDown={handleListingKeyDown}
                  data-testid="directory-browser-listing"
                >
                  {directories.map(entry => (
                    <DirectoryRow
                      key={entry.path}
                      name={entry.name}
                      path={entry.path}
                      isSelected={selectedEntry === entry.path}
                      onSelect={() => setSelectedEntry(entry.path)}
                      onOpen={() => navigateTo(entry.path)}
                      onKeyDown={event => handleDirectoryKeyDown(entry.path, event)}
                    />
                  ))}
                  {files.map(entry => (
                    <FileRow key={entry.path} name={entry.name} />
                  ))}
                </section>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter variant="bare" className="px-3 py-2 border-t gap-2 justify-between">
          <div>
            {description && (
              <DialogDescription className="px-2 text-[11px] leading-snug text-muted-foreground">
                {description}
              </DialogDescription>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => onOpenChange(false)}
            >
              {t('action.cancel')}
            </Button>
            <Button
              size="sm"
              className="text-xs"
              onClick={handleConfirm}
              disabled={!currentDirectory && !selectedEntry}
              data-testid="directory-browser-confirm"
            >
              {t('action.select')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PathBar({
  nodeId,
  currentPath,
  fetching,
  onNavigate,
  onGoUp,
}: {
  nodeId: string | null | undefined
  currentPath: string
  fetching: boolean
  onNavigate: (path: string) => void
  onGoUp?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [debouncedEditValue, setDebouncedEditValue] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) {
      return
    }
    const timer = window.setTimeout(setDebouncedEditValue, 120, editValue)
    return () => window.clearTimeout(timer)
  }, [editValue, editing])

  const lastSlash = debouncedEditValue.lastIndexOf('/')
  const parentDir = lastSlash >= 0 ? debouncedEditValue.slice(0, lastSlash) || '/' : undefined
  const prefix = lastSlash >= 0 ? debouncedEditValue.slice(lastSlash + 1).toLowerCase() : ''

  const { data: suggestionsData } = useQuery<FilesystemBrowseResult>({
    queryKey: ['filesystem-browse', nodeId ?? 'local', parentDir ?? ''],
    queryFn: () => browseFilesystem(nodeId, parentDir),
    enabled: editing && !!parentDir,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })

  const suggestions = (suggestionsData?.entries ?? [])
    .filter(entry => entry.type === 'directory' && entry.name.toLowerCase().startsWith(prefix))
    .slice(0, 8)

  const segments = currentPath.split('/').filter(Boolean)

  useEffect(() => {
    if (!editing) {
      return
    }
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [editing])

  const startEditing = () => {
    setEditValue(currentPath)
    setDebouncedEditValue(currentPath)
    setEditing(true)
    setShowSuggestions(true)
    setSelectedSuggestion(-1)
  }

  const commitEdit = () => {
    setEditing(false)
    setShowSuggestions(false)
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== currentPath) {
      onNavigate(trimmed)
    }
  }

  const cancelEdit = () => {
    setEditing(false)
    setShowSuggestions(false)
  }

  const applySuggestion = (path: string) => {
    setEditValue(path)
    setShowSuggestions(false)
    onNavigate(path)
    setEditing(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
        applySuggestion(suggestions[selectedSuggestion].path)
      }
      else {
        commitEdit()
      }
    }
    else if (event.key === 'Escape') {
      cancelEdit()
    }
    else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedSuggestion(index => Math.min(index + 1, suggestions.length - 1))
    }
    else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedSuggestion(index => Math.max(index - 1, -1))
    }
    else if (event.key === 'Tab' && suggestions.length > 0) {
      event.preventDefault()
      const idx = selectedSuggestion >= 0 ? selectedSuggestion : 0
      if (suggestions[idx]) {
        setEditValue(`${suggestions[idx].path}/`)
        setSelectedSuggestion(-1)
      }
    }
  }

  if (editing) {
    return (
      <div className="relative">
        <div className="flex items-center h-8 px-3 border-b bg-muted/30">
          <input
            ref={inputRef}
            value={editValue}
            aria-label="Directory path"
            onChange={(event) => {
              setEditValue(event.target.value)
              setShowSuggestions(true)
              setSelectedSuggestion(-1)
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Delay so suggestion mousedown can commit before blur closes.
              window.setTimeout(() => {
                setEditing(false)
                setShowSuggestions(false)
              }, 150)
            }}
            className="w-full h-full text-xs font-mono bg-transparent outline-none"
            data-testid="directory-browser-path-input"
          />
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-8 z-50 border-b bg-popover shadow-md max-h-48 overflow-y-auto">
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.path}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  applySuggestion(suggestion.path)
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-xs',
                  'hover:bg-accent',
                  index === selectedSuggestion && 'bg-accent',
                )}
              >
                <FolderIcon className="size-3 !text-muted-foreground shrink-0" />
                <span className="truncate font-mono">{suggestion.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="flex items-center h-8 px-3 border-b text-xs gap-1 overflow-x-auto cursor-text select-none"
      onDoubleClick={startEditing}
      data-testid="directory-browser-breadcrumb"
    >
      {onGoUp && (
        <button
          type="button"
          onClick={onGoUp}
          className="shrink-0 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <ArrowUpIcon className="size-3" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="shrink-0 text-muted-foreground hover:text-foreground font-mono"
      >
        /
      </button>
      {segments.map((seg, index) => {
        const segPath = `/${segments.slice(0, index + 1).join('/')}`
        const isLast = index === segments.length - 1
        return (
          <span key={segPath} className="flex items-center gap-1 shrink-0">
            <ChevronRightIcon className="size-2.5 !text-muted-foreground/40" />
            {isLast
              ? <span className="font-medium text-foreground">{seg}</span>
              : (
                  <button
                    type="button"
                    onClick={() => onNavigate(segPath)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {seg}
                  </button>
                )}
          </span>
        )
      })}
      {fetching && (
        <Spinner className="ml-auto size-3 shrink-0 !text-muted-foreground/70" />
      )}
    </div>
  )
}

const ICON_MAP: Record<string, React.ReactNode> = {
  'home': <HomeIcon className="size-3.5" />,
  'monitor': <MonitorIcon className="size-3.5" />,
  'file-text': <FileTextIcon className="size-3.5" />,
  'download': <DownloadIcon className="size-3.5" />,
  'code': <CodeIcon className="size-3.5" />,
}

function FavoriteIcon({ name }: { name: string }) {
  return <>{ICON_MAP[name] ?? <FolderIcon className="size-3.5" />}</>
}

function SidebarItem({
  icon,
  label,
  onClick,
  active,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs',
        'hover:bg-accent',
        active && 'bg-accent font-medium',
      )}
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

function DirectoryRow({
  name,
  path,
  isSelected,
  onSelect,
  onOpen,
  onKeyDown,
}: {
  name: string
  path: string
  isSelected: boolean
  onSelect: () => void
  onOpen: () => void
  onKeyDown: (event: React.KeyboardEvent) => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={onKeyDown}
      aria-pressed={isSelected}
      data-testid={`directory-entry-${name}`}
      data-path={path}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs',
        'hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none',
        isSelected && 'bg-accent',
      )}
    >
      <FolderIcon className="size-3.5 shrink-0 !text-muted-foreground" />
      <span className="truncate flex-1">{name}</span>
      <ChevronRightIcon className="size-3 shrink-0 !text-muted-foreground/30" />
    </button>
  )
}

export function selectDirectoryByOffset(
  directories: FilesystemBrowseEntry[],
  selectedPath: string | null,
  offset: 1 | -1,
): string | null {
  if (directories.length === 0) {
    return null
  }

  const currentIndex = directories.findIndex(entry => entry.path === selectedPath)
  const nextIndex = currentIndex === -1
    ? offset > 0 ? 0 : directories.length - 1
    : Math.min(Math.max(currentIndex + offset, 0), directories.length - 1)

  return directories[nextIndex]?.path ?? null
}

function FileRow({ name }: { name: string }) {
  return (
    <div className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs opacity-40 cursor-default select-none">
      <FileIcon className="size-3.5 shrink-0" />
      <span className="truncate flex-1">{name}</span>
    </div>
  )
}
