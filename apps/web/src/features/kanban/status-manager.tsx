import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import { arrayMove } from '@dnd-kit/helpers'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { DeleteLine as TrashIcon, DotsVerticalLine as GripVerticalIcon } from '@mingcute/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { cn } from '~/lib/cn'

import { StatusIcon } from './shared/status-icon'
import { useCreateStatus, useDeleteStatus, useReorderStatuses, useStatuses, useUpdateStatus } from './use-kanban'
import type { StatusCategory } from './use-view-config'

interface StatusManagerProps {
  workspaceId: string
}

export function StatusManager({ workspaceId }: StatusManagerProps) {
  const { t } = useTranslation('kanban')
  const statuses = useStatuses(workspaceId)
  const createStatus = useCreateStatus()
  const updateStatus = useUpdateStatus()
  const deleteStatus = useDeleteStatus()
  const reorderStatuses = useReorderStatuses()
  const [newName, setNewName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleAdd = () => {
    const name = newName.trim()
    if (!name) {
      return
    }
    createStatus.mutate(
      { workspaceId, name },
      { onSuccess: () => setNewName('') },
    )
  }

  const handleDelete = (statusId: string) => {
    deleteStatus.mutate({ id: statusId, workspaceId })
  }

  const handleRename = (statusId: string, name: string) => {
    updateStatus.mutate({ id: statusId, workspaceId, patch: { name } })
  }

  const handleDragEnd = (event: { operation: { source: { id: string | number } | null, target: { id: string | number } | null }, canceled: boolean }) => {
    const { operation, canceled } = event
    if (canceled) { return }
    const { source, target } = operation
    if (!source || !target || source.id === target.id) { return }
    const items = statuses.data ?? []
    const oldIdx = items.findIndex(s => s.id === source.id)
    const newIdx = items.findIndex(s => s.id === target.id)
    if (oldIdx === -1 || newIdx === -1) { return }
    const reordered = arrayMove(items, oldIdx, newIdx)
    reorderStatuses.mutate({ workspaceId, orderedIds: reordered.map(s => s.id) })
  }

  return (
    <div data-testid="status-manager" className="w-72 rounded-lg border border-border bg-popover p-3 shadow-lg">
      <h4 className="mb-2 text-[12px] font-medium text-muted-foreground">{t('statusManager.title')}</h4>

      {/* Add new status */}
      <div className="mb-3 flex items-center gap-1">
        <Input
          ref={inputRef}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAdd()
            }
          }}
          placeholder={t('statusManager.addPlaceholder')}
          data-testid="status-name-input"
          className="h-7 flex-1 text-[13px]"
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[12px]"
          onClick={handleAdd}
          disabled={!newName.trim()}
        >
          {t('statusManager.add')}
        </Button>
      </div>

      {/* Status list */}
      <DragDropProvider
        sensors={defaults => [
          ...defaults.filter(sensor => sensor !== PointerSensor),
          PointerSensor.configure({
            activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 3 })],
          }),
        ]}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-col gap-0.5">
          {statuses.data?.map((status, index) => (
            <SortableStatusRow
              key={status.id}
              id={status.id}
              index={index}
              name={status.name}
              category={(status.category ?? 'unstarted') as StatusCategory}
              onRename={name => handleRename(status.id, name)}
              onDelete={() => handleDelete(status.id)}
            />
          ))}
        </div>
      </DragDropProvider>
    </div>
  )
}

function SortableStatusRow({
  id,
  index,
  name,
  category,
  onRename,
  onDelete,
}: {
  id: string
  index: number
  name: string
  category: StatusCategory
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const sortable = useSortable({ id, index })
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) {
      return
    }
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [editing])

  const handleConfirm = () => {
    const trimmed = inputRef.current?.value.trim() ?? ''
    if (trimmed && trimmed !== name) {
      onRename(trimmed)
    }
    setEditing(false)
  }

  return (
    <div
      ref={sortable.ref}
      data-testid={`status-row-${id}`}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted/50',
        sortable.isDragging && 'opacity-50',
      )}
    >
      <div
        data-testid={`status-drag-${id}`}
        className="cursor-grab text-muted-foreground/40 touch-none"
      >
        <GripVerticalIcon className="size-3" />
      </div>

      <StatusIcon category={category} size={12} />

      {editing
? (
        <input
          ref={inputRef}
          data-testid={`status-input-${id}`}
          defaultValue={name}
          aria-label="Status name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleConfirm()
            }
            else if (e.key === 'Escape') {
              setEditing(false)
            }
          }}
          onBlur={handleConfirm}
          className="flex-1 bg-transparent text-[13px] outline-none"
        />
      )
: (
        <button
          type="button"
          data-testid={`status-name-${id}`}
          aria-label={`Rename ${name}`}
          onClick={() => setEditing(true)}
          className="min-w-0 flex-1 cursor-text rounded-sm bg-transparent p-0 text-left text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {name}
        </button>
      )}

      <button
        type="button"
        data-testid={`status-delete-${id}`}
        aria-label={`Delete ${name}`}
        onClick={onDelete}
        className="flex size-6 items-center justify-center rounded-sm text-muted-foreground/40 transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <TrashIcon className="size-3" />
      </button>
    </div>
  )
}
