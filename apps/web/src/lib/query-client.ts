import { QueryClient } from '@tanstack/react-query'

export function createCradleQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  })
}

/** One cache per renderer; exported so tear-off windows can receive selected queries. */
export const queryClient = createCradleQueryClient()
