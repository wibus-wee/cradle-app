import { AlertLine, Refresh1Line } from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle } from 'lucide-react'

import {
  getProviderTargetsByProviderTargetIdTestOptions,
  getProviderTargetsByProviderTargetIdTestQueryKey,
  postProviderTargetsByProviderTargetIdTestMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetProviderTargetsByProviderTargetIdTestResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

export type ProviderConnectionTestResult = GetProviderTargetsByProviderTargetIdTestResponse
export type ProviderConnectionStatus = ProviderConnectionTestResult['status']

const STATUS_LABELS: Record<ProviderConnectionStatus, string> = {
  ok: 'Connected',
  auth_failed: 'Auth failed',
  network_error: 'Network error',
  endpoint_error: 'Endpoint error',
  model_unavailable: 'Model unavailable',
}

export function useCachedConnectionTest(providerTargetId: string | null | undefined) {
  return useQuery({
    ...getProviderTargetsByProviderTargetIdTestOptions({
      path: { providerTargetId: providerTargetId ?? '' },
    }),
    enabled: !!providerTargetId,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useRunConnectionTest(providerTargetId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    ...postProviderTargetsByProviderTargetIdTestMutation(),
    onSuccess: (result) => {
      queryClient.setQueryData(
        getProviderTargetsByProviderTargetIdTestQueryKey({ path: { providerTargetId } }),
        result,
      )
    },
  })
}

function statusDotClass(status: ProviderConnectionStatus | null): string {
  if (status === 'ok') {
    return 'bg-emerald-500'
  }
  if (status === null) {
    return 'bg-muted-foreground/25'
  }
  if (status === 'model_unavailable') {
    return 'bg-amber-500'
  }
  return 'bg-destructive'
}

/** Compact list-row indicator of the last cached connection test. */
export function ProviderTestStatusDot({ providerTargetId }: { providerTargetId: string | null }) {
  const query = useCachedConnectionTest(providerTargetId)
  const result = query.data ?? null
  const status = result?.status ?? null
  const label = result
    ? `${STATUS_LABELS[result.status]} · ${result.latencyMs}ms`
    : 'Not tested'
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn('size-1.5 shrink-0 rounded-full', statusDotClass(status))}
        aria-label={label}
      />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

/** Detail-panel controls: run a connection test and show the structured verdict. */
export function ProviderConnectionTestControls({
  providerTargetId,
  disabled,
}: {
  providerTargetId: string
  disabled?: boolean
}) {
  const cached = useCachedConnectionTest(providerTargetId)
  const runTest = useRunConnectionTest(providerTargetId)
  const result = runTest.data ?? cached.data ?? null

  const handleTest = (deep: boolean) => {
    runTest.mutate({ path: { providerTargetId }, body: { deep } })
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={disabled || runTest.isPending}
        onClick={() => handleTest(false)}
        data-testid="provider-test-connection"
      >
        {runTest.isPending && !runTest.variables?.body?.deep
          ? <Spinner className="size-3" />
          : <Refresh1Line className="size-3" />}
        Test
      </Button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={disabled || runTest.isPending || result?.status !== 'ok'}
        onClick={() => handleTest(true)}
        data-testid="provider-test-connection-deep"
        title="Sends a minimal real generation; may incur a tiny token cost"
      >
        {runTest.isPending && runTest.variables?.body?.deep
          ? <Spinner className="size-3" />
          : null}
        Deep test
      </Button>
      {result && (
        <span
          data-testid="provider-test-status"
          data-status={result.status}
          title={result.detail ?? undefined}
          className={cn(
            'inline-flex items-center gap-1.5 text-[11.5px] font-medium',
            result.status === 'ok'
              ? 'text-emerald-600 dark:text-emerald-400'
              : result.status === 'model_unavailable' ? 'text-amber-600 dark:text-amber-400' : 'text-destructive',
          )}
        >
          {result.status === 'ok'
            ? <CheckCircle className="size-3.5" />
            : <AlertLine className="size-3.5" />}
          {STATUS_LABELS[result.status]}
          <span className="text-muted-foreground/70 font-normal">
{result.latencyMs}
ms
          </span>
        </span>
      )}
      {!result && !runTest.isPending && (
        <span className="text-[11.5px] text-muted-foreground/70">Not tested</span>
      )}
    </div>
  )
}
