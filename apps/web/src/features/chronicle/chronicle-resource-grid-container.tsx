import { useDownloadCenterProgressByOwner } from '~/features/download-center/use-download-center-progress'

import { ChronicleResourceGridView } from './chronicle-resource-grid-view'
import {
  modelResourceCategoryForDownload,
} from './chronicle-resource-presenter'
import type { ChronicleModelResource } from './use-chronicle'
import { useChronicleModelResourceActions } from './use-chronicle'

export interface ChronicleResourceGridContainerProps {
  loading: boolean
  resources: ChronicleModelResource[]
}

export function ChronicleResourceGridContainer({
  loading,
  resources,
}: ChronicleResourceGridContainerProps) {
  const {
    reconcileResources,
    installAllResources,
    verifyResource,
    installResource,
    reconciling,
    installingAll,
    verifying,
    installing,
  } = useChronicleModelResourceActions()
  const downloadProgress = useDownloadCenterProgressByOwner(
    { namespace: 'chronicle', resourceType: 'model-resource-file' },
    installingAll || installing,
    modelResourceCategoryForDownload,
  )
  const busy = reconciling || installingAll || verifying || installing

  return (
    <ChronicleResourceGridView
      loading={loading}
      resources={resources}
      busy={busy}
      downloadProgress={downloadProgress}
      onInstallAll={() => void installAllResources()}
      onReconcile={() => void reconcileResources()}
      onInstallResource={category =>
        installResource({ category, source: 'manifest' })}
      onVerifyResource={verifyResource}
    />
  )
}
