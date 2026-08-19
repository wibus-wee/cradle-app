import {
  ComputerLine as ComputerIcon,
  FolderOpenLine as FolderOpenIcon,
  LoadingLine,
} from '@mingcute/react'
import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import type { FabricNode } from '~/features/nodes/types'
import { cn } from '~/lib/cn'

export interface WorkspaceAddDialogViewProps {
  open: boolean
  creating: boolean
  onOpenChange: (open: boolean) => void
  onAddLocal: () => void
  /** Remote Nodes listed in the source rail (excluding the local device). */
  nodes?: FabricNode[]
  /** Selected source: `null` is the local device, otherwise a Node id. */
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string | null) => void
  /** Workspace list pane for the selected Node. */
  nodePane?: ReactNode
}

const EASE = 'ease-[cubic-bezier(0.23,1,0.32,1)]'
const PANE_IN = 'motion-safe:animate-[node-row-in_200ms_cubic-bezier(0.23,1,0.32,1)_both]'
const PILL_SPRING = { type: 'spring', stiffness: 600, damping: 40 } as const

function SourceItem({
  icon,
  label,
  selected,
  trailing,
  onClick,
  testId,
}: {
  icon: ReactNode
  label: string
  selected: boolean
  trailing?: ReactNode
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      title={label}
      className={cn(
        'relative flex h-9 w-full items-center rounded-lg px-2.5 text-[13px]',
        'transition-colors duration-120',
        EASE,
        selected
          ? 'font-medium text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {selected && (
        <m.span
          layoutId="workspace-add-source-pill"
          className="absolute inset-0 rounded-lg bg-accent"
          transition={PILL_SPRING}
          aria-hidden
        />
      )}
      <span className="relative flex min-w-0 flex-1 items-center gap-2">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      {trailing && <span className="relative shrink-0">{trailing}</span>}
    </button>
  )
}

export function WorkspaceAddDialogView({
  open,
  creating,
  onOpenChange,
  onAddLocal,
  nodes = [],
  selectedNodeId = null,
  onSelectNode,
  nodePane,
}: WorkspaceAddDialogViewProps) {
  const { t } = useTranslation('workspace')
  const { t: tNodes } = useTranslation('nodes')
  const hasRemote = nodes.length > 0
  const showNodePane = hasRemote && selectedNodeId !== null && nodePane

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="px-6 pb-4 pt-5">
          <DialogTitle className="text-balance">
            {t('workspace.dialog.addWorkspaceTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('workspace.dialog.addWorkspaceDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[420px] min-h-0">
          {hasRemote && (
            <div className="flex w-56 shrink-0 flex-col gap-0.5 bg-muted/40 p-2.5">
              <SourceItem
                icon={<FolderOpenIcon className="size-4 shrink-0" aria-hidden />}
                label={t('workspace.dialog.addWorkspaceLocalHost')}
                selected={selectedNodeId === null}
                onClick={() => onSelectNode?.(null)}
                testId="workspace-add-source-local"
              />
              <p className="px-2 pb-1 pt-2.5 text-[11px] font-medium text-muted-foreground/70">
                {tNodes('workspace.addFromDevice')}
              </p>
              {nodes.map(node => (
                <SourceItem
                  key={node.nodeId}
                  icon={<ComputerIcon className="size-4 shrink-0" aria-hidden />}
                  label={node.displayName}
                  selected={selectedNodeId === node.nodeId}
                  trailing={(
                    <span
                      className={cn(
                        'block size-1.5 rounded-full',
                        node.status === 'online' ? 'bg-green-500' : 'bg-muted-foreground/40',
                      )}
                      aria-hidden
                    />
                  )}
                  onClick={() => onSelectNode?.(node.nodeId)}
                  testId={`node-pick-${node.nodeId}`}
                />
              ))}
            </div>
          )}

          <div className="min-w-0 flex-1 overflow-y-auto">
            <div key={selectedNodeId ?? 'local'} className={cn('h-full', PANE_IN)}>
              {showNodePane
                ? <div className="p-2">{nodePane}</div>
                : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center">
                      <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-foreground">
                        <FolderOpenIcon className="size-5" aria-hidden />
                      </span>
                      <div className="space-y-1">
                        <p className="text-[13px] font-medium">
                          {t('workspace.dialog.addWorkspaceLocalTitle')}
                        </p>
                        <p className="mx-auto max-w-60 text-pretty text-[12px] leading-relaxed text-muted-foreground">
                          {t('workspace.dialog.addWorkspaceLocalDescription')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={creating}
                        onClick={() => {
                          onOpenChange(false)
                          onAddLocal()
                        }}
                        className={cn('transition-transform duration-120 active:scale-[0.97]', EASE)}
                        data-testid="workspace-add-local"
                      >
                        {creating && <LoadingLine className="size-3.5 animate-spin" aria-hidden />}
                        {t('workspace.dialog.addWorkspaceChooseLocal')}
                      </Button>
                    </div>
                  )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
