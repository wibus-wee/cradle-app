import { CheckCircleLine as CheckCircle2Icon, ClockLine as ClockIcon, CloseCircleLine as XCircleIcon } from '@mingcute/react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { cn } from '~/lib/cn'

import type { ToolPayload } from '../../../rendering/tool-ui-classifier'
import { isWorkflowPayload, readSubagentStatusDescription, readSubagentStatusTitle, readWorkflowRows } from '../../lib/workflow-summary'
import { KeyValueTable, RawValue } from '../tool-call-details'
import { WorkflowPhaseListView } from './workflow-phase-list-view'

export interface SubagentSummaryViewProps { input: ToolPayload, output: ToolPayload }

export function SubagentSummaryView({ input, output }: SubagentSummaryViewProps) {
  const workflow = isWorkflowPayload(input, output)
  const content = output.contentBlocks.map(item => item.text).filter(Boolean).join('\n\n')
  if (!output.status && !content && !workflow) { return null }
  const statusTitle = readSubagentStatusTitle(output.status, workflow)
  const StatusIcon = output.status === 'async_launched' || output.status === 'remote_launched' ? ClockIcon : output.status === 'failed' || output.status === 'error' ? XCircleIcon : CheckCircle2Icon
  const workflowPhases = output.workflowPhases.length > 0 ? output.workflowPhases : input.workflowPhases
  return (
<div className="grid gap-2">
{statusTitle && (
<Alert className={cn('border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300', (output.status === 'async_launched' || output.status === 'remote_launched') && 'border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300', (output.status === 'failed' || output.status === 'error') && 'border-destructive/20 bg-destructive/5 text-destructive')}>
<StatusIcon className="size-4" aria-hidden />
<AlertTitle>{statusTitle}</AlertTitle>
<AlertDescription>{output.outputFile ?? output.workflowSessionUrl ?? readSubagentStatusDescription(output.status, workflow)}</AlertDescription>
</Alert>
)}
{workflow && readWorkflowRows(input, output).length > 0 && <KeyValueTable rows={readWorkflowRows(input, output)} />}
<WorkflowPhaseListView phases={workflowPhases} />
{content && <RawValue value={content} />}
</div>
)
}
