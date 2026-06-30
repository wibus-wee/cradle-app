import {
  ArrowDownLine as ArrowDownIcon,
  ArrowUpLine as ArrowUpIcon,
  CornerDownLeftLine as CornerDownLeftIcon,
  DotCircleLine as CircleDotIcon,
  FileLine as FileIcon,
  FolderOpenLine as FolderOpenIcon,
  Message1Line as MessageSquareIcon,
  Plugin2Line,
  Settings2Line as SettingsIcon,
  TerminalLine as TerminalIcon,
} from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { getIssuesSearchOptions, getKanbanBoardsOptions, getSearchThreadsOptions, getSessionsByIdOptions, getWorkspacesOptions } from '~/api-gen/@tanstack/react-query.gen'
import { useLayoutSlotsCtx } from '~/components/layout/use-layout-slots'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '~/components/ui/command'
import { Kbd, KbdGroup } from '~/components/ui/kbd'
import { DelayedSpinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { getWorkspaceLocationLabel } from '~/features/workspace/types'
import { useWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { rankFuzzyItems } from '~/lib/fuzzy-rank'
import type { WebCommandRegistration } from '~/lib/plugin-store'
import { usePluginStore } from '~/lib/plugin-store'
import { useActiveSurface } from '~/navigation/active-surface'
import { openChatSession, openKanbanBoard, openNewChat, openSettingsSection, openUsage, openWorkspaceDetail } from '~/navigation/navigation-commands'
import { chatSessionIdForSurface, workspaceIdForSurface } from '~/navigation/surface-identity'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import { selectFileSearchResult } from './global-search-actions'
import { HighlightedText } from './highlighted-text'

interface GlobalSearchDialogProps {
  open: boolean
  initialQuery?: string
  onOpenChange: (open: boolean) => void
}

type PaletteModeId = 'command' | 'quickOpen' | 'files' | 'issues' | 'threads'
type FileSearchAvailability = 'available' | 'unsupported-tab' | 'missing-workspace'

const COMMAND_HISTORY_KEY = 'cradle.commandPalette.recentCommands'
const COMMAND_HISTORY_LIMIT = 12

const PLACEHOLDER_KEY = {
  command: 'mode.command.placeholder',
  quickOpen: 'mode.quickOpen.placeholder',
  files: 'mode.files.placeholder',
  issues: 'mode.issues.placeholder',
  threads: 'mode.threads.placeholder',
} as const satisfies Record<PaletteModeId, string>

const SCOPE_PREFIXES = [
  { prefix: '/', labelKey: 'group.files' },
  { prefix: '#', labelKey: 'group.issues' },
  { prefix: '@', labelKey: 'group.threads' },
  { prefix: '>', labelKey: 'group.commands' },
] as const

const SessionWorkspaceSchema = z
  .object({
    workspaceId: z.string().nullable(),
  })
  .passthrough()

interface CommandAction {
  id: string
  label: string
  description?: string
  keywords: string
  icon: ComponentType<{ className?: string }>
  shortcut?: string
  source: 'app' | 'plugin'
  handler: () => void | Promise<void>
}

function parsePaletteInput(input: string): { id: PaletteModeId, query: string } {
  if (input.startsWith('>')) {
    return { id: 'command', query: input.slice(1).trimStart() }
  }
  if (input.startsWith('/')) {
    return { id: 'files', query: input.slice(1).trimStart() }
  }
  if (input.startsWith('#')) {
    return { id: 'issues', query: input.slice(1).trimStart() }
  }
  if (input.startsWith('@')) {
    return { id: 'threads', query: input.slice(1).trimStart() }
  }
  return { id: 'quickOpen', query: input.trim() }
}

function readCommandHistory(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMMAND_HISTORY_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  }
  catch {
    return []
  }
}

function writeCommandHistory(commandId: string): string[] {
  const nextHistory = [commandId, ...readCommandHistory().filter(id => id !== commandId)].slice(0, COMMAND_HISTORY_LIMIT)
  try {
    window.localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(nextHistory))
  }
  catch {
    return nextHistory
  }
  return nextHistory
}

function normalizeCommandKeywords(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.join(' ')
  }
  return value ?? ''
}

function getPluginCommandIcon(command: WebCommandRegistration): ComponentType<{ className?: string }> {
  return typeof command.icon === 'function' ? command.icon : Plugin2Line
}

