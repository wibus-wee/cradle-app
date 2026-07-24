import { getServerUrl } from '~/lib/electron'

import { ChronicleTimelineFeedView } from './chronicle-timeline-feed-view'
import type { TimelineEntry } from './use-chronicle'

export interface ChronicleTimelineFeedContainerProps {
  entries: TimelineEntry[]
}

export function ChronicleTimelineFeedContainer({
  entries,
}: ChronicleTimelineFeedContainerProps) {
  const serverUrl = getServerUrl()

  return (
    <ChronicleTimelineFeedView
      entries={entries}
      frameUrlForEntry={entry => (
        `${serverUrl}/chronicle/snapshots/${encodeURIComponent(entry.id)}/frame`
      )}
    />
  )
}
