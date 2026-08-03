import { useQuery } from '@tanstack/react-query'

import { getChatRunsByRunIdSnapshotOptions } from '~/api-gen/@tanstack/react-query.gen'
import { chatSelectors } from '~/store/chat'

import { useChatRenderStore } from '../../rendering/chat-render-store'
import { readLocalRunTimings, readRunSnapshotTimings } from '../../rendering/run-debug-timings'
import { RunDebugCaptionView } from '../views/run-debug-caption-view'

export interface RunDebugCaptionByIdProps {
  messageId: string
}

/** Store-backed run timing caption for assistant message bubbles. */
export function RunDebugCaptionById({ messageId }: RunDebugCaptionByIdProps) {
  const meta = useChatRenderStore(chatSelectors.runDisplayMeta(messageId), (a, b) => a === b)
  const { data: runSnapshot } = useQuery({
    ...getChatRunsByRunIdSnapshotOptions({ path: { runId: meta?.runId ?? '' } }),
    enabled: Boolean(meta?.runId),
    refetchInterval: query => query.state.data?.status === 'running' ? 1000 : false,
  })

  if (!meta) {
    return null
  }

  const localTimings = readLocalRunTimings(meta)
  const snapshotTimings = runSnapshot ? readRunSnapshotTimings(runSnapshot) : null

  return (
    <RunDebugCaptionView
      runId={meta.runId}
      acceptMs={localTimings.acceptMs}
      ttfbMs={snapshotTimings ? snapshotTimings.ttfbMs : localTimings.ttfbMs}
      ttftMs={snapshotTimings ? snapshotTimings.ttftMs : localTimings.ttftMs}
      totalMs={snapshotTimings?.totalMs ?? localTimings.totalMs}
    />
  )
}
