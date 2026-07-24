import type { WorkflowPhase } from '../../../rendering/tool-ui-classifier'

export interface WorkflowPhaseListViewProps { phases: WorkflowPhase[] }

export function WorkflowPhaseListView({ phases }: WorkflowPhaseListViewProps) {
  if (phases.length === 0) { return null }
  return (
<div className="grid gap-1.5">
<div className="text-[10px] font-medium uppercase text-muted-foreground">Declared phases</div>
<div className="grid gap-1">
{phases.map((phase, index) => (
<div key={`${phase.name}:${phase.description ?? ''}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-xs">
<span className="tabular-nums text-muted-foreground">{index + 1}</span>
<span className="min-w-0">
<span className="block truncate text-foreground/85">{phase.name}</span>
{phase.description && phase.description !== phase.name && <span className="block truncate text-[11px] text-muted-foreground">{phase.description}</span>}
</span>
</div>
))}
</div>
</div>
)
}
