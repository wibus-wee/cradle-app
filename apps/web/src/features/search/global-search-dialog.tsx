import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from '~/components/ui/command'
import { DelayedSpinner } from '~/components/ui/spinner'
import { openChatSession, openKanbanBoard, openWorkspaceDetail } from '~/navigation/navigation-commands'
import { useBrowserPanelStore } from '~/store/browser-panel'

import { selectFileSearchResult } from './global-search-actions'
import { PALETTE_MODES, parseInitialQuery, PLACEHOLDER_KEY, PREFIX_TO_MODE } from './palette/modes'
import { PaletteFilterBadges } from './palette/palette-badges'
import {
  CommandActionRow,
  FileSearchRow,
  GroupHeader,
  IssueRow,
  RecentConversationRow,
  ThreadRow,
  WorkspaceRow,
} from './palette/palette-rows'
import type { CommandAction, PaletteModeId } from './palette/types'
import { usePaletteData, usePaletteLandingData, writeCommandHistory } from './palette/use-palette-data'

interface GlobalSearchDialogProps {
  open: boolean
  initialQuery?: string
  onOpenChange: (open: boolean) => void
}

export const GlobalSearchDialog = ({ open, initialQuery = '>', onOpenChange }: GlobalSearchDialogProps) => {
  usePaletteLandingData(!open)

  if (!open) {
    return null
  }

  return (
    <GlobalSearchDialogContent
      key={initialQuery}
      initialQuery={initialQuery}
      onOpenChange={onOpenChange}
    />
  )
}