function useActiveFileSearchWorkspaceId(enabled: boolean): {
  availability: FileSearchAvailability
  workspaceId: string | null
} {
  const { slots } = useLayoutSlotsCtx()
  const activeSurface = useActiveSurface()
  const chatSessionId = enabled ? chatSessionIdForSurface(activeSurface) : null

  const { data: chatSession } = useQuery({
    ...getSessionsByIdOptions({ path: { id: chatSessionId ?? '' } }),
    enabled: enabled && !!chatSessionId,
    staleTime: 60_000,
    select: data => (data ? SessionWorkspaceSchema.parse(data) : undefined),
  })

  if (!enabled) {
    return { availability: 'unsupported-tab', workspaceId: null }
  }

  const canSearchFiles = activeSurface?.kind === 'new-chat'
    || activeSurface?.kind === 'chat'
    || activeSurface?.kind === 'workspace'

  if (!canSearchFiles) {
    return { availability: 'unsupported-tab', workspaceId: null }
  }

  const workspaceId = activeSurface?.kind === 'workspace'
    ? workspaceIdForSurface(activeSurface)
    : activeSurface?.kind === 'chat'
      ? chatSession?.workspaceId ?? null
      : slots.asideWorkspaceId ?? null

  return {
    availability: workspaceId ? 'available' : 'missing-workspace',
    workspaceId,
  }
}

interface GlobalSearchFile {
  type: 'file' | 'directory'
  name: string
  path: string
}

const GlobalSearchFileListSchema = z
  .array(
    z.object({
      type: z.enum(['file', 'directory']),
      name: z.string(),
      path: z.string(),
    }),
  )
  .default([])

function useCommands(close: () => void): CommandAction[] {
  const { t } = useTranslation('search')
  const setSettingsSection = useSettingsOverlayStore(s => s.setSettingsSection)
  const toggleSidebar = useLayoutStore(s => s.toggleSidebar)
  const pluginCommands = usePluginStore(s => s.commands)

  const appCommands: CommandAction[] = [
    {
      id: 'new-chat',
      label: t('command.newChat.label'),
      keywords: t('command.newChat.keywords'),
      icon: MessageSquareIcon,
      source: 'app',
      handler: () => {
        close()
        openNewChat()
      },
    },
    {
      id: 'open-settings',
      label: t('command.openSettings.label'),
      keywords: t('command.openSettings.keywords'),
      icon: SettingsIcon,
      shortcut: '⌘,',
      source: 'app',
      handler: () => {
        close()
        setSettingsSection('appearance')
        openSettingsSection('appearance')
      },
    },
    {
      id: 'toggle-sidebar',
      label: t('command.toggleSidebar.label'),
      keywords: t('command.toggleSidebar.keywords'),
      icon: TerminalIcon,
      shortcut: '⌘B',
      source: 'app',
      handler: () => {
        close()
        toggleSidebar()
      },
    },
    {
      id: 'open-usage',
      label: t('command.openUsage.label'),
      keywords: t('command.openUsage.keywords'),
      icon: CircleDotIcon,
      source: 'app',
      handler: () => {
        close()
        openUsage()
      },
    },
  ]

  const contributedCommands: CommandAction[] = pluginCommands.map(command => ({
    id: command.id,
    label: command.title,
    description: command.description ?? command.category ?? command.owner,
    keywords: [
      command.owner,
      command.localId,
      command.title,
      command.description ?? '',
      command.category ?? '',
      normalizeCommandKeywords(command.keywords),
    ].join(' '),
    icon: getPluginCommandIcon(command),
    shortcut: command.keybinding,
    source: 'plugin',
    handler: async () => {
      close()
      try {
        await command.execute()
      }
      catch (err) {
        toastManager.add({
          type: 'error',
          title: `Plugin command failed: ${command.title}`,
          description: err instanceof Error ? err.message : String(err),
        })
      }
    },
  }))

  return [...appCommands, ...contributedCommands]
}

function useFileSearch(query: string, enabled: boolean, workspaceId: string | null | undefined) {
  const { files: rawFiles, isPending: searchDebouncing } = useWorkspaceFiles(workspaceId ?? null, {
    query,
    limit: 30,
    enabled: enabled && !!query.trim(),
  })
  const files = GlobalSearchFileListSchema.parse(rawFiles) satisfies GlobalSearchFile[]

  const trimmed = query.trim().toLowerCase()

  const filtered = (() => {
    if (!enabled || !trimmed || files.length === 0) {
      return []
    }
    return rankFuzzyItems(files.filter(file => file.type === 'file'), trimmed, {
      fields: file => [
        { value: file.name, role: 'primary' },
        { value: file.path, role: 'path' },
      ],
      searchText: file => file.path,
      limit: 10,
    }).map(result => result.item)
  })()

  return {
    files: filtered,
    workspaceId,
    isPending: enabled && !!trimmed && !!workspaceId && searchDebouncing,
  }
}

