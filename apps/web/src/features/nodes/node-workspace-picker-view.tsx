import {
  ArrowRightLine as ArrowRightIcon,
  ComputerLine as ComputerIcon,
  DownLine as ChevronDownIcon,
  Folder2Line as FolderIcon,
  LoadingLine,
  Refresh1Line as RefreshIcon,
} from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import type { NodeWorkspaceEntry, NodeWorkspaceTarget } from './node-grouping'
import type { FabricNode } from './types'

export interface NodeWorkspacePickerViewProps {
  /** Nodes that can be browsed (excluding the local device). */
  nodes: FabricNode[]
  /** Currently selected Node id, if any. */
  selectedNodeId: string | null
  /** Merged logical Workspace entries for the selected scope. */
  entries: NodeWorkspaceEntry[]
  loading: boolean
  /** True when the selected Node is offline (browse blocked). */
  selectedNodeOffline: boolean
  addingTargetKey: string | null
  onSelectNode: (nodeId: string) => void
  onReconnect: (nodeId: string) => void
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
          'opacity-0 transition-all duration-120 group-hover:opacity-100 focus-visible:opacity-100',
          EASE,
          'bg-accent hover:bg-accent/80 active:scale-[0.97]',
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
            'opacity-0 transition-all duration-120 group-hover:opacity-100 focus-visible:opacity-100',
            'data-[state=open]:opacity-100',
            EASE,
            'bg-accent hover:bg-accent/80 active:scale-[0.97]',
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
  nodes,
  selectedNodeId,
  entries,
  loading,
  selectedNodeOffline,
  addingTargetKey,
  onSelectNode,
  onReconnect,
  onAddWorkspace,
}: NodeWorkspacePickerViewProps) {
  const { t } = useTranslation('nodes')
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex min-w-0 flex-col" data-testid="node-workspace-picker">
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left',
          'text-[12px] font-medium text-muted-foreground',
          'transition-colors duration-120',
EASE,
          'hover:text-foreground',
        )}
        onClick={() => setExpanded(value => !value)}
        data-testid="node-workspace-picker-toggle"
        aria-expanded={expanded}
      >
        <ArrowRightIcon
          className={cn('size-3 transition-transform duration-150', EASE, expanded && 'rotate-90')}
          aria-hidden
        />
        {t('workspace.addFromDevice')}
      </button>

      {expanded && (
        <div className="flex min-w-0 flex-col gap-2.5 px-1 pb-1 pt-1">
          <div className="flex flex-wrap items-center gap-1">
            {nodes.map((node) => {
              const online = node.status === 'online'
              const selected = selectedNodeId === node.nodeId
              const chip = (
                <button
                  key={node.nodeId}
                  type="button"
                  disabled={!online}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px]',
                    'transition-all duration-150',
EASE,
                    'active:scale-[0.97]',
                    selected
                      ? 'border-foreground/25 bg-accent font-medium text-foreground'
                      : 'border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                    !online && 'cursor-not-allowed opacity-50',
                  )}
                  onClick={() => onSelectNode(node.nodeId)}
                  data-testid={`node-pick-${node.nodeId}`}
                >
                  <span
                    className={cn('size-1.5 rounded-full', online ? 'bg-green-500' : 'bg-muted-foreground/40')}
                    aria-hidden
                  />
                  {node.displayName}
                </button>
              )
              if (online) {
                return chip
              }
              return (
                <Tooltip key={node.nodeId}>
                  <TooltipTrigger render={chip} />
                  <TooltipContent>{t('workspace.offlineHint')}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>

          {selectedNodeId && selectedNodeOffline && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-muted-foreground">
                {t('workspace.offlineHint')}
              </span>
              <button
                type="button"
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium',
                  'transition-all duration-120',
EASE,
                  'hover:bg-accent active:scale-[0.97]',
                )}
                onClick={() => onReconnect(selectedNodeId)}
              >
                <RefreshIcon className="size-3.5" aria-hidden />
                {t('action.reconnect')}
              </button>
            </div>
          )}

          {selectedNodeId && !selectedNodeOffline && (
            <div className="flex min-w-0 flex-col">
              {loading && (
                <div className="flex items-center gap-2 px-1 py-2 text-[12px] text-muted-foreground">
                  <LoadingLine className="size-3.5 animate-spin" aria-hidden />
                  {t('workspace.loading')}
                </div>
              )}
              {!loading && entries.length === 0 && (
                <p className="px-1 py-2 text-[12px] text-muted-foreground">
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
      )}
    </div>
  )
}
