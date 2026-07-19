import type { BrowserWorkflowSurfaceSnapshot } from '~/store/browser-panel'

import type { ToolPayload, ToolUiDescriptor } from './tool-ui-classifier'

export function hasWorkflowDetails(
  input: ToolPayload,
  output: ToolPayload,
  descriptor: ToolUiDescriptor,
): boolean {
  return (
    descriptor.kind === 'subagent'
    && (descriptor.toolName === 'Workflow'
      || descriptor.toolName === 'claude-code/Workflow'
      || input.taskType === 'local_workflow'
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
      || output.workflowSessionUrl !== null)
  )
}

export function readWorkflowSurfaceSnapshot(
  input: ToolPayload,
  output: ToolPayload,
): BrowserWorkflowSurfaceSnapshot {
  const phases = output.workflowPhases.length > 0 ? output.workflowPhases : input.workflowPhases
  const lifecycle = output.workflowLifecycle.length > 0
    ? output.workflowLifecycle
    : input.workflowLifecycle
  return {
    workflowName: output.workflowName ?? input.workflowName ?? input.subagentName,
    description: output.workflowDescription ?? input.workflowDescription,
    status: output.status,
    taskId: output.taskId ?? input.taskId,
    taskType: output.taskType ?? input.taskType,
    runId: output.workflowRunId ?? input.workflowRunId,
    scriptPath: output.workflowScriptPath ?? input.workflowScriptPath,
    transcriptDir: output.workflowTranscriptDir ?? input.workflowTranscriptDir,
    sessionUrl: output.workflowSessionUrl ?? input.workflowSessionUrl,
    warning: output.warning ?? input.warning,
    error: output.error ?? input.error,
    phases: phases.map(phase => ({ name: phase.name, description: phase.description })),
    input: input.rawValue,
    output: output.rawValue,
    lifecycle,
    runtime: null,
  }
}
