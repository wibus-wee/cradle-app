import {
  ArrowRightLine as ArrowRightIcon,
  LeftSmallLine as BackIcon,
  TransferHorizontalLine as HandoffIcon,
} from '@mingcute/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { ProviderIcon, RuntimeIcon } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { ScrollArea } from '~/components/ui/scroll-area'
import { toastManager } from '~/components/ui/toast'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import type { RuntimeCatalogItem } from '~/features/agent-runtime/use-runtime-catalog'
import {
  listRuntimeCatalogForSurface,
  useRuntimeCatalog,
} from '~/features/agent-runtime/use-runtime-catalog'
import { cn } from '~/lib/cn'
import { openChatSession } from '~/navigation/navigation-commands'

import { threadHandoffMutation } from './api/thread-handoffs'

const itemClassName = 'h-8 w-full justify-start gap-2 px-2 py-0 text-left text-xs font-normal'

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
  const [open, setOpen] = useState(false)
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeCatalogItem | null>(null)
  const runtimeCatalog = useRuntimeCatalog()
  const runtimes = useMemo(
    () => listRuntimeCatalogForSurface(runtimeCatalog.runtimes, 'chat').filter(runtime => (
      runtime.sessionLaunchMode === 'runtime-provider'
      && (runtime.providerBinding ?? 'required') !== 'none'
    )),
    [runtimeCatalog.runtimes],
  )
  const providerBinding = selectedRuntime?.providerBinding ?? 'required'
  const requiresProviderTarget = providerBinding === 'required'
  const { providerOptions, isLoading: providersLoading } = useProviderTargets({
    runtimeKind: selectedRuntime?.runtimeKind,
    workspaceId,
    enabled: open && selectedRuntime !== null && requiresProviderTarget,
  })
  const handoff = useMutation(threadHandoffMutation())
  const targets = providerOptions.filter(target => (
    target.enabled
    && (selectedRuntime?.runtimeKind !== runtimeKind || target.id !== providerTargetId)
  ))

  const handleHandoff = async (
    destinationRuntimeKind: string,
    destinationProviderTargetId: string | null,
  ) => {
    try {
      const result = await handoff.mutateAsync({
        body: {
          requestId: crypto.randomUUID(),
          sourceSessionId: sessionId,
          destinationRuntimeKind,
          destinationProviderTargetId,
        },
      })
      setOpen(false)
      openChatSession(result.session.id)
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Thread handoff failed',
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setSelectedRuntime(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            disabled={disabled || handoff.isPending}
            aria-label="Hand off thread"
            title="Hand off thread"
          >
            <HandoffIcon aria-hidden="true" />
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-72 gap-0 p-1">
        {selectedRuntime
          ? (
              <>
                <div className="flex h-8 items-center gap-1 px-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Back to runtimes"
                    onClick={() => setSelectedRuntime(null)}
                  >
                    <BackIcon aria-hidden="true" />
                  </Button>
                  <RuntimeIcon icon={selectedRuntime.icon} className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {selectedRuntime.label}
                  </span>
                </div>
                {requiresProviderTarget
                  ? (
                      <ScrollArea className="max-h-56" viewportClassName="max-h-56">
                        <div className="flex flex-col gap-0.5 py-0.5">
                          {targets.map(target => (
                            <Button
                              key={target.id}
                              type="button"
                              variant="ghost"
                              disabled={handoff.isPending}
                              className={cn(itemClassName)}
                              onClick={() => void handleHandoff(selectedRuntime.runtimeKind, target.id)}
                            >
                              <ProviderIcon
                                iconSlug={target.iconSlug}
                                presetId={target.providerKind}
                                className="size-3.5 shrink-0"
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {target.name}
                              </span>
                              <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                            </Button>
                          ))}
                          {!providersLoading && targets.length === 0 && (
                            <p className="px-2 py-2 text-pretty text-xs text-muted-foreground">
                              No compatible connection is available for this runtime.
                            </p>
                          )}
                          {providersLoading && (
                            <p className="px-2 py-2 text-xs text-muted-foreground">Loading connections...</p>
                          )}
                        </div>
                      </ScrollArea>
                    )
                  : (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={handoff.isPending}
                        className={cn(itemClassName, 'h-auto min-h-8 py-1.5')}
                        onClick={() => void handleHandoff(selectedRuntime.runtimeKind, null)}
                      >
                        <RuntimeIcon icon={selectedRuntime.icon} className="size-3.5 shrink-0" />
                        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                          <span>Runtime-managed connection</span>
                          <span className="text-[11px] font-normal text-muted-foreground">
                            {selectedRuntime.label}
{' '}
manages its own providers.
                          </span>
                        </span>
                        <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </Button>
                    )}
              </>
            )
          : (
              <>
                <div className="px-2 pb-1 pt-1">
                  <p className="text-xs font-medium">Hand off thread</p>
                  <p className="text-[11px] text-muted-foreground">Choose the destination runtime.</p>
                </div>
                <ScrollArea className="max-h-56" viewportClassName="max-h-56">
                  <div className="flex flex-col gap-0.5 py-0.5">
                    {runtimes.map(runtime => (
                      <Button
                        key={runtime.runtimeKind}
                        type="button"
                        variant="ghost"
                        className={cn(itemClassName)}
                        onClick={() => setSelectedRuntime(runtime)}
                      >
                        <RuntimeIcon icon={runtime.icon} className="size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {runtime.label}
                        </span>
                        <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </Button>
                    ))}
                    {!runtimeCatalog.isLoading && runtimes.length === 0 && (
                      <p className="px-2 py-2 text-pretty text-xs text-muted-foreground">
                        No destination runtime is available.
                      </p>
                    )}
                    {runtimeCatalog.isLoading && (
                      <p className="px-2 py-2 text-xs text-muted-foreground">Loading runtimes...</p>
                    )}
                  </div>
                </ScrollArea>
              </>
            )}
      </PopoverContent>
    </Popover>
  )
}
