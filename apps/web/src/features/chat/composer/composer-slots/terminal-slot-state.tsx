import {
  RightSmallLine as ChevronRightIcon,
  StopCircleLine as CircleStopIcon,
  TerminalLine as TerminalIcon,
} from '@mingcute/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { cn } from '~/lib/cn'

import type {
  ChatRuntimeBackgroundTerminal,
  ChatRuntimeTerminalUiSlotState,
} from '../../capabilities/chat-capabilities'
import {
  runtimeUiSlotStatesQueryKey,
  terminateChatRuntimeBackgroundTerminal,
} from '../../capabilities/chat-capabilities'
import { ComposerSlotIconAction, ComposerSlotShell } from './composer-slot-shell'

export function TerminalSlotState({
  state,
  sessionId,
  className,
}: {
  state: ChatRuntimeTerminalUiSlotState
  sessionId: string
  className?: string
}) {
  const queryClient = useQueryClient()
  const rows = state.backgroundTerminals
  const [open, setOpen] = useState(false)
  const terminate = useMutation({
    mutationFn: (processId: string) => terminateChatRuntimeBackgroundTerminal(sessionId, processId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(sessionId) })
    },
  })

  if (rows.length === 0) {
    return null
  }

  const summary
    = rows.length === 1
      ? rows[0]!.command
      : `${rows.length} background processes`

  return (
    <ComposerSlotShell stateName="terminal" testId="terminal-slot" className={className}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="h-auto w-full min-w-0 justify-start gap-2 p-0 text-left hover:bg-transparent"
          >
            <TerminalIcon
              className="size-3.5 shrink-0 !text-emerald-600 dark:!text-emerald-400"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80">
              {summary}
            </span>
            <ChevronRightIcon
              className={cn('size-3.5 shrink-0 !text-muted-foreground transition-transform', {
                'rotate-90': open,
              })}
              aria-hidden="true"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1.5 grid min-w-0 gap-1.5">
            {rows.map(terminal => (
              <BackgroundTerminalRow
                key={terminal.processId}
                terminal={terminal}
                terminating={terminate.isPending && terminate.variables === terminal.processId}
                onTerminate={() => terminate.mutate(terminal.processId)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </ComposerSlotShell>
  )
}

function BackgroundTerminalRow({
  terminal,
  terminating,
  onTerminate,
}: {
  terminal: ChatRuntimeBackgroundTerminal
  terminating: boolean
  onTerminate: () => void
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-muted/35 px-2 py-1.5 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.04)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
      <div className="grid min-w-0 gap-1">
        <div className="min-w-0 truncate font-mono text-[11px] leading-4 text-foreground/85">
          {terminal.command}
        </div>
        <div className="min-w-0 truncate text-[10px] leading-3 text-muted-foreground">
          {formatCwd(terminal.cwd)}
        </div>
      </div>
      <ComposerSlotIconAction
        label="Terminate background terminal"
        disabled={terminating}
        onClick={onTerminate}
      >
        <CircleStopIcon
          className={cn('size-3.5', terminating ? '!text-muted-foreground' : '!text-destructive')}
          aria-hidden="true"
        />
      </ComposerSlotIconAction>
    </div>
  )
}

function formatCwd(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  if (parts.length <= 2) {
    return cwd
  }
  return `.../${parts.slice(-2).join('/')}`
}
