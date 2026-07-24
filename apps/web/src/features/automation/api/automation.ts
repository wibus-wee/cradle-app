import {
  getAutomations,
  getAutomationsByIdArtifacts,
  getAutomationsByIdRuns,
  getAutomationTriage,
  patchAutomationsById,
  patchAutomationsByIdRunsByRunIdTriage,
  postAutomations,
  postAutomationsByIdRun,
  postAutomationsByIdRunsByRunIdStop,
} from '~/api-gen/sdk.gen'
import type {
  GetAutomationsByIdArtifactsResponse,
  GetAutomationsByIdRunsResponse,
  GetAutomationsResponse,
  GetAutomationTriageResponse,
  PatchAutomationsByIdData,
  PatchAutomationsByIdResponse,
  PostAutomationsData,
  PostAutomationsResponse,
} from '~/api-gen/types.gen'

export type AutomationDefinition = GetAutomationsResponse[number]
export type AutomationRun = GetAutomationsByIdRunsResponse[number]
export type AutomationArtifact = GetAutomationsByIdArtifactsResponse[number]
export type AutomationTrigger = AutomationDefinition['trigger']
export type AutomationRecipe = AutomationDefinition['recipe']
export type AutomationRunStatus = AutomationRun['status']
export type CreateAutomationInput = PostAutomationsData['body']
export type UpdateAutomationInput = PatchAutomationsByIdData['body']

export async function listAutomationDefinitions(workspaceId?: string | null): Promise<AutomationDefinition[]> {
  const { data } = await getAutomations({
    query: workspaceId ? { workspaceId } : undefined,
    throwOnError: true,
  })
  return data
}

export async function createAutomation(input: CreateAutomationInput): Promise<PostAutomationsResponse> {
  const { data } = await postAutomations({ body: input, throwOnError: true })
  return data
}

export async function updateAutomation(id: string, input: UpdateAutomationInput): Promise<PatchAutomationsByIdResponse> {
  const { data } = await patchAutomationsById({
    path: { id },
    body: input,
    throwOnError: true,
  })
  return data
}

export async function listAutomationRuns(automationId: string): Promise<AutomationRun[]> {
  const { data } = await getAutomationsByIdRuns({
    path: { id: automationId },
    throwOnError: true,
  })
  return data
}

export async function listAutomationArtifacts(automationId: string): Promise<AutomationArtifact[]> {
  const { data } = await getAutomationsByIdArtifacts({
    path: { id: automationId },
    throwOnError: true,
  })
  return data
}

export async function runAutomationNow(automationId: string): Promise<AutomationRun> {
  const { data } = await postAutomationsByIdRun({
    path: { id: automationId },
    body: {},
    throwOnError: true,
  })
  return data
}

export async function listAutomationTriage(workspaceId?: string | null): Promise<GetAutomationTriageResponse> {
  const { data } = await getAutomationTriage({
    query: {
      status: 'unread',
      ...(workspaceId ? { workspaceId } : {}),
    },
    throwOnError: true,
  })
  return data
}

export async function stopAutomationRun(input: { automationId: string, runId: string }): Promise<AutomationRun> {
  const { data } = await postAutomationsByIdRunsByRunIdStop({
    path: { id: input.automationId, runId: input.runId },
    throwOnError: true,
  })
  return data
}

export async function updateAutomationRunTriage(input: {
  automationId: string
  runId: string
  status: 'unread' | 'read' | 'resolved' | 'archived'
}): Promise<AutomationRun> {
  const { data } = await patchAutomationsByIdRunsByRunIdTriage({
    path: { id: input.automationId, runId: input.runId },
    body: { status: input.status },
    throwOnError: true,
  })
  return data
}
