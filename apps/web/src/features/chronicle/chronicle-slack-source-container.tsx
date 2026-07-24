import { getServerUrl } from '~/lib/electron'

import { ChronicleSlackSourceView } from './chronicle-slack-source-view'
import type { ChronicleMessageSource } from './use-chronicle'
import { useChronicleSlackSourceActions } from './use-chronicle'

export interface ChronicleSlackSourceContainerProps {
  loading: boolean
  sources: ChronicleMessageSource[]
}

export function ChronicleSlackSourceContainer({
  loading,
  sources,
}: ChronicleSlackSourceContainerProps) {
  const {
    saveSource,
    syncSource,
    saving,
    syncing,
  } = useChronicleSlackSourceActions()

  return (
    <ChronicleSlackSourceView
      loading={loading}
      sources={sources}
      serverUrl={getServerUrl()}
      saving={saving}
      syncing={syncing}
      onSaveSource={saveSource}
      onSyncSource={syncSource}
    />
  )
}
