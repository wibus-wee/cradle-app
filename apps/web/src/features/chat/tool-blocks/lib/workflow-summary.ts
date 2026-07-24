import type { ToolPayload } from '../../rendering/tool-ui-classifier'

export function isWorkflowPayload(input: ToolPayload, output: ToolPayload): boolean {
  return input.taskType === 'local_workflow'
    || output.taskType === 'local_workflow'
    || input.taskType === 'remote_agent'
    || output.taskType === 'remote_agent'
    || input.workflowName !== null
    || output.workflowName !== null
    || input.workflowDescription !== null
    || output.workflowDescription !== null
    || input.workflowPhases.length > 0
    || output.workflowPhases.length > 0
    || input.workflowRunId !== null
    || output.workflowRunId !== null
    || input.workflowScriptPath !== null
    || output.workflowScriptPath !== null
    || input.workflowSessionUrl !== null
    || output.workflowSessionUrl !== null
    || input.warning !== null
    || output.warning !== null
    || input.error !== null
    || output.error !== null
}

export function readSubagentStatusTitle(status: string | null, workflow: boolean): string | null {
  switch (status) {
    case 'async_launched': return workflow ? 'Workflow running' : 'Background agent running'
    case 'remote_launched': return 'Remote workflow running'
    case 'completed': return workflow ? 'Workflow completed' : 'Background agent completed'
    case 'failed':
    case 'error': return workflow ? 'Workflow failed' : 'Background agent failed'
    case 'stopped': return workflow ? 'Workflow stopped' : 'Background agent stopped'
    default: return null
  }
}

export function readSubagentStatusDescription(status: string | null, workflow: boolean): string {
  if (status === 'async_launched' || status === 'remote_launched') { return workflow ? 'Workflow output will be available when the task completes.' : 'Output will be available when the task completes.' }
  if (status === 'failed' || status === 'error') { return workflow ? 'The workflow reported a failure.' : 'The background task reported a failure.' }
  if (status === 'stopped') { return workflow ? 'The workflow was stopped.' : 'The background task was stopped.' }
  return 'Output has been captured.'
}

export function readWorkflowRows(input: ToolPayload, output: ToolPayload): Array<[string, string | number | null]> {
  const rows: Array<[string, string | number | null]> = [
    ['Name', output.workflowName ?? input.workflowName ?? input.subagentName],
    ['Description', output.workflowDescription ?? input.workflowDescription],
    ['Task', output.taskId ?? input.taskId],
    ['Run', output.workflowRunId ?? input.workflowRunId],
    ['Script', output.workflowScriptPath ?? input.workflowScriptPath],
    ['Transcript', output.workflowTranscriptDir ?? input.workflowTranscriptDir],
    ['Remote session', output.workflowSessionUrl ?? input.workflowSessionUrl],
    ['Warning', output.warning ?? input.warning],
    ['Error', output.error ?? input.error],
  ]
  return rows.filter(([, value]) => value !== null && value !== '')
}