const GlobalSearchDialogContent = ({
  initialQuery = '>',
  onOpenChange,
}: Omit<GlobalSearchDialogProps, 'open'>) => {
  const { t } = useTranslation('search')
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const openWorkspaceFile = useBrowserPanelStore(s => s.openWorkspaceFileTab)
  const [{ mode: initialMode, query: initialQueryText }] = useState(() => parseInitialQuery(initialQuery))
  const [query, setQuery] = useState(initialQueryText)
  const [mode, setMode] = useState<PaletteModeId>(initialMode)
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      const input = panelRef.current?.querySelector<HTMLInputElement>('[data-slot="command-input"]')
      input?.focus()
      const end = input?.value.length ?? 0
      input?.setSelectionRange(end, end)
    })
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [close])

  const data = usePaletteData({ mode, query, close })

  const handleSelectCommand = useCallback((command: CommandAction) => {
    writeCommandHistory(command.id)
    void command.handler()
  }, [])

  const handleSelectFile = useCallback((filePath: string) => {
    if (!data.fileWorkspaceId) {
      return
    }

    selectFileSearchResult({
      workspaceId: data.fileWorkspaceId,
      filePath,
      close,
      openWorkspaceFile,
    })
  }, [data.fileWorkspaceId, close, openWorkspaceFile])

  const handleSelectThread = useCallback((sessionId: string) => {
    close()
    openChatSession(sessionId)
  }, [close])

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    close()
    openWorkspaceDetail(workspaceId)
  }, [close])

  const handleSelectIssue = useCallback((issueId: string) => {
    close()
    if (data.boardId) {
      openKanbanBoard({ boardId: data.boardId, issueId })
    }
  }, [close, data.boardId])

  const focusInputAtEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const input = panelRef.current?.querySelector<HTMLInputElement>('[data-slot="command-input"]')
      input?.focus()
      const end = input?.value.length ?? 0
      input?.setSelectionRange(end, end)
    })
  }, [])

  // Input changes: if the user typed a power-user prefix (`>` `/` `#` `@`) at
  // the very start, switch mode and consume it; otherwise update the query.
  // This keeps the e2e `fill(">设置")` flow working: the `>` is consumed into
  // command mode and the query becomes `设置`.
  const handleValueChange = useCallback((value: string) => {
    const head = value[0]
    const prefixMode = head ? PREFIX_TO_MODE[head as keyof typeof PREFIX_TO_MODE] : undefined
    if (prefixMode) {
      setMode(prefixMode)
      setQuery(value.slice(1).trimStart())
      return
    }
    setQuery(value)
  }, [])

  const handleBadgeSelect = useCallback((nextMode: PaletteModeId) => {
    setMode(nextMode)
    focusInputAtEnd()
  }, [focusInputAtEnd])

  const cycleMode = useCallback((direction: 1 | -1) => {
    setMode((current) => {
      const order = PALETTE_MODES.map(m => m.id)
      const index = order.indexOf(current)
      return order[(index + direction + order.length) % order.length]
    })
    focusInputAtEnd()
  }, [focusInputAtEnd])

  // ← / → cycle filter modes, but only at the text boundaries so mid-query
  // cursor editing still works. ↑ / ↓ stay on cmdk for item navigation.
  const handleInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) {
      return
    }
    const input = event.currentTarget
    const position = input.selectionStart ?? 0
    if (event.key === 'ArrowLeft' && position === 0) {
      event.preventDefault()
      cycleMode(-1)
    }
    else if (event.key === 'ArrowRight' && position === input.value.length) {
      event.preventDefault()
      cycleMode(1)
    }
  }, [cycleMode])

  const hasQuery = data.hasQuery

  // Badge counts: only the active mode's source is fetched (plus everything in
  // `all` mode), so counts naturally surface only where they're meaningful.
  const counts = useMemo<Partial<Record<PaletteModeId, number>>>(() => ({
    commands: data.filteredCommands.length || data.suggestedCommands.length,
    files: data.files.length,
    threads: data.threads.length,
    issues: data.issues.length,
    workspaces: data.workspaces.length,
  }), [data])

  const placeholderKey = PLACEHOLDER_KEY[mode]
  const placeholder = t(placeholderKey)

  // Commands render in command mode (filtered when querying, suggested when
  // not) and as a suggestion list in the `all` landing. Other modes don't
  // surface commands.
  const commandsToShow = mode === 'commands'
    ? (hasQuery ? data.filteredCommands : data.suggestedCommands)
    : (mode === 'all' && !hasQuery ? data.suggestedCommands : [])

  // Recent conversations are a landing section for `all` and `threads` only.
  const showRecent = (mode === 'all' || mode === 'threads') && !hasQuery
  const showFiles = mode === 'all' || mode === 'files'
  const showThreads = mode === 'all' || mode === 'threads'
  const showIssues = mode === 'all' || mode === 'issues'
  const showWorkspaces = mode === 'all' || mode === 'workspaces'

  const hasAnyResults = (showRecent && data.recentConversations.length > 0)
    || commandsToShow.length > 0
    || (showFiles && data.files.length > 0)
    || (showThreads && hasQuery && data.threads.length > 0)
    || (showIssues && hasQuery && data.issues.length > 0)
    || (showWorkspaces && data.workspaces.length > 0)

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 isolate z-50 flex items-start justify-center px-4 pt-[16vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close()
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('aria.dialog')}
        className="relative w-full max-w-[640px] overflow-hidden rounded-2xl bg-popover/92 text-popover-foreground shadow-[0_20px_70px_-16px_rgba(0,0,0,0.22),0_0_0_1px_rgba(0,0,0,0.05)] ring-1 ring-foreground/[0.06] backdrop-blur-xl dark:shadow-[0_20px_70px_-16px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06)]"
      >
        <Command shouldFilter={false} data-testid="global-search-dialog">
          <div className="relative">
            <CommandInput
              placeholder={placeholder}
              value={query}
              onValueChange={handleValueChange}
              onKeyDown={handleInputKeyDown}
              aria-label={t('aria.input')}
              data-testid="global-search-input"
            />
            <DelayedSpinner
              active={data.isPending}
              className="pointer-events-none absolute right-3.5 top-1/2 size-3.5 -translate-y-1/2"
            />
          </div>

          <div className="border-b border-foreground/[0.05] dark:border-white/[0.05]">
            <PaletteFilterBadges activeMode={mode} counts={counts} onSelect={handleBadgeSelect} />
          </div>

          <CommandList aria-busy={data.isPending}>
            {showRecent && data.recentConversations.length > 0 && (
              <CommandGroup>
                <GroupHeader
                  label={t('group.recent')}
                  count={data.recentConversations.length}
                />
                {data.recentConversations.map(conversation => (
                  <RecentConversationRow
                    key={conversation.id}
                    data={conversation}
                    onSelect={handleSelectThread}
                  />
                ))}
              </CommandGroup>
            )}

            {commandsToShow.length > 0 && (
              <CommandGroup>
                <GroupHeader
                  label={t('group.commands')}
                  count={commandsToShow.length}
                />
                {commandsToShow.map(cmd => (
                  <CommandActionRow key={cmd.id} data={cmd} onSelect={handleSelectCommand} />
                ))}
              </CommandGroup>
            )}

            {showFiles && data.files.length > 0 && (
              <CommandGroup>
                <GroupHeader
                  label={t('group.files')}
                  count={data.files.length}
                />
                {data.files.map(file => (
                  <FileSearchRow key={file.path} data={file} onSelect={handleSelectFile} />
                ))}
              </CommandGroup>
            )}

            {showThreads && data.hasQuery && data.threads.length > 0 && (
              <CommandGroup>
                <GroupHeader
                  label={t('group.threads')}
                  count={data.threads.length}
                />
                {data.threads.map(thread => (
                  <ThreadRow key={thread.sessionId} data={thread} onSelect={handleSelectThread} />
                ))}
              </CommandGroup>
            )}

            {showIssues && data.hasQuery && data.issues.length > 0 && (
              <CommandGroup>
                <GroupHeader
                  label={t('group.issues')}
                  count={data.issues.length}
                />
                {data.issues.map(issue => (
                  <IssueRow key={issue.id} data={issue} onSelect={handleSelectIssue} />
                ))}
              </CommandGroup>
            )}

            {showWorkspaces && data.workspaces.length > 0 && (
              <CommandGroup>
                <GroupHeader
                  label={t('group.workspaces')}
                  count={data.workspaces.length}
                />
                {data.workspaces.map(workspace => (
                  <WorkspaceRow key={workspace.id} data={workspace} onSelect={handleSelectWorkspace} />
                ))}
              </CommandGroup>
            )}

            {!hasAnyResults && !data.isPending && (
              <CommandEmpty className="py-12">
                {hasQuery
                  ? <NoResults />
                  : <span className="text-xs text-muted-foreground/60">{t('state.idle')}</span>}
              </CommandEmpty>
            )}
          </CommandList>
        </Command>
      </div>
    </div>,
    document.body,
  )
}

function NoResults() {
  const { t } = useTranslation('search')

  return (
    <span className="text-xs text-muted-foreground">{t('state.noResults')}</span>
  )
}
