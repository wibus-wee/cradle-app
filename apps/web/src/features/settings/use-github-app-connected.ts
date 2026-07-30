import { useQuery } from '@tanstack/react-query'

import { getGithubAuthConnection } from '~/api-gen/sdk.gen'
import type { GetGithubAuthConnectionResponse } from '~/api-gen/types.gen'

import { GITHUB_AUTH_CONNECTION_QUERY_KEY } from './use-github-app-connection-controller'

/** Lightweight read of whether the Cradle GitHub App identity is connected. */
export function useGithubAppConnected() {
  const query = useQuery({
    queryKey: GITHUB_AUTH_CONNECTION_QUERY_KEY,
    queryFn: async () => {
      const { data } = await getGithubAuthConnection({ throwOnError: true })
      return data as GetGithubAuthConnectionResponse
    },
    staleTime: 30_000,
  })

  const connection = query.data ?? null
  const connected = connection?.state === 'connected' && connection.viewer !== null

  return {
    ready: query.isSuccess || query.isError,
    connected,
    connection,
  }
}
