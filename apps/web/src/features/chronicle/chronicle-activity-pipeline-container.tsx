import { ChronicleActivityPipelineView } from './chronicle-activity-pipeline-view'
import type {
  ChronicleActivitySegment,
  ChroniclePipelineRun,
} from './use-chronicle'
import { useChronicleActivityPipelineActions } from './use-chronicle'

export interface ChronicleActivityPipelineContainerProps {
  segments: ChronicleActivitySegment[]
  runs: ChroniclePipelineRun[]
}

export function ChronicleActivityPipelineContainer({
  segments,
  runs,
}: ChronicleActivityPipelineContainerProps) {
  const {
    triageSegment,
    summarizeSegment,
    crystallizeSegment,
    runPipelineTick,
    triaging,
    summarizing,
    crystallizing,
    ticking,
  } = useChronicleActivityPipelineActions()

  return (
    <ChronicleActivityPipelineView
      segments={segments}
      runs={runs}
      busy={triaging || summarizing || crystallizing || ticking}
      onTriageSegment={segmentId => void triageSegment(segmentId)}
      onSummarizeSegment={segmentId => void summarizeSegment(segmentId)}
      onCrystallizeSegment={segmentId => void crystallizeSegment(segmentId)}
      onRunNow={() => void runPipelineTick()}
    />
  )
}
