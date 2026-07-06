import {
  CloseLine as XIcon,
  DashboardLine as LayoutDashboardIcon,
  DeleteLine as TrashIcon,
  More2Line as MoreHorizontalIcon,
  PencilLine as PencilIcon,
  PlusLine as PlusIcon,
} from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import { useActiveSurface } from '~/navigation/active-surface'
import { openKanbanBoard } from '~/navigation/navigation-commands'

import { useAllBoards, useCreateBoard, useDeleteBoard, useUpdateBoard } from './use-kanban'

// ── Create Board Popover ──────────────────────────────────────────────────────

// ── Create Board Dialog ───────────────────────────────────────────────────────

function CreateBoardDialog({ open, onOpenChange, onCreated }: { open: boolean, onOpenChange: (v: boolean) => void, onCreated: (board: { id: string }) => void }) {
  const { t } = useTranslation('kanban')
  const [name, setName] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { workspaces } = useWorkspaces()
  const createBoard = useCreateBoard()

  const selectedWorkspace = workspaces.find(w => w.id === workspaceId)

  useEffect(() => {
    if (!open) {
      return
    }

    setName('')
    if (workspaces.length === 1) {
      setWorkspaceId(workspaces[0].id)
    }
    else if (!workspaceId && workspaces.length > 0) {
      setWorkspaceId(workspaces[0].id)
    }
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open, workspaceId, workspaces])

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed || !workspaceId) {
      return
    }
    createBoard.mutate(
      { workspaceId, name: trimmed },
      {
        onSuccess: (board) => {
          onOpenChange(false)
          onCreated(board)
        },
      },
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
 else if (e.key === 'Escape') {
      onOpenChange(false)
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 bg-black/20"
            onClick={() => onOpenChange(false)}
          />
          <m.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'relative w-full max-w-md rounded-2xl border border-border bg-card',
              'shadow-[var(--shadow-lg)]',
            )}
            onKeyDown={handleKeyDown}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-3.5 pb-0">
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <LayoutDashboardIcon className="size-3.5" />
                <span>{t('board.create.title')}</span>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label={t('board.closeCreateDialog')}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <XIcon className="size-3" />
              </button>
            </div>

            {/* Name input */}
            <div className="px-4 pt-3 pb-2">
              <input
                ref={inputRef}
                value={name}
                onChange={e => setName(e.target.value)}
                data-testid="kanban-new-board-input"
                aria-label={t('board.nameAria')}
                placeholder={t('board.create.placeholder')}
                className="w-full bg-transparent text-[15px] font-medium text-foreground outline-none placeholder:text-muted-foreground/40 leading-snug"
                autoComplete="off"
              />
            </div>

            {/* Workspace selector */}
            {workspaces.length > 1 && (
              <div className="flex items-center gap-1.5 px-4 pb-3">
                <Menu>
                  <MenuTrigger
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1',
                      'text-[12px] text-muted-foreground bg-transparent',
                      'hover:bg-muted/50 hover:text-foreground transition-colors',
                    )}
                  >
                    <span>{selectedWorkspace?.name ?? t('board.create.workspacePlaceholder')}</span>
                  </MenuTrigger>
                  <MenuPopup>
                    {workspaces.map(ws => (
                      <MenuItem key={ws.id} onClick={() => setWorkspaceId(ws.id)}>
                        {ws.name}
                      </MenuItem>
                    ))}
                  </MenuPopup>
                </Menu>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-2 px-4 pb-3.5">
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!name.trim() || !workspaceId || createBoard.isPending}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium',
                  'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
              >
                {t('board.create.action')}
                <kbd className="ml-0.5 rounded border border-primary-foreground/20 bg-primary-foreground/10 px-1 text-[10px] font-sans leading-4">↵</kbd>
              </button>
            </div>
          </m.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// ── Board Item ────────────────────────────────────────────────────────────────

