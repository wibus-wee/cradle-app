import { useQuery } from '@tanstack/react-query'

import { getChatRunsByRunIdSnapshotOptions } from '~/api-gen/@tanstack/react-query.gen'
import { chatSelectors } from '~/store/chat'

import { useChatRenderStore } from '../../rendering/chat-render-store'
import type { RunTimingMetrics } from '../../rendering/run-debug-timings'
import { readLocalRunTimings, readRunSnapshotTimings } from '../../rendering/run-debug-timings'
import { RunDebugCaptionView } from '../views/run-debug-caption-view'

export interface RunDebugCaptionByIdProps {
  messageId: string
  persistedRunId?: string | null
  persistedTimings?: RunTimingMetrics | null
}

/** Persistent run timing caption for live and restored assistant message bubbles. */
export function RunDebugCaptionById({
  messageId,
  persistedRunId,
  persistedTimings,
}: RunDebugCaptionByIdProps) {
  const meta = useChatRenderStore(chatSelectors.runDisplayMeta(messageId), (a, b) => a === b)
  const runId = meta?.runId ?? persistedRunId ?? null
  const { data: runSnapshot } = useQuery({
    ...getChatRunsByRunIdSnapshotOptions({ path: { runId: runId ?? '' } }),
    enabled: Boolean(runId),
    refetchInterval: query => query.state.data?.status === 'running' ? 1000 : false,
  })

  if (!meta && !runId) {
    return null
  }

  const localTimings = meta ? readLocalRunTimings(meta) : null
  const snapshotTimings = runSnapshot ? readRunSnapshotTimings(runSnapshot) : null

  return (
    <RunDebugCaptionView
      runId={runId ?? ''}
      acceptMs={snapshotTimings?.acceptMs ?? persistedTimings?.acceptMs ?? localTimings?.acceptMs ?? null}
      ttfbMs={snapshotTimings?.ttfbMs ?? persistedTimings?.ttfbMs ?? localTimings?.ttfbMs ?? null}
      ttftMs={snapshotTimings?.ttftMs ?? persistedTimings?.ttftMs ?? localTimings?.ttftMs ?? null}
      totalMs={snapshotTimings?.totalMs ?? persistedTimings?.totalMs ?? localTimings?.totalMs ?? null}
    />
  )
}