interface WorkspaceSearchHit {
  id: string
  name: string
  locator: {
    hostId: string
    path: string
    kind?: 'project' | 'managed-worktree'
    sourceWorkspaceId?: string | null
  }
  identifier: string
}

const GlobalSearchWorkspaceListSchema = z
  .array(
    z.object({
      id: z.string(),
      name: z.string(),
      locator: z.object({
        hostId: z.string(),
        path: z.string(),
        kind: z.enum(['project', 'managed-worktree']).optional(),
        sourceWorkspaceId: z.string().nullable().optional(),
      }),
      identifier: z.string(),
    }),
  )
  .default([])

function useWorkspaceSearch(query: string, enabled: boolean) {
  const trimmed = query.trim().toLowerCase()
  const { data, isPending } = useQuery({
    ...getWorkspacesOptions(),
    enabled,
    staleTime: 60_000,
  })

  const workspaces = GlobalSearchWorkspaceListSchema.parse(data) satisfies WorkspaceSearchHit[]

  const filtered = (() => {
    if (!enabled || !trimmed || workspaces.length === 0) {
      return []
    }
    return rankFuzzyItems(workspaces, trimmed, {
      fields: workspace => [
        { value: workspace.name, role: 'primary' },
        { value: workspace.identifier, role: 'primary' },
        { value: getWorkspaceLocationLabel(workspace), role: 'path' },
      ],
      searchText: workspace => `${workspace.name} ${workspace.identifier} ${getWorkspaceLocationLabel(workspace)}`,
      limit: 10,
    }).map(result => result.item)
  })()

  return {
    workspaces: filtered,
    isPending: enabled && !!trimmed && isPending,
  }
}

interface ThreadSearchHit {
  sessionId: string
  sessionTitle: string | null
  titleRanges: Array<{ start: number, end: number }>
  snippets: Array<{
    text: string
    ranges: Array<{ start: number, end: number }>
    messageRole: string
    messageId: string
  }>
}

function useThreadSearch(query: string, enabled: boolean) {
  const trimmed = query.trim()
  const { data, isPending } = useQuery({
    ...getSearchThreadsOptions({ query: { query: trimmed, limit: 10 } }),
    enabled: enabled && trimmed.length > 0,
    staleTime: 10_000,
  })

  const threads = (data ?? []) as ThreadSearchHit[]

  return {
    threads: enabled ? threads : [],
    isPending: enabled && trimmed.length > 0 && isPending,
  }
}

interface IssueSearchHit {
  id: string
  title: string
  workspaceId: string
  priority: string
  labels: string[]
}

function useIssueSearch(query: string, enabled: boolean) {
  const trimmed = query.trim()
  const { data, isPending } = useQuery({
    ...getIssuesSearchOptions({ query: { q: trimmed, limit: '10' } }),
    enabled: enabled && trimmed.length > 0,
    staleTime: 10_000,
  })

  const issues = (data ?? []) as IssueSearchHit[]
  const workspaceIds = [...new Set(issues.map(issue => issue.workspaceId))]
  const firstWorkspaceId = workspaceIds[0] ?? null

  const { data: boardsData } = useQuery({
    ...getKanbanBoardsOptions({ query: { workspaceId: firstWorkspaceId ?? undefined } }),
    enabled: enabled && !!firstWorkspaceId,
    staleTime: 60_000,
  })

  const boardId = (boardsData as Array<{ id: string }> | undefined)?.[0]?.id ?? null

  return {
    issues: enabled ? issues : [],
    isPending: enabled && trimmed.length > 0 && isPending,
    boardId,
  }
}

export const GlobalSearchDialog = ({ open, initialQuery = '>', onOpenChange }: GlobalSearchDialogProps) => {
  if (!open) {
    return null
  }

  return (
    <GlobalSearchDialogContent
      open={open}
      initialQuery={initialQuery}
      onOpenChange={onOpenChange}
    />
  )
}

