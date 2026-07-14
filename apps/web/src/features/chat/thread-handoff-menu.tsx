import {
  ArrowRightLine as ArrowRightIcon,
  TransferHorizontalLine as HandoffIcon,
} from '@mingcute/react'
import { useMutation } from '@tanstack/react-query'

import { Button } from '~/components/ui/button'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { toastManager } from '~/components/ui/toast'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { openChatSession } from '~/navigation/navigation-commands'

import { threadHandoffMutation } from './api/thread-handoffs'

export function ThreadHandoffMenu({
  sessionId,
  providerTargetId,
  runtimeKind,
  workspaceId,
  disabled,
}: {
  sessionId: string
  providerTargetId: string | null
  runtimeKind: string | null
  workspaceId: string | null
  disabled: boolean
}) {
  const { providerOptions, isLoading } = useProviderTargets({ runtimeKind, workspaceId })
  const handoff = useMutation(threadHandoffMutation())
  const targets = providerOptions.filter(target => target.enabled && target.id !== providerTargetId)

  const handleHandoff = async (destinationProviderTargetId: string) => {
    try {
      const result = await handoff.mutateAsync({
        body: {
          requestId: crypto.randomUUID(),
          sourceSessionId: sessionId,
          destinationProviderTargetId,
        },
      })
      openChatSession(result.session.id)
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Provider handoff failed',
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <Menu>
      <MenuTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            disabled={disabled || handoff.isPending}
            aria-label="Hand off to another provider"
            title="Hand off to another provider"
          >
            <HandoffIcon aria-hidden="true" />
          </Button>
        )}
      />
      <MenuPopup align="end" className="w-64">
        <MenuGroup>
          <MenuGroupLabel>Hand off thread</MenuGroupLabel>
          {targets.map(target => (
            <MenuItem
              key={target.id}
              className="min-h-10 gap-2"
              onClick={() => void handleHandoff(target.id)}
            >
              <span className="min-w-0 flex-1 truncate">{target.name}</span>
              <ArrowRightIcon className="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
            </MenuItem>
          ))}
          {!isLoading && targets.length === 0 && (
            <MenuItem disabled className="min-h-10 text-pretty">
              No other compatible provider is available.
            </MenuItem>
          )}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  )
}
