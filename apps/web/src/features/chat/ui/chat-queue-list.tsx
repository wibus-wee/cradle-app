// Shared compact queue controls for Chat Session continuation items.
import {
  ArrowDownLine as ArrowDownIcon,
  ArrowUpLine as ArrowUpIcon,
  CloseLine as XIcon,
  DotsVerticalLine as GripVerticalIcon,
  PencilLine as EditIcon,
} from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import { useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import { cn } from '~/lib/cn'

import type { ChatQueueItem } from '../commands/chat-response-command'
import {
  formatRuntimeSettingsSummary,
  readComposerRuntimeSettingsFields,
  resolveRuntimeCatalogItem,
} from '../runtime/runtime-settings-presenter'

interface ChatQueueListProps {
  items: ChatQueueItem[]
  runtimeKind?: RuntimeKind | null
  onCancel: (queueItemId: string) => void
  onReorder: (queueItemIds: string[]) => void
  onEdit: (item: ChatQueueItem) => void
  editingItemId?: string | null
  className?: string
  title?: string
}

export function ChatQueueList({
  items,
  runtimeKind = null,
  onCancel,
  onReorder,
  onEdit,
  editingItemId,
  className,
  title,
}: ChatQueueListProps) {
  const { t } = useTranslation('chat')
  const { runtimes } = useRuntimeCatalog()
  const runtimeCatalogItem = resolveRuntimeCatalogItem(runtimes, runtimeKind)
  const runtimeSettingsFields = readComposerRuntimeSettingsFields(runtimeCatalogItem)
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  // Running items are already promoted to the live turn — drop them from the
  // queue list so the user does not see a stale "running" pill while the
  // follow-up has been pushed up.
  const visibleItems = items?.filter(item => item.status === 'pending') ?? []
  const pendingItems = visibleItems
  if (visibleItems.length === 0) {
    return null
  }

  const reorderByDrop = (targetItemId: string) => {
    if (!draggedItemId || draggedItemId === targetItemId) {
      return
    }
    const fromIndex = pendingItems.findIndex(item => item.id === draggedItemId)
    const toIndex = pendingItems.findIndex(item => item.id === targetItemId)
    if (fromIndex < 0 || toIndex < 0) {
      return
    }
    const nextItems = [...pendingItems]
    const movedItem = nextItems[fromIndex]
    if (!movedItem) {
      return
    }
    nextItems.splice(fromIndex, 1)
    nextItems.splice(toIndex, 0, movedItem)
    onReorder(nextItems.map(item => item.id))
  }

  const moveItem = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= pendingItems.length) {
      return
    }
    const nextItems = [...pendingItems]
    const currentItem = nextItems[index]
    nextItems[index] = nextItems[nextIndex]
    nextItems[nextIndex] = currentItem
    onReorder(nextItems.map(item => item.id))
  }

  return (
    <ul
      className={cn('m-0 list-none rounded-md border border-border/50 bg-background/90 px-2 py-2', className)}
      data-testid="chat-queue-list"
      aria-live="polite"
    >
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          {title ?? t('continuation.queue.title')}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">{visibleItems.length}</span>
      </div>
      <div className="space-y-1">
        {visibleItems.map((item) => {
          const pendingIndex = pendingItems.findIndex(candidate => candidate.id === item.id)
          const isPending = pendingIndex >= 0
          const itemLabel = item.text || (
            item.files.length > 0
              ? t('continuation.queue.attachmentLabel', { count: item.files.length })
              : t('continuation.queue.emptyLabel')
          )
          const runtimeSettingsLabel = formatRuntimeSettingsSummary(
            t,
            runtimeSettingsFields,
            item.runtimeSettings,
          )
          return (
            <li
              key={item.id}
              className={cn(
                'flex items-center gap-2 rounded-md bg-muted/35 px-2 py-1.5 text-xs transition-colors',
                draggedItemId === item.id && 'bg-muted/70 opacity-70',
                editingItemId === item.id && 'bg-muted/60 ring-1 ring-primary/40',
              )}
              data-testid="chat-queue-item"
              draggable={isPending}
              onDragStart={(event) => {
                if (!isPending) {
                  event.preventDefault()
                  return
                }
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', item.id)
                setDraggedItemId(item.id)
              }}
              onDragOver={(event) => {
                if (isPending && draggedItemId && draggedItemId !== item.id) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }
              }}
              onDrop={(event) => {
                if (!isPending) {
                  return
                }
                event.preventDefault()
                reorderByDrop(item.id)
                setDraggedItemId(null)
              }}
              onDragEnd={() => setDraggedItemId(null)}
            >
              <span className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/60 active:cursor-grabbing">
                <GripVerticalIcon className="size-3.5" aria-hidden="true" />
              </span>
              <span
                className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
              >
                {t('continuation.mode.queue')}
              </span>
              <span className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
                {runtimeSettingsLabel}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground/85">
                {itemLabel}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={editingItemId === item.id}
                onClick={() => onEdit(item)}
                aria-label={t('continuation.queue.edit', { label: itemLabel })}
                data-testid="chat-queue-item-edit"
              >
                <EditIcon className="size-3" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={pendingIndex === 0}
                onClick={() => moveItem(pendingIndex, -1)}
                aria-label={t('continuation.queue.moveUp', { label: itemLabel })}
              >
                <ArrowUpIcon className="size-3" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={pendingIndex === pendingItems.length - 1}
                onClick={() => moveItem(pendingIndex, 1)}
                aria-label={t('continuation.queue.moveDown', { label: itemLabel })}
              >
                <ArrowDownIcon className="size-3" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onCancel(item.id)}
                aria-label={t('continuation.queue.cancel', { label: itemLabel })}
              >
                <XIcon className="size-3" aria-hidden="true" />
              </Button>
            </li>
          )
        })}
      </div>
    </ul>
  )
}
