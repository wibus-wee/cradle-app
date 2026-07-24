import {
  DotCircleLine as CircleDotIcon,
  Message1Line as MessageSquareIcon,
  Plugin2Line,
  Settings2Line as SettingsIcon,
  TerminalLine as TerminalIcon,
} from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import type { ComponentType } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import {
  getIssuesSearchOptions,
  getKanbanBoardsOptions,
  getSessionsByIdOptions,
  getSessionsOptions,
  getWorkspacesOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { useLayoutSlotsCtx } from '~/components/layout/use-layout-slots'
import { toastManager } from '~/components/ui/toast'
import type { ThreadSearchHit } from '~/features/search/types'
import { useThreadSearch } from '~/features/search/use-thread-search'
import { getWorkspaceLocationLabel } from '~/features/workspace/types'
import { useWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { rankFuzzyItems } from '~/lib/fuzzy-rank'
import type { WebCommandRegistration } from '~/lib/plugin-store'
import { usePluginStore } from '~/lib/plugin-store'
import { useActiveSurface } from '~/navigation/active-surface'
import { openNewChat, openSettingsSection, openUsage } from '~/navigation/navigation-commands'
import { chatSessionIdForSurface, workspaceIdForSurface } from '~/navigation/surface-identity'
import { useLayoutStore } from '~/store/layout'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import type {
  CommandAction,
  FileSearchAvailability,
  GlobalSearchFile,
  IssueSearchHit,
  PaletteModeId,
  WorkspaceSearchHit,
} from './types'
import { useDebouncedValue } from './use-debounced-value'

const ISSUE_DEBOUNCE_MS = 150
const COMMAND_HISTORY_KEY = 'cradle.commandPalette.recentCommands'
const COMMAND_HISTORY_LIMIT = 12

const SessionWorkspaceSchema = z
  .object({
    workspaceId: z.string().nullable(),
  })
  .passthrough()

const GlobalSearchFileListSchema = z
  .array(
    z.object({
      type: z.enum(['file', 'directory']),
      name: z.string(),
      path: z.string(),
    }),
  )
  .default([])

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

function useCommands(close: () => void): CommandAction[] {
  const { t } = useTranslation('search')
  const setSettingsSection = useSettingsOverlayStore(s => s.setSettingsSection)
  const toggleSidebar = useLayoutStore(s => s.toggleSidebar)
  const pluginCommands = usePluginStore(s => s.commands)

  return useMemo<CommandAction[]>(() => {
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
  }, [t, setSettingsSection, toggleSidebar, pluginCommands, close])
}

function useFileSearch(query: string, enabled: boolean, workspaceId: string | null | undefined) {
  const { files: rawFiles, isPending: searchDebouncing } = useWorkspaceFiles(workspaceId ?? null, {
    query,
    limit: 30,
    enabled: enabled && !!workspaceId,
  })
  const files = GlobalSearchFileListSchema.parse(rawFiles) satisfies GlobalSearchFile[]

  const trimmed = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!enabled || files.length === 0) {
      return []
    }
    // Landing state (no query): show the workspace root files as a quick
    // entry point. With a query: fuzzy-rank file matches. Directories are
    // excluded from the landing since opening one as a file is meaningless.
    if (!trimmed) {
      return files.filter(file => file.type === 'file').slice(0, 8)
    }
    return rankFuzzyItems(files.filter(file => file.type === 'file'), trimmed, {
      fields: file => [
        { value: file.name, role: 'primary' },
        { value: file.path, role: 'path' },
      ],
      searchText: file => file.path,
      limit: 10,
    }).map(result => result.item)
  }, [enabled, trimmed, files])

  return {
    files: filtered,
    workspaceId: workspaceId ?? null,
    isPending: enabled && !!trimmed && !!workspaceId && searchDebouncing,
  }
}

