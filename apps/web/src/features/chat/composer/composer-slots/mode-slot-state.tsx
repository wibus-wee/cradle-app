import { Settings2Line as Settings2Icon } from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'

import type { ChatRuntimeModeUiSlotState } from '../../capabilities/chat-capabilities'
import { runtimeUiSlotStatesQueryKey } from '../../capabilities/chat-capabilities'
import { updateRuntimeMode } from '../../commands/chat-response-command'
import { ComposerSlotShell } from './composer-slot-shell'

export function ModeSlotState({
  state,
  sessionId,
  className,
}: {
  state: ChatRuntimeModeUiSlotState
  sessionId: string
  className?: string
}) {
  const queryClient = useQueryClient()
  const [pendingModeId, setPendingModeId] = useState<string | null>(null)

  const selectMode = async (modeId: string) => {
    if (!modeId || modeId === state.currentModeId || pendingModeId) {
      return
    }
    setPendingModeId(modeId)
    try {
      await updateRuntimeMode({ sessionId, modeId })
      await queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(sessionId) })
    }
    finally {
      setPendingModeId(null)
    }
  }

  return (
    <ComposerSlotShell
      stateName="mode"
      testId="runtime-mode-slot"
      className={cn('py-1.5', className)}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Settings2Icon className="size-3.5 shrink-0" aria-hidden="true" />
          <span>Mode</span>
        </div>
        <ToggleGroup
          type="single"
          value={pendingModeId ?? state.currentModeId}
          variant="outline"
          size="sm"
          disabled={pendingModeId !== null}
          className="max-w-full overflow-x-auto"
          onValueChange={value => void selectMode(value)}
        >
          {state.modes.map(mode => (
            <ToggleGroupItem
              key={mode.id}
              value={mode.id}
              title={mode.description || mode.name}
              className="h-7 max-w-40 truncate text-xs"
            >
              {mode.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </ComposerSlotShell>
  )
}