function BoardItem({ board }: { board: { id: string, name: string } }) {
  const { t } = useTranslation('kanban')
  const activeSurface = useActiveSurface()
  const isActive = activeSurface?.kind === 'kanban'
    && activeSurface.route.to === '/kanban/$boardId'
    && activeSurface.route.params.boardId === board.id
  const deleteBoard = useDeleteBoard()
  const updateBoard = useUpdateBoard()
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(board.name)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const handleDelete = () => {
    deleteBoard.mutate(board.id)
  }

  const handleRenameStart = () => {
    setRenameValue(board.name)
    setIsRenaming(true)
    requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
  }

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== board.name) {
      updateBoard.mutate({ id: board.id, patch: { name: trimmed } })
    }
    setIsRenaming(false)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRenameSubmit()
    }
 else if (e.key === 'Escape') {
      setIsRenaming(false)
    }
  }

  return (
    <div
      className={cn(
        'group flex items-center rounded-lg mx-1',
        isActive ? 'bg-accent/80' : 'hover:bg-accent/50',
      )}
      data-testid={`kanban-board-${board.id}`}
    >
      {isRenaming
? (
        <div className="flex-1 flex items-center gap-2 px-2.5 py-1">
          <LayoutDashboardIcon className="size-3.5 shrink-0 !text-muted-foreground/70" />
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
            aria-label={t('board.nameAria')}
            className="flex-1 bg-transparent text-xs text-foreground outline-none border-b border-primary/40"
          />
        </div>
      )
: (
        <button
          type="button"
          onClick={() => openKanbanBoard({ boardId: board.id })}
          onDoubleClick={handleRenameStart}
          className="flex-1 flex items-center gap-2 px-2.5 py-1.5 text-xs text-sidebar-foreground/80"
        >
          <LayoutDashboardIcon className="size-3.5 shrink-0 !text-muted-foreground/70" />
          <span className="truncate">{board.name}</span>
        </button>
      )}

      <Menu>
        <MenuTrigger
          className="shrink-0 flex size-6 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:bg-accent/80 hover:text-foreground mr-1"
          data-testid={`kanban-board-menu-trigger-${board.id}`}
        >
          <MoreHorizontalIcon className="size-3" />
        </MenuTrigger>
        <MenuPopup>
          <MenuItem
            onClick={handleRenameStart}
            data-testid={`kanban-board-rename-${board.id}`}
          >
            <PencilIcon className="size-3.5 mr-2" />
            {t('board.rename')}
          </MenuItem>
          <MenuItem
            onClick={handleDelete}
            variant="destructive"
            data-testid={`kanban-board-delete-${board.id}`}
          >
            <TrashIcon className="size-3.5 mr-2" />
            {t('board.delete')}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  )
}

// ── Main Section ──────────────────────────────────────────────────────────────

export function KanbanSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useTranslation('kanban')
  const boards = useAllBoards()
  const [isCreating, setIsCreating] = useState(false)
  const ready = boards.isSuccess

  return (
    <div
      className="flex flex-col"
      style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 120ms ease', pointerEvents: collapsed ? 'none' : undefined }}
      data-testid="kanban-sidebar"
      data-kanban-sidebar-ready={ready ? 'true' : 'false'}
    >
      <div className="flex items-center px-2.5 py-1.5">
        <span className="flex-1 text-[11px] font-medium text-muted-foreground select-none">{t('board.sectionTitle')}</span>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          aria-label={t('board.addAria')}
          className="size-5 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-accent/50"
          data-testid="kanban-add-board-btn"
        >
          <PlusIcon className="size-3" />
        </button>
      </div>

      <div className="pb-1">
        {boards.data?.length === 0 && (
          <p className="px-5 py-1.5 text-[11px] text-muted-foreground/50">{t('board.empty')}</p>
        )}
        {boards.data?.map(board => (
          <BoardItem key={board.id} board={board} />
        ))}
      </div>

      <CreateBoardDialog
        open={isCreating}
        onOpenChange={setIsCreating}
        onCreated={(board) => {
          openKanbanBoard({ boardId: board.id })
        }}
      />
    </div>
  )
}
