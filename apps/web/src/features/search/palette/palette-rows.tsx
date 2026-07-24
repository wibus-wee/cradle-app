import {
  DotCircleLine,
  FileLine,
  FolderOpenLine,
  Message1Line,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { CommandItem, CommandShortcut } from '~/components/ui/command'
import { HighlightedText } from '~/features/search/highlighted-text'
import type { ThreadSearchHit } from '~/features/search/types'

import type {
  CommandAction,
  GlobalSearchFile,
  IssueSearchHit,
  RecentConversation,
  WorkspaceSearchHit,
} from './types'

interface CommandActionRowProps {
  data: CommandAction
  onSelect: (command: CommandAction) => void
}

interface FileSearchRowProps {
  data: GlobalSearchFile
  onSelect: (filePath: string) => void
}

interface WorkspaceRowProps {
  data: WorkspaceSearchHit
  onSelect: (workspaceId: string) => void
}

interface ThreadRowProps {
  data: ThreadSearchHit
  onSelect: (sessionId: string) => void
}

interface IssueRowProps {
  data: IssueSearchHit
  onSelect: (issueId: string) => void
}

export function CommandActionRow({ data: command, onSelect }: CommandActionRowProps) {
  return (
    <CommandItem
      value={command.id}
      onSelect={() => onSelect(command)}
      data-testid={`global-search-command-${command.id}`}
    >
      <command.icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px]">{command.label}</span>
        {command.description && (
          <span className="truncate text-[11px] text-muted-foreground/55">{command.description}</span>
        )}
      </span>
      {command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
    </CommandItem>
  )
}

export function FileSearchRow({ data: file, onSelect }: FileSearchRowProps) {
  const dir = file.path.endsWith(file.name)
    ? file.path.slice(0, file.path.length - file.name.length).replace(/\/$/, '')
    : ''

  return (
    <CommandItem
      value={`file-${file.path}`}
      onSelect={() => onSelect(file.path)}
      className="py-0.5"
      data-testid={`global-search-file-result-${file.path}`}
    >
      <FileLine className="size-4 shrink-0 text-muted-foreground/65" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate text-[13px]">{file.name}</span>
        {dir && (
          <span className="truncate font-mono text-[11px] text-muted-foreground/40">{dir}</span>
        )}
      </span>
    </CommandItem>
  )
}

export function WorkspaceRow({ data: workspace, onSelect }: WorkspaceRowProps) {
  return (
    <CommandItem
      value={`workspace-${workspace.id}`}
      onSelect={() => onSelect(workspace.id)}
      className="py-0.5"
      data-testid={`global-search-workspace-result-${workspace.id}`}
    >
      <FolderOpenLine className="size-4 shrink-0 text-muted-foreground/65" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="truncate text-[13px]">{workspace.name}</span>
        {workspace.identifier && (
          <span className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground/40">{workspace.identifier}</span>
        )}
      </span>
    </CommandItem>
  )
}

export function ThreadRow({ data: thread, onSelect }: ThreadRowProps) {
  const { t } = useTranslation('search')
  const title = thread.sessionTitle ?? thread.snippets[0]?.text ?? ''
  const snippet = thread.snippets[0]

  return (
    <CommandItem
      value={`thread-${thread.sessionId}`}
      onSelect={() => onSelect(thread.sessionId)}
      className="py-1"
      data-testid={`global-search-thread-result-${thread.sessionId}`}
    >
      <Message1Line className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className="truncate text-[13px]"
          data-testid={`global-search-thread-title-${thread.sessionId}`}
        >
          <HighlightedText text={title} ranges={thread.titleRanges} />
        </span>
        {snippet && (
          <span
            className="truncate text-[11px] text-muted-foreground/55"
            data-testid={`global-search-thread-snippet-${thread.sessionId}`}
          >
            <HighlightedText text={snippet.text} ranges={snippet.ranges} />
          </span>
        )}
        {thread.snippets.length === 0 && (
          <span className="text-[11px] text-muted-foreground/50">{t('thread.match.titleOnly')}</span>
        )}
      </span>
    </CommandItem>
  )
}

export function IssueRow({ data: issue, onSelect }: IssueRowProps) {
  return (
    <CommandItem
      value={`issue-${issue.id}`}
      onSelect={() => onSelect(issue.id)}
      data-testid={`global-search-issue-result-${issue.title}`}
    >
      <DotCircleLine className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-[13px]">{issue.title}</span>
    </CommandItem>
  )
}

interface RecentConversationRowProps {
  data: RecentConversation
  onSelect: (sessionId: string) => void
}

export function RecentConversationRow({ data: conversation, onSelect }: RecentConversationRowProps) {
  const { t } = useTranslation('search')
  return (
    <CommandItem
      value={`recent-thread-${conversation.id}`}
      onSelect={() => onSelect(conversation.id)}
      className="py-0.5"
      data-testid={`global-search-recent-conversation-${conversation.id}`}
    >
      <Message1Line className="size-4 shrink-0 text-muted-foreground/65" />
      <span className="min-w-0 flex-1 truncate text-[13px]">{conversation.title || t('thread.untitled')}</span>
    </CommandItem>
  )
}

/**
 * Section header. Sits inside a `CommandGroup` as a small label + count above
 * its items.
 */
export function GroupHeader({
  label,
  count,
}: {
  label: string
  count?: number
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2.5">
      <span className="text-[11px] font-medium text-muted-foreground/45">{label}</span>
      {count != null && count > 0 && (
        <span className="text-[10px] tabular-nums text-muted-foreground/30">{count}</span>
      )}
    </div>
  )
}
