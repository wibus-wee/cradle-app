import { z } from 'zod'

import { getServerUrl } from '~/lib/electron'

import type { AutomationArtifact, AutomationDefinition, AutomationDefinitionSummary, AutomationRun, CreateAutomationInput, UpdateAutomationInput } from './types'

const AutomationTriggerSchema = z.object({
  type: z.literal('rrule'),
  rrule: z.string(),
  timezone: z.string(),
  misfirePolicy: z.enum(['skip', 'run_latest']).optional(),
})

const AutomationInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('file_ref'),
    path: z.string(),
  }),
  z.object({
    type: z.literal('inline_file'),
    name: z.string(),
    content: z.string(),
  }),
  z.object({
    type: z.literal('text'),
    name: z.string(),
    content: z.string(),
  }),
  z.object({
    type: z.literal('url'),
    url: z.string(),
  }),
])

const AutomationArtifactRequestSchema = z.object({
  name: z.string(),
  kind: z.enum(['markdown', 'text', 'json', 'file_ref']),
  description: z.string().optional(),
})

const AutomationRecipeSchema = z.object({
  kind: z.literal('agent_task'),
  prompt: z.string(),
  inputs: z.array(AutomationInputSchema),
  artifactRequests: z.array(AutomationArtifactRequestSchema),
  agentId: z.string().optional(),
  providerTargetId: z.string().optional(),
  runtimeKind: z.string().min(1).optional(),
  modelId: z.string().optional(),
  thinkingEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
})

const AutomationDefinitionSchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  trigger: AutomationTriggerSchema,
  recipe: AutomationRecipeSchema,
  createdByKind: z.enum(['agent', 'user', 'system']),
  createdById: z.string().nullable(),
  lastRunAt: z.number().nullable(),
  nextRunAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const AutomationRunSchema = z.object({
  id: z.string(),
  automationDefinitionId: z.string(),
  workspaceId: z.string().nullable(),
  triggerType: z.enum(['manual', 'scheduled']),
  occurrenceKey: z.string().nullable(),
  status: z.enum(['queued', 'running', 'complete', 'failed', 'cancelled']),
  triggerSnapshot: AutomationTriggerSchema,
  recipeSnapshot: AutomationRecipeSchema,
  chatSessionId: z.string().nullable(),
  backendRunId: z.string().nullable(),
  artifactCount: z.number(),
  errorText: z.string().nullable(),
  scheduledFor: z.number().nullable(),
  claimedAt: z.number().nullable(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const AutomationArtifactSchema = z.object({
  id: z.string(),
  automationRunId: z.string(),
  automationDefinitionId: z.string().nullable(),
  kind: z.enum(['markdown', 'text', 'json', 'file_ref']),
  name: z.string(),
  mimeType: z.string().nullable(),
  content: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const AutomationDefinitionCollectionSchema = z.union([
  z.array(AutomationDefinitionSchema),
  z.object({ automations: z.array(AutomationDefinitionSchema) }).transform(payload => payload.automations),
  z.object({ definitions: z.array(AutomationDefinitionSchema) }).transform(payload => payload.definitions),
  z.object({ items: z.array(AutomationDefinitionSchema) }).transform(payload => payload.items),
  z.object({ data: z.array(AutomationDefinitionSchema) }).transform(payload => payload.data),
])

const AutomationRunCollectionSchema = z.union([
  z.array(AutomationRunSchema),
  z.object({ runs: z.array(AutomationRunSchema) }).transform(payload => payload.runs),
  z.object({ items: z.array(AutomationRunSchema) }).transform(payload => payload.items),
  z.object({ data: z.array(AutomationRunSchema) }).transform(payload => payload.data),
])

const AutomationArtifactCollectionSchema = z.union([
  z.array(AutomationArtifactSchema),
  z.object({ artifacts: z.array(AutomationArtifactSchema) }).transform(payload => payload.artifacts),
  z.object({ items: z.array(AutomationArtifactSchema) }).transform(payload => payload.items),
  z.object({ data: z.array(AutomationArtifactSchema) }).transform(payload => payload.data),
])

const RunAutomationNowResponseSchema = z.union([
  AutomationRunSchema,
  z.object({ run: AutomationRunSchema }).transform(payload => payload.run),
])

const CreateAutomationResponseSchema = z.union([
  AutomationDefinitionSchema,
  z.object({ automation: AutomationDefinitionSchema }).transform(payload => payload.automation),
  z.object({ definition: AutomationDefinitionSchema }).transform(payload => payload.definition),
])

async function requestAutomationJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${getServerUrl()}${path}`, {
    ...init,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Automation request failed: ${response.status}`)
  }

  return response.json()
}

async function attachLatestRun(definition: AutomationDefinition): Promise<AutomationDefinitionSummary> {
  const runs = await listAutomationRuns(definition.id, 1)
  return { ...definition, latestRun: runs[0] ?? null }
}

export async function listAutomationDefinitions(workspaceId?: string | null): Promise<AutomationDefinitionSummary[]> {
  const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''
  const definitions = AutomationDefinitionCollectionSchema.parse(await requestAutomationJson(`/automations${query}`)) satisfies AutomationDefinition[]
  return Promise.all(definitions.map(attachLatestRun))
}

export async function createAutomation(input: CreateAutomationInput): Promise<AutomationDefinition> {
  return CreateAutomationResponseSchema.parse(await requestAutomationJson(
    '/automations',
    { method: 'POST', body: JSON.stringify(input) },
  )) satisfies AutomationDefinition
}

export async function updateAutomation(id: string, input: UpdateAutomationInput): Promise<AutomationDefinition> {
  return CreateAutomationResponseSchema.parse(await requestAutomationJson(
    `/automations/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  )) satisfies AutomationDefinition
}

export async function listAutomationRuns(automationId: string, limit = 20): Promise<AutomationRun[]> {
  const runs = AutomationRunCollectionSchema.parse(await requestAutomationJson(`/automations/${encodeURIComponent(automationId)}/runs`)) satisfies AutomationRun[]
  return runs.slice(0, limit)
}

export async function listAutomationArtifacts(automationId: string): Promise<AutomationArtifact[]> {
  return AutomationArtifactCollectionSchema.parse(
    await requestAutomationJson(`/automations/${encodeURIComponent(automationId)}/artifacts`),
  ) satisfies AutomationArtifact[]
}

export async function runAutomationNow(automationId: string): Promise<AutomationRun> {
  return RunAutomationNowResponseSchema.parse(await requestAutomationJson(
    `/automations/${encodeURIComponent(automationId)}/run`,
    { method: 'POST', body: JSON.stringify({}) },
  )) satisfies AutomationRun
}
