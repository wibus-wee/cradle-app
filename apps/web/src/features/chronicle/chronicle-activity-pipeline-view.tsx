import { ChronicleActivitySegmentCardView } from './chronicle-activity-segment-card-view'
import { ChroniclePipelineRunsView } from './chronicle-pipeline-runs-view'
import type {
  ChronicleActivitySegment,
  ChroniclePipelineRun,
} from './use-chronicle'

export interface ChronicleActivityPipelineViewProps {
  segments: ChronicleActivitySegment[]
  runs: ChroniclePipelineRun[]
  busy: boolean
  onTriageSegment: (segmentId: string) => void
  onSummarizeSegment: (segmentId: string) => void
  onCrystallizeSegment: (segmentId: string) => void
  onRunNow: () => void
}

export function ChronicleActivityPipelineView({
  segments,
  runs,
  busy,
  onTriageSegment,
  onSummarizeSegment,
  onCrystallizeSegment,
  onRunNow,
}: ChronicleActivityPipelineViewProps) {
  return (
    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {segments.map(segment => (
          <ChronicleActivitySegmentCardView
            key={segment.id}
            segment={segment}
            busy={busy}
            onTriage={() => onTriageSegment(segment.id)}
            onSummarize={() => onSummarizeSegment(segment.id)}
            onCrystallize={() => onCrystallizeSegment(segment.id)}
          />
        ))}
      </div>
      <ChroniclePipelineRunsView
        runs={runs}
        busy={busy}
        onRunNow={onRunNow}
      />
    </div>
  )
}
