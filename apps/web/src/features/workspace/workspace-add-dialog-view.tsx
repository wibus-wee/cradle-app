import {
  ArrowRightLine as ArrowRightIcon,
  ComputerLine as ComputerIcon,
  DownLine as ChevronDownIcon,
  FolderOpenLine as FolderOpenIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { cn } from '~/lib/cn'

export interface WorkspaceAddDialogViewProps {
  open: boolean
  creating: boolean
  onOpenChange: (open: boolean) => void
  onAddLocal: () => void
  /** Node-dimension picker (merged cross-Node workspace view), when Nodes exist. */
  nodePicker?: ReactNode
}

const EASE = 'ease-[cubic-bezier(0.23,1,0.32,1)]'
const ROW_IN = 'motion-safe:animate-[node-row-in_220ms_cubic-bezier(0.23,1,0.32,1)_both]'

function RowShell({
  children,
  className,
  ...props
}: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left',
        'transition-[background-color,transform] duration-150',
        EASE,
        'hover:bg-accent/60 active:scale-[0.99]',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

function RowIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground">
      {children}
    </span>
  )
}

function RowText({ title, description }: { title: string, description?: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-[13px] font-medium">{title}</span>
      {description && (
        <span className="text-pretty text-[12px] leading-snug text-muted-foreground">
          {description}
        </span>
      )}
    </span>
  )
}

export function WorkspaceAddDialogView({
  open,
  creating,
  onOpenChange,
  onAddLocal,
  nodePicker,
}: WorkspaceAddDialogViewProps) {
  const { t } = useTranslation('workspace')
  const { t: tNodes } = useTranslation('nodes')
  const [remoteExpanded, setRemoteExpanded] = useState(true)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-balance">
            {t('workspace.dialog.addWorkspaceTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('workspace.dialog.addWorkspaceDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-1">
          <RowShell
            disabled={creating}
            onClick={() => {
              onOpenChange(false)
              onAddLocal()
            }}
            className={ROW_IN}
            style={{ animationDelay: '40ms' }}
            data-testid="workspace-add-local"
          >
            <RowIcon>
              <FolderOpenIcon className="size-4" aria-hidden />
            </RowIcon>
            <RowText
              title={t('workspace.dialog.addWorkspaceLocalTitle')}
              description={t('workspace.dialog.addWorkspaceLocalDescription')}
            />
            <ArrowRightIcon
              className={cn(
                'size-4 shrink-0 -translate-x-1 text-muted-foreground/40 opacity-0',
                'transition-[opacity,transform] duration-150',
                EASE,
                'group-hover:translate-x-0 group-hover:text-muted-foreground group-hover:opacity-100',
              )}
              aria-hidden
            />
          </RowShell>

          {nodePicker && (
            <div
              className={cn('flex min-w-0 flex-col', ROW_IN)}
              style={{ animationDelay: '100ms' }}
            >
              <RowShell
                onClick={() => setRemoteExpanded(value => !value)}
                aria-expanded={remoteExpanded}
                data-testid="workspace-add-remote-toggle"
              >
                <RowIcon>
                  <ComputerIcon className="size-4" aria-hidden />
                </RowIcon>
                <RowText
                  title={tNodes('workspace.addFromDevice')}
                  description={tNodes('workspace.addFromDeviceDescription')}
                />
                <ChevronDownIcon
                  className={cn(
                    'size-4 shrink-0 text-muted-foreground/40',
                    'transition-[color,transform] duration-200',
                    EASE,
                    'group-hover:text-muted-foreground',
                    remoteExpanded && 'rotate-180',
                  )}
                  aria-hidden
                />
              </RowShell>
              <div
                className={cn(
                  'grid transition-[grid-template-rows] duration-200',
                  EASE,
                  remoteExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                )}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="px-1 pb-1 pt-0.5">{nodePicker}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
