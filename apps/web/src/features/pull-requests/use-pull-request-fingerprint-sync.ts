import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { getPullRequestsByOwnerByRepoByNumberDetailQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import {
  getPullRequestsByOwnerByRepoByNumberFingerprint,
  postPullRequestsByOwnerByRepoByNumberFingerprintProbe,
  postPullRequestsByOwnerByRepoByNumberRefresh,
} from '~/api-gen/sdk.gen'
import type { PostPullRequestsByOwnerByRepoByNumberFingerprintProbeResponse } from '~/api-gen/types.gen'

const PROBE_INTERVAL_MS = 20_000

type PullRequestFingerprint = PostPullRequestsByOwnerByRepoByNumberFingerprintProbeResponse['fingerprint']

interface UsePullRequestFingerprintSyncOptions {
  owner: string
  repo: string
  number: number
  enabled?: boolean
}

export function usePullRequestFingerprintSync({
  owner,
  repo,
  number,
  enabled = true,
}: UsePullRequestFingerprintSyncOptions) {
  const queryClient = useQueryClient()
  const path = useMemo(
    () => ({ owner, repo, number: String(number) }),
    [number, owner, repo],
  )
  const fingerprintRef = useRef<PullRequestFingerprint | null>(null)
  const inFlightRef = useRef(false)
  const visibleRef = useRef(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  )

  const refreshDetail = useCallback(async () => {
    const { data, error } = await postPullRequestsByOwnerByRepoByNumberRefresh({
      path,
      body: { force: false },
    })
    if (!error && data) {
      queryClient.setQueryData(
        getPullRequestsByOwnerByRepoByNumberDetailQueryKey({ path }),
        data,
      )
      return true
    }
    return false
  }, [path, queryClient])

  const applyProbeResult = useCallback(async (result: PostPullRequestsByOwnerByRepoByNumberFingerprintProbeResponse) => {
    if (!result.changed || await refreshDetail()) {
      fingerprintRef.current = result.fingerprint
    }
  }, [refreshDetail])

  const probe = useCallback(async () => {
    if (!enabled || inFlightRef.current) {
      return
    }
    inFlightRef.current = true
    try {
      const { data, error } = await postPullRequestsByOwnerByRepoByNumberFingerprintProbe({
        path,
        body: { previous: fingerprintRef.current },
      })
      if (error || !data) {
        return
      }
      await applyProbeResult(data)
    }
    finally {
      inFlightRef.current = false
    }
  }, [applyProbeResult, enabled, path])

  const resetFingerprint = useCallback(async () => {
    fingerprintRef.current = null
    if (!enabled) {
      return
    }
    const { data, error } = await postPullRequestsByOwnerByRepoByNumberFingerprintProbe({
      path,
      body: { previous: null },
    })
    if (!error && data) {
      fingerprintRef.current = data.fingerprint
    }
  }, [enabled, path])

  useEffect(() => {
    if (!enabled) {
      return
    }

    void (async () => {
      const { data, error } = await getPullRequestsByOwnerByRepoByNumberFingerprint({ path })
      if (!error && data) {
        fingerprintRef.current = data.fingerprint
      }
    })()

    function handleVisibilityChange() {
      visibleRef.current = document.visibilityState === 'visible'
      if (visibleRef.current) {
        void probe()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    const intervalId = window.setInterval(() => {
      if (visibleRef.current) {
        void probe()
      }
    }, PROBE_INTERVAL_MS)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [enabled, path, probe])

  return { resetFingerprint }
}
