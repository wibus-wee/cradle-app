import {
  ComputerLine as ComputerIcon,
  DownLine as ChevronDownIcon,
  Folder2Line as FolderIcon,
  LoadingLine,
  Refresh1Line as RefreshIcon,
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

export interface NodeWorkspacePickerViewProps {
  /** Merged logical Workspace entries for the selected Node. */
  entries: NodeWorkspaceEntry[]
  loading: boolean
  /** True when the selected Node is offline (browse blocked). */
  selectedNodeOffline: boolean
  addingTargetKey: string | null
  onReconnect: () => void
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
  loading,
  selectedNodeOffline,
  addingTargetKey,
  onReconnect,
  onAddWorkspace,
}: NodeWorkspacePickerViewProps) {
  const { t } = useTranslation('nodes')

  return (
    <div className="flex min-w-0 flex-col" data-testid="node-workspace-picker">
      {selectedNodeOffline
        ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
              <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-muted-foreground">
                <ComputerIcon className="size-5" aria-hidden />
              </span>
              <p className="text-pretty text-[12px] leading-relaxed text-muted-foreground">
                {t('workspace.offlineHint')}
              </p>
              <button
                type="button"
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium',
                  'transition-[background-color,transform] duration-120',
                  EASE,
                  'hover:bg-accent active:scale-[0.96]',
                )}
                onClick={onReconnect}
              >
                <RefreshIcon className="size-3.5" aria-hidden />
                {t('action.reconnect')}
              </button>
            </div>
          )
        : (
            <div className="flex min-w-0 flex-col">
              {loading && (
                <div className="flex items-center gap-2 px-2 py-2 text-[12px] text-muted-foreground">
                  <LoadingLine className="size-3.5 animate-spin" aria-hidden />
                  {t('workspace.loading')}
                </div>
              )}
              {!loading && entries.length === 0 && (
                <p className="px-2 py-2 text-[12px] text-muted-foreground">
                  {t('workspace.empty')}
                </p>
              )}
              {!loading
                && entries.map((entry, index) => (
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
          )}
    </div>
  )
}
