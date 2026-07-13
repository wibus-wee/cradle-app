import type { RuntimeKind } from '~/features/agent-runtime/types'

export type AutomationRunStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled' | 'skipped'

export interface AutomationTrigger {
  type: 'rrule'
  rrule: string
  timezone: string
  misfirePolicy?: 'skip' | 'run_latest'
}

export interface AutomationInput {
  type: 'file_ref' | 'inline_file' | 'text' | 'url'
  name?: string
  path?: string
  content?: string
  url?: string
}

export interface AutomationArtifactRequest {
  name: string
  kind?: 'markdown' | 'text' | 'json' | 'file_ref'
  description?: string
}

export interface AutomationRecipe {
  kind: 'agent_task'
  prompt: string
  inputs?: AutomationInput[]
  artifactRequests?: AutomationArtifactRequest[]
  agentId?: string | null
  providerTargetId?: string | null
  runtimeKind?: RuntimeKind | null
  modelId?: string | null
  thinkingEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null
  sessionPolicy?: 'new' | 'heartbeat'
  isolationPolicy?: 'workspace' | 'worktree_per_run'
  completionPolicy?: {
    stopWhen?: 'agent_complete'
    noFindingsBehavior?: 'archive' | 'triage'
  }
}

export interface AutomationDefinition {
  id: string
  workspaceId?: string | null
  title: string
  description?: string | null
  enabled?: boolean
  trigger?: AutomationTrigger | null
  triggerJson?: AutomationTrigger | null
  recipe?: AutomationRecipe | null
  recipeJson?: AutomationRecipe | null
  createdBy?: string | null
  createdAt?: number | string | null
  updatedAt?: number | string | null
  nextRunAt?: number | string | null
  latestRun?: AutomationRun | null
}

export interface AutomationRun {
  id: string
  automationDefinitionId: string
  automationId?: string
  definitionId?: string
  workspaceId?: string | null
  status: AutomationRunStatus | string
  reason?: string | null
  errorText?: string | null
  occurrenceKey?: string | null
  scheduledFor?: number | string | null
  startedAt?: number | string | null
  finishedAt?: number | string | null
  createdAt?: number | string | null
  chatSessionId?: string | null
  backendRunId?: string | null
  resultKind?: 'findings' | 'no_findings' | 'stopped' | 'error' | null
  resultSummary?: string | null
  triageStatus?: 'unread' | 'read' | 'resolved' | 'archived' | null
  triagedAt?: number | string | null
}

export interface AutomationArtifact {
  id: string
  automationId?: string
  definitionId?: string
  runId?: string | null
  title?: string | null
  name?: string | null
  kind?: string | null
  mediaType?: string | null
  content?: string | null
  metadata?: Record<string, unknown> | null
  createdAt?: number | string | null
}

export interface AutomationDefinitionSummary extends AutomationDefinition {
  latestRun?: AutomationRun | null
}

export interface CreateAutomationInput {
  title: string
  description?: string
  workspaceId?: string | null
  enabled?: boolean
  trigger: AutomationTrigger
  recipe: {
    kind: 'agent_task'
    prompt: string
    inputs: AutomationInput[]
    artifactRequests: Array<Required<Pick<AutomationArtifactRequest, 'name' | 'kind'>> & Pick<AutomationArtifactRequest, 'description'>>
    agentId?: string
    providerTargetId?: string
    runtimeKind?: RuntimeKind
    modelId?: string
    thinkingEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    sessionPolicy?: 'new' | 'heartbeat'
    isolationPolicy?: 'workspace' | 'worktree_per_run'
    completionPolicy?: AutomationRecipe['completionPolicy']
  }
  createdByKind?: 'agent' | 'user' | 'system'
  createdById?: string | null
}

export interface UpdateAutomationInput {
  title?: string
  description?: string
  trigger?: AutomationTrigger
  recipe?: CreateAutomationInput['recipe']
  createdByKind?: 'agent' | 'user' | 'system'
  createdById?: string | null
}
