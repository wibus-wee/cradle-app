import {
  ComputerLine as ComputerIcon,
  DownLine as ChevronDownIcon,
  Folder2Line as FolderIcon,
  LoadingLine,
  LockLine as LockIcon,
  Refresh1Line as RefreshIcon,
  WarningLine as WarningIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { cn } from '~/lib/cn'

import type { NodeWorkspaceEntry, NodeWorkspaceTarget } from './node-grouping'

export type NodeWorkspacePickerState = 'connecting' | 'offline' | 'access-denied' | 'error' | 'ready'

export interface NodeWorkspacePickerViewProps {
  /** Merged logical Workspace entries for the selected Node. */
  entries: NodeWorkspaceEntry[]
  state: NodeWorkspacePickerState
  addingTargetKey: string | null
  onRetry: () => void
  onAddWorkspace: (entry: NodeWorkspaceEntry, target: NodeWorkspaceTarget) => void
}

const EASE = 'ease-[cubic-bezier(0.23,1,0.32,1)]'

function originTail(originUrl: string | null): string | null {
  if (!originUrl) {
    return null
  }
  const tail = originUrl.replace(/\.git$/i, '').split('/').filter(Boolean).slice(-2).join('/')
  return tail || null
}

function AddTargetControl({
  entry,
  addingTargetKey,
  onAddWorkspace,
}: {
  entry: NodeWorkspaceEntry
  addingTargetKey: string | null
  onAddWorkspace: (entry: NodeWorkspaceEntry, target: NodeWorkspaceTarget) => void
}) {
  const { t } = useTranslation('nodes')
  const available = entry.targets.filter(target => !target.alreadyAdded)
  const anyAdding = entry.targets.some(
    target => addingTargetKey === `${target.nodeId}:${target.path}`,
  )

  if (entry.targets.every(target => target.alreadyAdded)) {
    return <span className="shrink-0 text-[11px] text-muted-foreground">{t('workspace.added')}</span>
  }

  // Single target: one plain button. Multiple machines: a small menu.
  if (available.length === 1) {
    const target = available[0]
    const adding = addingTargetKey === `${target.nodeId}:${target.path}`
    return (
      <button
        type="button"
        className={cn(
          'flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium',
          'opacity-0 transition-[background-color,opacity,transform] duration-120 group-hover:opacity-100 focus-visible:opacity-100',
          EASE,
          'bg-accent hover:bg-accent/80 active:scale-[0.96]',
        )}
        disabled={adding}
        onClick={() => onAddWorkspace(entry, target)}
        data-testid={`node-workspace-add-${target.nodeId}:${target.path}`}
      >
        {adding && <LoadingLine className="size-3 animate-spin" aria-hidden />}
        {t('workspace.add')}
      </button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] font-medium',
            'opacity-0 transition-[background-color,opacity,transform] duration-120 group-hover:opacity-100 focus-visible:opacity-100',
            'data-[state=open]:opacity-100',
            EASE,
            'bg-accent hover:bg-accent/80 active:scale-[0.96]',
          )}
          disabled={anyAdding}
          data-testid={`node-workspace-add-menu-${entry.key}`}
        >
          {anyAdding && <LoadingLine className="size-3 animate-spin" aria-hidden />}
          {t('workspace.add')}
          <ChevronDownIcon className="size-3" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {available.map(target => (
          <DropdownMenuItem
            key={`${target.nodeId}:${target.path}`}
            onClick={() => onAddWorkspace(entry, target)}
            data-testid={`node-workspace-add-${target.nodeId}:${target.path}`}
          >
            <ComputerIcon className="size-3.5" aria-hidden />
            {t('workspace.onDevice', { nodeName: target.nodeName })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function NodeWorkspacePickerView({
  entries,
  state,
  addingTargetKey,
  onRetry,
  onAddWorkspace,
}: NodeWorkspacePickerViewProps) {
  const { t } = useTranslation('nodes')

  if (state !== 'ready') {
    const status = {
      'access-denied': {
        icon: <LockIcon className="size-5" aria-hidden />,
        title: t('workspace.accessRequired'),
        hint: t('workspace.accessRequiredHint'),
        testId: 'node-workspace-access-denied',
      },
      connecting: {
        icon: <LoadingLine className="size-5 animate-spin" aria-hidden />,
        title: t('workspace.connecting'),
        hint: null,
        testId: 'node-workspace-connecting',
      },
      error: {
        icon: <WarningIcon className="size-5" aria-hidden />,
        title: t('workspace.connectionFailed'),
        hint: t('workspace.connectionFailedHint'),
        testId: 'node-workspace-connection-error',
      },
      offline: {
        icon: <ComputerIcon className="size-5" aria-hidden />,
        title: t('workspace.offline'),
        hint: t('workspace.offlineHint'),
        testId: 'node-workspace-offline',
      },
    }[state]
    const canRetry = state === 'error' || state === 'offline'

    return (
      <div
        className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 py-8 text-center"
        data-testid={status.testId}
      >
        <span className="flex size-11 items-center justify-center rounded-lg bg-accent text-muted-foreground">
          {status.icon}
        </span>
        <p className="text-[12px] font-medium">{status.title}</p>
        {status.hint && (
          <p className="max-w-72 text-pretty text-[12px] leading-relaxed text-muted-foreground">
            {status.hint}
          </p>
        )}
        {canRetry && (
          <button
            type="button"
            className={cn(
              'mt-1 flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium',
              'transition-[background-color,transform] duration-120',
              EASE,
              'hover:bg-accent active:scale-[0.96]',
            )}
            onClick={onRetry}
          >
            <RefreshIcon className="size-3.5" aria-hidden />
            {state === 'offline' ? t('action.reconnect') : t('action.retry')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col" data-testid="node-workspace-picker">
      <div className="flex min-w-0 flex-col">
        {entries.length === 0 && (
          <p className="px-2 py-2 text-[12px] text-muted-foreground" data-testid="node-workspace-empty">
            {t('workspace.empty')}
          </p>
        )}
        {entries.map((entry, index) => (
          <div
            key={entry.key}
            className={cn(
              'group flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2',
              'motion-safe:animate-[node-row-in_180ms_cubic-bezier(0.23,1,0.32,1)_both]',
              'transition-colors duration-120',
              EASE,
              'hover:bg-accent/50',
            )}
            style={{ animationDelay: `${index * 40}ms` }}
            data-testid={`node-workspace-${entry.key}`}
          >
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{entry.name}</div>
              {originTail(entry.originUrl) && (
                <div className="truncate text-[11px] text-muted-foreground">
                  {originTail(entry.originUrl)}
                </div>
              )}
            </div>
            <AddTargetControl
              entry={entry}
              addingTargetKey={addingTargetKey}
              onAddWorkspace={onAddWorkspace}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