const GlobalSearchDialogContent = ({ open, initialQuery = '>', onOpenChange }: GlobalSearchDialogProps) => {
  const { t } = useTranslation('search')
  const fileSearchWorkspace = useActiveFileSearchWorkspaceId(open)
  const openWorkspaceFile = useBrowserPanelStore(s => s.openWorkspaceFileTab)
  const setBrowserPanelOpen = useLayoutStore(s => s.setBrowserPanelOpen)
  const [query, setQuery] = useState('')
  const [commandHistory, setCommandHistory] = useState(readCommandHistory)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeFromEscape = useEffectEvent(() => {
    onOpenChange(false)
  })

  useLayoutEffect(() => {
    if (!open) {
      setQuery('')
      return
    }

    setQuery(initialQuery)
    requestAnimationFrame(() => {
      const input = panelRef.current?.querySelector<HTMLInputElement>('[data-slot="command-input"]')
      input?.focus()
      input?.setSelectionRange(initialQuery.length, initialQuery.length)
    })
  }, [initialQuery, open])

  useEffect(() => {
    if (!open) {
      return
    }

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeFromEscape()
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  const close = () => onOpenChange(false)
  const commands = useCommands(close)
  const { id: modeId, query: trimmed } = parsePaletteInput(query)
  const hasQuery = trimmed.length > 0
  const isCommandMode = modeId === 'command'
  const searchFiles = modeId === 'quickOpen' || modeId === 'files'
  const searchWorkspaces = modeId === 'quickOpen'
  const searchThreads = modeId === 'quickOpen' || modeId === 'threads'
  const searchIssues = modeId === 'quickOpen' || modeId === 'issues'
  const fileUnavailable = searchFiles && fileSearchWorkspace.availability !== 'available'

  const {
    files,
    workspaceId: fileWorkspaceId,
    isPending: filesPending,
  } = useFileSearch(
    trimmed,
    open && searchFiles && fileSearchWorkspace.availability === 'available',
    fileSearchWorkspace.workspaceId,
  )

  const { threads, isPending: threadsPending } = useThreadSearch(
    trimmed,
    open && searchThreads,
  )

  const { workspaces: workspaceResults, isPending: workspacesPending } = useWorkspaceSearch(
    trimmed,
    open && searchWorkspaces,
  )

  const { issues, isPending: issuesPending, boardId } = useIssueSearch(
    trimmed,
    open && searchIssues,
  )

  const filteredCommands = (() => {
    if (!isCommandMode) {
      return []
    }

    if (!hasQuery) {
      return [...commands].sort((a, b) => {
        const leftHistoryIndex = commandHistory.indexOf(a.id)
        const rightHistoryIndex = commandHistory.indexOf(b.id)
        const leftRank = leftHistoryIndex === -1 ? Number.MAX_SAFE_INTEGER : leftHistoryIndex
        const rightRank = rightHistoryIndex === -1 ? Number.MAX_SAFE_INTEGER : rightHistoryIndex
        return leftRank - rightRank || a.label.localeCompare(b.label)
      })
    }

    return rankFuzzyItems(commands, trimmed, {
      fields: command => [
        { value: command.label, role: 'primary' },
        { value: command.id, role: 'primary' },
        { value: command.keywords, role: 'secondary' },
        { value: command.description, role: 'secondary' },
        { value: command.source, role: 'secondary' },
      ],
      searchText: command => `${command.label} ${command.id} ${command.keywords} ${command.description ?? ''} ${command.source}`,
    }).map(result => result.item)
  })()

  const isPending = filesPending || workspacesPending || threadsPending || issuesPending

  const handleSelectCommand = (command: CommandAction) => {
    setCommandHistory(writeCommandHistory(command.id))
    void command.handler()
  }

  const handleSelectFile = (filePath: string) => {
    if (!fileWorkspaceId) {
      return
    }

    selectFileSearchResult({
      workspaceId: fileWorkspaceId,
      filePath,
      close,
      openWorkspaceFile,
      setBrowserPanelOpen,
    })
  }

  const handleSelectThread = (sessionId: string) => {
    close()
    openChatSession(sessionId)
  }

  const handleSelectWorkspace = (workspaceId: string) => {
    close()
    openWorkspaceDetail(workspaceId)
  }

  const handleSelectIssue = (issueId: string) => {
    close()
    if (boardId) {
      openKanbanBoard({ boardId, issueId })
    }
  }

  const placeholder = t(PLACEHOLDER_KEY[modeId])

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 isolate z-50 flex items-start justify-center px-4 pt-[16vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false)
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('aria.dialog')}
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-[0_24px_80px_-12px_rgba(0,0,0,0.28),0_0_0_1px_rgba(0,0,0,0.06)] ring-1 ring-foreground/10 dark:shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        <Command shouldFilter={false} data-testid="global-search-dialog">
          <div className="relative">
            <CommandInput
              placeholder={placeholder}
              value={query}
              onValueChange={setQuery}
              aria-label={t('aria.input')}
              data-testid="global-search-input"
            />
            <DelayedSpinner
              active={isPending}
              className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2"
            />
          </div>

          <CommandList>
            {filteredCommands.length > 0 && (
              <CommandGroup>
                <GroupHeader label={t('group.commands')} count={filteredCommands.length} />
                {filteredCommands.map(cmd => (
                  <CommandActionRow
                    key={cmd.id}
                    command={cmd}
                    onSelect={handleSelectCommand}
                  />
                ))}
              </CommandGroup>
            )}

            {files.length > 0 && (
              <CommandGroup>
                <GroupHeader label={t('group.files')} count={files.length} />
                {files.map(file => (
                  <FileSearchCommandRow
                    key={file.path}
                    file={file}
                    onSelect={handleSelectFile}
                  />
                ))}
              </CommandGroup>
            )}

            {workspaceResults.length > 0 && (
              <CommandGroup>
                <GroupHeader label={t('group.workspaces')} count={workspaceResults.length} />
                {workspaceResults.map(workspace => (
                  <WorkspaceSearchResultRow
                    key={workspace.id}
                    workspace={workspace}
                    onSelect={handleSelectWorkspace}
                  />
                ))}
              </CommandGroup>
            )}

            {threads.length > 0 && (
              <CommandGroup>
                <GroupHeader label={t('group.threads')} count={threads.length} />
                {threads.map(thread => (
                  <ThreadSearchResultRow
                    key={thread.sessionId}
                    thread={thread}
                    onSelect={handleSelectThread}
                  />
                ))}
              </CommandGroup>
            )}

            {issues.length > 0 && (
              <CommandGroup>
                <GroupHeader label={t('group.issues')} count={issues.length} />
                {issues.map(issue => (
                  <IssueSearchResultRow
                    key={issue.id}
                    issue={issue}
                    onSelect={handleSelectIssue}
                  />
                ))}
              </CommandGroup>
            )}

            <CommandEmpty className="py-12">
              {isPending
                ? <LoadingState />
                : hasQuery
                  ? <NoResults />
                  : fileUnavailable
                    ? <FileSearchUnavailableState availability={fileSearchWorkspace.availability} />
                    : <IdleState />}
            </CommandEmpty>
          </CommandList>

          <div className="flex items-center gap-4 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <KbdGroup>
                <Kbd>
                  <ArrowUpIcon />
                </Kbd>
                <Kbd>
                  <ArrowDownIcon />
                </Kbd>
              </KbdGroup>
              {t('footer.select')}
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>
                <CornerDownLeftIcon />
              </Kbd>
              {t('footer.open')}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <Kbd>Esc</Kbd>
              {t('footer.close')}
            </span>
          </div>
        </Command>
      </div>
    </div>,
    document.body,
  )
}