function useWorkspaceSearch(query: string, enabled: boolean) {
  const trimmed = query.trim().toLowerCase()
  const { data, isPending } = useQuery({
    ...getWorkspacesOptions(),
    enabled,
    staleTime: 60_000,
  })

  const workspaces = GlobalSearchWorkspaceListSchema.parse(data) satisfies WorkspaceSearchHit[]

  const filtered = useMemo(() => {
    if (!enabled || workspaces.length === 0) {
      return []
    }
    // Landing state (no query): show workspaces as a switcher. With a query:
    // fuzzy-rank matches.
    if (!trimmed) {
      return workspaces.slice(0, 5)
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
  }, [enabled, trimmed, workspaces])

  return {
    workspaces: filtered,
    isPending: enabled && !!trimmed && isPending,
  }
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

export interface RecentConversation {
  id: string
  title: string | null
}

function useRecentConversations(enabled: boolean): RecentConversation[] {
  const { data } = useQuery({
    ...getSessionsOptions({}),
    enabled,
    staleTime: 30_000,
    select: (sessions: Array<{ id: string, title: string | null, updatedAt: number }>): RecentConversation[] =>
      [...sessions]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5)
        .map(session => ({ id: session.id, title: session.title })),
  })

  return data ?? []
}

export interface PaletteData {
  commands: CommandAction[]
  filteredCommands: CommandAction[]
  suggestedCommands: CommandAction[]
  recentConversations: RecentConversation[]
  files: GlobalSearchFile[]
  workspaces: WorkspaceSearchHit[]
  threads: ThreadSearchHit[]
  issues: IssueSearchHit[]
  fileWorkspaceId: string | null
  fileAvailability: FileSearchAvailability
  fileUnavailable: boolean
  boardId: string | null
  isPending: boolean
  hasQuery: boolean
}

/** Keep the palette's landing data warm while its UI is closed. */
export function usePaletteLandingData(enabled: boolean): void {
  const fileSearchWorkspace = useActiveFileSearchWorkspaceId(enabled)

  useFileSearch(
    '',
    enabled && fileSearchWorkspace.availability === 'available',
    fileSearchWorkspace.workspaceId,
  )
  useWorkspaceSearch('', enabled)
  useRecentConversations(enabled)
}

/**
 * Aggregate every search source the palette needs. `mode` is explicit state
 * (decoupled from the input) and `query` is already a clean search term with
 * no leading prefix. The thread hook debounces internally; the issue query is
 * debounced here.
 */
export function usePaletteData(params: {
  mode: PaletteModeId
  query: string
  close: () => void
}): PaletteData {
  const { mode, query, close } = params
  const fileSearchWorkspace = useActiveFileSearchWorkspaceId(true)
  const commands = useCommands(close)

  const hasQuery = query.length > 0
  const searchCommands = mode === 'commands'
  const searchFiles = mode === 'all' || mode === 'files'
  const searchWorkspaces = mode === 'all' || mode === 'workspaces'
  const searchThreads = mode === 'all' || mode === 'threads'
  const searchIssues = mode === 'all' || mode === 'issues'

  const debouncedIssueQuery = useDebouncedValue(query, ISSUE_DEBOUNCE_MS)

  const { files, workspaceId: fileWorkspaceId, isPending: filesPending } = useFileSearch(
    query,
    searchFiles && fileSearchWorkspace.availability === 'available',
    fileSearchWorkspace.workspaceId,
  )

  const { hits: threads, isPending: threadsPending } = useThreadSearch({
    query,
    enabled: searchThreads,
  })

  const { workspaces, isPending: workspacesPending } = useWorkspaceSearch(
    query,
    searchWorkspaces,
  )

  const { issues, isPending: issuesPending, boardId } = useIssueSearch(
    debouncedIssueQuery,
    searchIssues,
  )

  // Recent conversations populate the "all" and "threads" landing states so
  // the palette is useful before the user types anything. Global (not
  // workspace-scoped) so it shows even without an active workspace.
  const recentConversations = useRecentConversations(mode === 'all' || mode === 'threads')

  // Recency-sorted commands shown as suggestions when there is no query, in
  // any mode. This keeps the palette non-empty on open.
  const suggestedCommands = useMemo(() => {
    if (hasQuery) {
      return []
    }
    const history = readCommandHistory()
    return [...commands]
      .sort((a, b) => {
        const leftHistoryIndex = history.indexOf(a.id)
        const rightHistoryIndex = history.indexOf(b.id)
        const leftRank = leftHistoryIndex === -1 ? Number.MAX_SAFE_INTEGER : leftHistoryIndex
        const rightRank = rightHistoryIndex === -1 ? Number.MAX_SAFE_INTEGER : rightHistoryIndex
        return leftRank - rightRank || a.label.localeCompare(b.label)
      })
      .slice(0, 8)
  }, [hasQuery, commands])

  const filteredCommands = useMemo(() => {
    if (!searchCommands || !hasQuery) {
      return []
    }

    return rankFuzzyItems(commands, query, {
      fields: command => [
        { value: command.label, role: 'primary' },
        { value: command.id, role: 'primary' },
        { value: command.keywords, role: 'secondary' },
        { value: command.description, role: 'secondary' },
        { value: command.source, role: 'secondary' },
      ],
      searchText: command => `${command.label} ${command.id} ${command.keywords} ${command.description ?? ''} ${command.source}`,
    }).map(result => result.item)
  }, [searchCommands, hasQuery, commands, query])

  const isPending = filesPending || workspacesPending || threadsPending || issuesPending

  return {
    commands,
    filteredCommands,
    suggestedCommands,
    recentConversations,
    files,
    workspaces,
    threads: searchThreads ? threads : [],
    issues,
    fileWorkspaceId,
    fileAvailability: fileSearchWorkspace.availability,
    fileUnavailable: searchFiles && fileSearchWorkspace.availability !== 'available',
    boardId,
    isPending,
    hasQuery,
  }
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

export function writeCommandHistory(commandId: string): string[] {
  const nextHistory = [commandId, ...readCommandHistory().filter(id => id !== commandId)].slice(0, COMMAND_HISTORY_LIMIT)
  try {
    window.localStorage.setItem(COMMAND_HISTORY_KEY, JSON.stringify(nextHistory))
  }
  catch {
    return nextHistory
  }
  return nextHistory
}
