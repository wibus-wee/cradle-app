import { ChronicleDreamRunView } from './chronicle-dream-run-view'
import type { ChronicleDreamRun } from './use-chronicle'
import { useChronicleDreamActions } from './use-chronicle'

export interface ChronicleDreamRunContainerProps {
  loading: boolean
  runs: ChronicleDreamRun[]
}

export function ChronicleDreamRunContainer({
  loading,
  runs,
}: ChronicleDreamRunContainerProps) {
  const {
    startDreamDryRun,
    startDreamMerge,
    startingDryRun,
    startingMerge,
  } = useChronicleDreamActions()

  return (
    <ChronicleDreamRunView
      loading={loading}
      runs={runs}
      busy={startingDryRun || startingMerge}
      onGeneratePreview={() => void startDreamDryRun()}
      onApplyMerge={() => void startDreamMerge()}
    />
  )
}
