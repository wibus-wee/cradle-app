import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useChatSessionRuntimeControls } from './use-chat-session-runtime-controls'

function renderRuntimeControls(queryClient: QueryClient) {
  return renderHook(() => useChatSessionRuntimeControls('session-a'), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    ),
  })
}

describe('useChatSessionRuntimeControls', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('deduplicates queue refreshes while a refetch is pending', async () => {
    const queryClient = new QueryClient()
    let resolveRefetch: () => void = () => {}
    const pendingRefetch = new Promise<void>((resolve) => {
      resolveRefetch = resolve
    })
    const refetchQueries = vi
      .spyOn(queryClient, 'refetchQueries')
      .mockReturnValue(pendingRefetch)

    const { result } = renderRuntimeControls(queryClient)

    act(() => {
      result.current.refreshQueue()
      result.current.refreshQueue()
      result.current.refreshQueue()
    })

    expect(refetchQueries).toHaveBeenCalledTimes(1)
    expect(refetchQueries).toHaveBeenCalledWith(
      { queryKey: ['chat', 'session-queue', 'session-a'], type: 'active', exact: true },
      { cancelRefetch: false },
    )

    await act(async () => {
      resolveRefetch()
      await pendingRefetch
    })

    act(() => {
      result.current.refreshQueue()
    })

    expect(refetchQueries).toHaveBeenCalledTimes(2)
  })

  it('debounces delayed queue refreshes', () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const refetchQueries = vi
      .spyOn(queryClient, 'refetchQueries')
      .mockResolvedValue()

    const { result } = renderRuntimeControls(queryClient)

    act(() => {
      result.current.refreshQueue(100)
      result.current.refreshQueue(100)
    })

    expect(refetchQueries).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(99)
    })
    expect(refetchQueries).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(refetchQueries).toHaveBeenCalledTimes(1)
  })
})