const CommandActionRow = ({
  command,
  onSelect,
}: {
  command: CommandAction
  onSelect: (command: CommandAction) => void
}) => {
  return (
    <CommandItem
      value={command.id}
      onSelect={() => onSelect(command)}
      className="gap-3 px-2.5"
      data-testid={`global-search-command-${command.id}`}
    >
      <command.icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px]">{command.label}</span>
        {command.description && (
          <span className="truncate text-[11px] text-muted-foreground">{command.description}</span>
        )}
      </span>
      {command.shortcut && (
        <CommandShortcut>{command.shortcut}</CommandShortcut>
      )}
    </CommandItem>
  )
}

const FileSearchCommandRow = ({
  file,
  onSelect,
}: {
  file: GlobalSearchFile
  onSelect: (filePath: string) => void
}) => {
  const dir = file.path.endsWith(file.name)
    ? file.path.slice(0, file.path.length - file.name.length).replace(/\/$/, '')
    : ''

  return (
    <CommandItem
      value={`file-${file.path}`}
      onSelect={() => onSelect(file.path)}
      className="min-h-7 gap-2 px-2.5 py-0.5"
      data-testid={`global-search-file-result-${file.path}`}
    >
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate text-[13px]">{file.name}</span>
        {dir && (
          <span className="truncate font-mono text-[11px] text-muted-foreground/45">{dir}</span>
        )}
      </span>
    </CommandItem>
  )
}

