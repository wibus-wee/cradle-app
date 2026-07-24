import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react'
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

import { CommandActionRow } from './palette/command-action-row'
import { FileSearchRow } from './palette/file-search-row'
import { GroupHeader } from './palette/group-header'
import { IssueRow } from './palette/issue-row'
import { PALETTE_MODES, PLACEHOLDER_KEY, PREFIX_TO_MODE } from './palette/modes'
import { PaletteFilterBadges } from './palette/palette-badges'
import { RecentConversationRow } from './palette/recent-conversation-row'
import { ThreadRow } from './palette/thread-row'
import type { CommandAction, PaletteData, PaletteModeId } from './palette/types'
import { WorkspaceRow } from './palette/workspace-row'

export interface GlobalSearchDialogViewProps {
  mode: PaletteModeId
  query: string
  data: PaletteData
  onModeChange: (mode: PaletteModeId) => void
  onQueryChange: (query: string) => void
  onSelectCommand: (command: CommandAction) => void
  onSelectFile: (filePath: string) => void
  onSelectThread: (sessionId: string) => void
  onSelectWorkspace: (workspaceId: string) => void
  onSelectIssue: (issueId: string) => void
  onDismiss: () => void
}

export function GlobalSearchDialogView({
  mode,
  query,
  data,
  onModeChange,
  onQueryChange,
  onSelectCommand,
  onSelectFile,
  onSelectThread,
  onSelectWorkspace,
  onSelectIssue,
  onDismiss,
}: GlobalSearchDialogViewProps) {
  const { t } = useTranslation('search')
  const panelRef = useRef<HTMLDivElement>(null)

  const focusInputAtEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const input = panelRef.current?.querySelector<HTMLInputElement>(
        '[data-slot="command-input"]',
      )
      input?.focus()
      const end = input?.value.length ?? 0
      input?.setSelectionRange(end, end)
    })
  }, [])

  useLayoutEffect(() => {
    focusInputAtEnd()
  }, [focusInputAtEnd])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onDismiss])

  const handleValueChange = useCallback((value: string) => {
    const head = value[0]
    const prefixMode = head
      ? PREFIX_TO_MODE[head as keyof typeof PREFIX_TO_MODE]
      : undefined
    if (prefixMode) {
      onModeChange(prefixMode)
      onQueryChange(value.slice(1).trimStart())
      return
    }
    onQueryChange(value)
  }, [onModeChange, onQueryChange])

  const handleBadgeSelect = useCallback((nextMode: PaletteModeId) => {
    onModeChange(nextMode)
    focusInputAtEnd()
  }, [focusInputAtEnd, onModeChange])

  const cycleMode = useCallback((direction: 1 | -1) => {
    const order = PALETTE_MODES.map(paletteMode => paletteMode.id)
    const index = order.indexOf(mode)
    onModeChange(order[(index + direction + order.length) % order.length])
    focusInputAtEnd()
  }, [focusInputAtEnd, mode, onModeChange])

  const handleInputKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
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

  const counts = useMemo<Partial<Record<PaletteModeId, number>>>(() => ({
    commands: data.filteredCommands.length || data.suggestedCommands.length,
    files: data.files.length,
    threads: data.threads.length,
    issues: data.issues.length,
    workspaces: data.workspaces.length,
  }), [data])
  const commandsToShow = mode === 'commands'
    ? (data.hasQuery ? data.filteredCommands : data.suggestedCommands)
    : (mode === 'all' && !data.hasQuery ? data.suggestedCommands : [])
  const showRecent = (mode === 'all' || mode === 'threads') && !data.hasQuery
  const showFiles = mode === 'all' || mode === 'files'
  const showThreads = mode === 'all' || mode === 'threads'
  const showIssues = mode === 'all' || mode === 'issues'
  const showWorkspaces = mode === 'all' || mode === 'workspaces'
  const hasAnyResults = (
    showRecent && data.recentConversations.length > 0
  )
  || commandsToShow.length > 0
  || (showFiles && data.files.length > 0)
  || (showThreads && data.hasQuery && data.threads.length > 0)
  || (showIssues && data.hasQuery && data.issues.length > 0)
  || (showWorkspaces && data.workspaces.length > 0)

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 isolate z-50 flex items-start justify-center px-3 pt-[16vh] sm:px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss()
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('aria.dialog')}
        className="relative w-full max-w-160 overflow-hidden rounded-lg bg-popover/92 text-popover-foreground shadow-[0_20px_70px_-16px_rgba(0,0,0,0.22),0_0_0_1px_rgba(0,0,0,0.05)] ring-1 ring-foreground/[0.06] backdrop-blur-xl dark:shadow-[0_20px_70px_-16px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06)]"
      >
        <Command shouldFilter={false} data-testid="global-search-dialog">
          <div className="relative">
            <CommandInput
              placeholder={t(PLACEHOLDER_KEY[mode])}
              value={query}
              onValueChange={handleValueChange}
              onKeyDown={handleInputKeyDown}
              aria-label={t('aria.input')}
              data-testid="global-search-input"
            />
            <DelayedSpinner
              active={data.isPending}
              className="pointer-events-none absolute top-1/2 right-3.5 size-3.5 -translate-y-1/2"
            />
          </div>

          <div className="border-b border-foreground/[0.05] dark:border-white/[0.05]">
            <PaletteFilterBadges
              activeMode={mode}
              counts={counts}
              onSelect={handleBadgeSelect}
            />
          </div>

          <CommandList aria-busy={data.isPending}>
            {showRecent && data.recentConversations.length > 0
              ? (
                  <CommandGroup>
                    <GroupHeader
                      label={t('group.recent')}
                      count={data.recentConversations.length}
                    />
                    {data.recentConversations.map(conversation => (
                      <RecentConversationRow
                        key={conversation.id}
                        data={conversation}
                        onSelect={onSelectThread}
                      />
                    ))}
                  </CommandGroup>
                )
              : null}

            {commandsToShow.length > 0
              ? (
                  <CommandGroup>
                    <GroupHeader
                      label={t('group.commands')}
                      count={commandsToShow.length}
                    />
                    {commandsToShow.map(command => (
                      <CommandActionRow
                        key={command.id}
                        data={command}
                        onSelect={onSelectCommand}
                      />
                    ))}
                  </CommandGroup>
                )
              : null}

            {showFiles && data.files.length > 0
              ? (
                  <CommandGroup>
                    <GroupHeader
                      label={t('group.files')}
                      count={data.files.length}
                    />
                    {data.files.map(file => (
                      <FileSearchRow
                        key={file.path}
                        data={file}
                        onSelect={onSelectFile}
                      />
                    ))}
                  </CommandGroup>
                )
              : null}

            {showThreads && data.hasQuery && data.threads.length > 0
              ? (
                  <CommandGroup>
                    <GroupHeader
                      label={t('group.threads')}
                      count={data.threads.length}
                    />
                    {data.threads.map(thread => (
                      <ThreadRow
                        key={thread.sessionId}
                        data={thread}
                        onSelect={onSelectThread}
                      />
                    ))}
                  </CommandGroup>
                )
              : null}

            {showIssues && data.hasQuery && data.issues.length > 0
              ? (
                  <CommandGroup>
                    <GroupHeader
                      label={t('group.issues')}
                      count={data.issues.length}
                    />
                    {data.issues.map(issue => (
                      <IssueRow
                        key={issue.id}
                        data={issue}
                        onSelect={onSelectIssue}
                      />
                    ))}
                  </CommandGroup>
                )
              : null}

            {showWorkspaces && data.workspaces.length > 0
              ? (
                  <CommandGroup>
                    <GroupHeader
                      label={t('group.workspaces')}
                      count={data.workspaces.length}
                    />
                    {data.workspaces.map(workspace => (
                      <WorkspaceRow
                        key={workspace.id}
                        data={workspace}
                        onSelect={onSelectWorkspace}
                      />
                    ))}
                  </CommandGroup>
                )
              : null}

            {!hasAnyResults && !data.isPending
              ? (
                  <CommandEmpty className="py-12">
                    <span className="text-xs text-muted-foreground">
                      {data.hasQuery ? t('state.noResults') : t('state.idle')}
                    </span>
                  </CommandEmpty>
                )
              : null}
          </CommandList>
        </Command>
      </div>
    </div>,
    document.body,
  )
}
