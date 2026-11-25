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
  const appConnected = connection?.state === 'connected' && connection.viewer !== null
  // The ambient local credential (gh CLI / env token) unlocks GitHub-backed
  // features only when no App credential exists. An expired or errored App
  // connection fails closed server-side and requires reconnection or an
  // explicit disconnect, so it must not be masked by the local fallback.
  const noAppCredential = connection?.state === 'disconnected' || connection?.state === 'unconfigured'
  const localCredentialAvailable = noAppCredential && connection?.localCredential?.available === true

  return {
    ready: query.isSuccess || query.isError,
    connected: appConnected || localCredentialAvailable,
    appConnected,
    localCredentialAvailable,
    connection,
  }
}