const WorkspaceSearchResultRow = ({
  workspace,
  onSelect,
}: {
  workspace: WorkspaceSearchHit
  onSelect: (workspaceId: string) => void
}) => {
  return (
    <CommandItem
      value={`workspace-${workspace.id}`}
      onSelect={() => onSelect(workspace.id)}
      className="min-h-7 gap-2 px-2.5 py-0.5"
      data-testid={`global-search-workspace-result-${workspace.id}`}
    >
      <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate text-[13px]">{workspace.name}</span>
        {workspace.identifier && (
          <span className="truncate font-mono text-[11px] uppercase text-muted-foreground/45">{workspace.identifier}</span>
        )}
      </span>
    </CommandItem>
  )
}

const ThreadSearchResultRow = ({
  thread,
  onSelect,
}: {
  thread: ThreadSearchHit
  onSelect: (sessionId: string) => void
}) => {
  const { t } = useTranslation('search')
  const title = thread.sessionTitle ?? thread.snippets[0]?.text ?? ''
  const snippet = thread.snippets[0]

  return (
    <CommandItem
      value={`thread-${thread.sessionId}`}
      onSelect={() => onSelect(thread.sessionId)}
      className="gap-3 px-2.5 text-left"
      data-testid={`global-search-thread-result-${thread.sessionId}`}
    >
      <MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="w-full min-w-0 truncate text-[13px]"
          data-testid={`global-search-thread-title-${thread.sessionId}`}
        >
          <HighlightedText text={title} ranges={thread.titleRanges} />
        </span>
        {snippet && (
          <span
            className="w-full min-w-0 truncate text-[11px] text-muted-foreground"
            data-testid={`global-search-thread-snippet-${thread.sessionId}`}
          >
            <HighlightedText text={snippet.text} ranges={snippet.ranges} />
          </span>
        )}
        {thread.snippets.length === 0 && (
          <span className="text-[11px] text-muted-foreground/70">{t('thread.match.titleOnly')}</span>
        )}
      </span>
    </CommandItem>
  )
}

const IssueSearchResultRow = ({
  issue,
  onSelect,
}: {
  issue: IssueSearchHit
  onSelect: (issueId: string) => void
}) => {
  return (
    <CommandItem
      value={`issue-${issue.id}`}
      onSelect={() => onSelect(issue.id)}
      className="gap-3 px-2.5"
      data-testid={`global-search-issue-result-${issue.title}`}
    >
      <CircleDotIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-[13px]">{issue.title}</span>
    </CommandItem>
  )
}

function GroupHeader({ label, count }: { label: string, count: number }) {
  return (
    <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">{label}</span>
      <span className="text-[10px] tabular-nums text-muted-foreground/40">{count}</span>
    </div>
  )
}

function LoadingState() {
  const { t } = useTranslation('search')

  return (
    <div className="flex flex-col items-center gap-2">
      <DelayedSpinner active className="size-4" />
      <span className="text-xs text-muted-foreground">{t('state.loading')}</span>
    </div>
  )
}

function NoResults() {
  const { t } = useTranslation('search')

  return (
    <span className="text-xs text-muted-foreground">{t('state.noResults')}</span>
  )
}

function FileSearchUnavailableState({ availability }: { availability: FileSearchAvailability }) {
  const { t } = useTranslation('search')
  const message = availability === 'missing-workspace'
    ? t('state.fileSearchMissingWorkspace')
    : t('state.fileSearchUnsupportedTab')

  return (
    <p className="mx-auto max-w-sm text-center text-xs leading-relaxed text-muted-foreground">
      {message}
    </p>
  )
}

function IdleState() {
  const { t } = useTranslation('search')

  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-xs text-muted-foreground/70">{t('state.idle')}</span>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
        {SCOPE_PREFIXES.map(scope => (
          <span key={scope.prefix} className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
            <kbd className="rounded bg-foreground/8 px-1 font-mono text-[10px] text-foreground/70">
              {scope.prefix}
            </kbd>
            {t(scope.labelKey)}
          </span>
        ))}
      </div>
    </div>
  )
}
