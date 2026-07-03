import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { AutomationArtifact, AutomationDefinition, AutomationRun } from '@cradle/db'
import {
  automationArtifacts,
  automationDefinitions,
  automationEvents,
  automationRuns
} from '@cradle/db'
import type { SQL } from 'drizzle-orm'
import { and, desc, eq, isNull, lte, or } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import * as ChatRuntime from '../chat-runtime/runtime'
import type { RuntimeKind } from '../provider-contracts/types'
import * as Session from '../session/service'
import type { AutomationTrigger, DueOccurrence } from './scheduler'
import { getNextOccurrence, listDueOccurrences } from './scheduler'

export type AutomationInput =
  | { type: 'file_ref'; path: string }
  | { type: 'inline_file'; name: string; content: string }
  | { type: 'text'; name: string; content: string }
  | { type: 'url'; url: string }

export interface AutomationArtifactRequest {
  kind: 'markdown' | 'text' | 'json' | 'file_ref'
  name: string
  description?: string
}

export interface AutomationRecipe {
  kind: 'agent_task'
  prompt: string
  inputs: AutomationInput[]
  artifactRequests: AutomationArtifactRequest[]
  agentId?: string
  providerTargetId?: string
  runtimeKind?: RuntimeKind
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh'
}

export interface AutomationDefinitionView {
  id: string
  workspaceId: string | null
  title: string
  description: string
  enabled: boolean
  trigger: AutomationTrigger
  recipe: AutomationRecipe
  createdByKind: 'agent' | 'user' | 'system'
  createdById: string | null
  lastRunAt: number | null
  nextRunAt: number | null
  createdAt: number
  updatedAt: number
}

export interface AutomationRunView {
  id: string
  automationDefinitionId: string
  workspaceId: string | null
  triggerType: 'manual' | 'scheduled'
  occurrenceKey: string | null
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
  triggerSnapshot: AutomationTrigger
  recipeSnapshot: AutomationRecipe
  chatSessionId: string | null
  backendRunId: string | null
  artifactCount: number
  errorText: string | null
  scheduledFor: number | null
  claimedAt: number | null
  startedAt: number | null
  finishedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface AutomationArtifactView {
  id: string
  automationRunId: string
  automationDefinitionId: string | null
  kind: 'markdown' | 'text' | 'json' | 'file_ref'
  name: string
  mimeType: string | null
  content: string | null
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

function readJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

function toDefinitionView(row: AutomationDefinition): AutomationDefinitionView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    description: row.description,
    enabled: row.enabled,
    trigger: readJson<AutomationTrigger>(row.triggerJson, {
      type: 'rrule',
      rrule: '',
      timezone: 'UTC'
    }),
    recipe: readJson<AutomationRecipe>(row.recipeJson, {
      kind: 'agent_task',
      prompt: '',
      inputs: [],
      artifactRequests: [],
      providerTargetId: ''
    }),
    createdByKind: row.createdByKind,
    createdById: row.createdById,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function toRunView(row: AutomationRun): AutomationRunView {
  return {
    id: row.id,
    automationDefinitionId: row.automationDefinitionId,
    workspaceId: row.workspaceId,
    triggerType: row.triggerType,
    occurrenceKey: row.occurrenceKey,
    status: row.status,
    triggerSnapshot: readJson<AutomationTrigger>(row.triggerSnapshotJson, {
      type: 'rrule',
      rrule: '',
      timezone: 'UTC'
    }),
    recipeSnapshot: readJson<AutomationRecipe>(row.recipeSnapshotJson, {
      kind: 'agent_task',
      prompt: '',
      inputs: [],
      artifactRequests: [],
      providerTargetId: ''
    }),
    chatSessionId: row.chatSessionId,
    backendRunId: row.backendRunId,
    artifactCount: row.artifactCount,
    errorText: row.errorText,
    scheduledFor: row.scheduledFor,
    claimedAt: row.claimedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function toArtifactView(row: AutomationArtifact): AutomationArtifactView {
  return {
    id: row.id,
    automationRunId: row.automationRunId,
    automationDefinitionId: row.automationDefinitionId,
    kind: row.kind,
    name: row.name,
    mimeType: row.mimeType,
    content: row.content,
    metadata: readJson<Record<string, unknown>>(row.metadataJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function getDefinitionRow(id: string): AutomationDefinition {
  const row = db()
    .select()
    .from(automationDefinitions)
    .where(eq(automationDefinitions.id, id))
    .get()
  if (!row) {
    throw new AppError({
      code: 'automation_not_found',
      status: 404,
      message: 'Automation not found',
      details: { id }
    })
  }
  return row
}

function getRunRow(runId: string, definitionId?: string): AutomationRun {
  const predicates = [eq(automationRuns.id, runId)]
  if (definitionId) {
    predicates.push(eq(automationRuns.automationDefinitionId, definitionId))
  }
  const row = db()
    .select()
    .from(automationRuns)
    .where(and(...predicates))
    .get()
  if (!row) {
    throw new AppError({
      code: 'automation_run_not_found',
      status: 404,
      message: 'Automation run not found',
      details: { runId }
    })
  }
  return row
}

function writeEvent(input: {
  definitionId?: string | null
  runId?: string | null
  type: string
  message: string
  attrs?: Record<string, unknown>
}): void {
  db()
    .insert(automationEvents)
    .values({
      id: randomUUID(),
      automationDefinitionId: input.definitionId ?? null,
      automationRunId: input.runId ?? null,
      type: input.type,
      message: input.message,
      attrsJson: JSON.stringify(input.attrs ?? {}),
      createdAt: currentUnixSeconds()
    })
    .run()
}

function formatInput(input: AutomationInput): string {
  if (input.type === 'file_ref') {
    return `File reference: ${input.path}`
  }
  if (input.type === 'inline_file') {
    return `Inline file: ${input.name}\n${input.content}`
  }
  if (input.type === 'text') {
    return `Text input: ${input.name}\n${input.content}`
  }
  return `URL: ${input.url}`
}

function buildRunPrompt(recipe: AutomationRecipe): string {
  const inputs =
    recipe.inputs.length > 0 ? `\n\nInputs:\n${recipe.inputs.map(formatInput).join('\n\n')}` : ''
  const artifacts =
    recipe.artifactRequests.length > 0
      ? `\n\nRequested artifacts:\n${recipe.artifactRequests.map((item) => `- ${item.kind}: ${item.name}${item.description ? ` - ${item.description}` : ''}`).join('\n')}`
      : ''
  return `${recipe.prompt}${inputs}${artifacts}`
}

function validateRecipe(recipe: AutomationRecipe): void {
  for (const input of recipe.inputs) {
    if (input.type === 'file_ref' && !path.isAbsolute(input.path)) {
      throw new AppError({
        code: 'automation_file_ref_must_be_absolute',
        status: 400,
        message: 'Automation file references must use absolute paths',
        details: { path: input.path }
      })
    }
  }
}

function refreshDefinitionSchedule(
  definitionId: string,
  trigger: AutomationTrigger,
  now = currentUnixSeconds()
): void {
  const nextRunAt = getNextOccurrence(trigger, now)
  db()
    .update(automationDefinitions)
    .set({ nextRunAt, updatedAt: now })
    .where(eq(automationDefinitions.id, definitionId))
    .run()
}

export function create(input: {
  id?: string
  workspaceId?: string | null
  title: string
  description?: string
  enabled?: boolean
  trigger: AutomationTrigger
  recipe: AutomationRecipe
  createdByKind?: 'agent' | 'user' | 'system'
  createdById?: string | null
}): AutomationDefinitionView {
  validateRecipe(input.recipe)
  const now = currentUnixSeconds()
  const id = input.id ?? randomUUID()
  db()
    .insert(automationDefinitions)
    .values({
      id,
      workspaceId: input.workspaceId ?? null,
      title: input.title,
      description: input.description ?? '',
      enabled: input.enabled ?? true,
      triggerJson: JSON.stringify(input.trigger),
      recipeJson: JSON.stringify(input.recipe),
      createdByKind: input.createdByKind ?? 'agent',
      createdById: input.createdById ?? null,
      nextRunAt: getNextOccurrence(input.trigger, now),
      createdAt: now,
      updatedAt: now
    })
    .run()
  writeEvent({ definitionId: id, type: 'automation.created', message: 'Automation created' })
  return get(id)
}

export function list(input: {
  workspaceId?: string
  enabled?: boolean
}): AutomationDefinitionView[] {
  const predicates: SQL[] = []
  if (input.workspaceId) {
    predicates.push(eq(automationDefinitions.workspaceId, input.workspaceId))
  }
  if (input.enabled !== undefined) {
    predicates.push(eq(automationDefinitions.enabled, input.enabled))
  }
  return db()
    .select()
    .from(automationDefinitions)
    .where(predicates.length > 0 ? and(...predicates) : undefined)
    .orderBy(desc(automationDefinitions.updatedAt))
    .all()
    .map(toDefinitionView)
}

export function get(id: string): AutomationDefinitionView {
  return toDefinitionView(getDefinitionRow(id))
}

export function update(
  id: string,
  input: {
    title?: string
    description?: string
    trigger?: AutomationTrigger
    recipe?: AutomationRecipe
    createdByKind?: 'agent' | 'user' | 'system'
    createdById?: string | null
  }
): AutomationDefinitionView {
  const existing = getDefinitionRow(id)
  const now = currentUnixSeconds()
  const patch: Partial<typeof automationDefinitions.$inferInsert> = { updatedAt: now }
  if (input.title !== undefined) {
    patch.title = input.title
  }
  if (input.description !== undefined) {
    patch.description = input.description
  }
  if (input.trigger !== undefined) {
    patch.triggerJson = JSON.stringify(input.trigger)
    patch.nextRunAt = getNextOccurrence(input.trigger, now)
  }
  if (input.recipe !== undefined) {
    validateRecipe(input.recipe)
    patch.recipeJson = JSON.stringify(input.recipe)
  }
  if (input.createdByKind !== undefined) {
    patch.createdByKind = input.createdByKind
  }
  if (input.createdById !== undefined) {
    patch.createdById = input.createdById
  }
  db()
    .update(automationDefinitions)
    .set(patch)
    .where(eq(automationDefinitions.id, existing.id))
    .run()
  writeEvent({ definitionId: id, type: 'automation.updated', message: 'Automation updated' })
  return get(id)
}

export function remove(id: string): void {
  getDefinitionRow(id)
  db().delete(automationDefinitions).where(eq(automationDefinitions.id, id)).run()
}

export function setEnabled(id: string, enabled: boolean): AutomationDefinitionView {
  const existing = getDefinitionRow(id)
  const now = currentUnixSeconds()
  const trigger = readJson<AutomationTrigger>(existing.triggerJson, {
    type: 'rrule',
    rrule: '',
    timezone: 'UTC'
  })
  db()
    .update(automationDefinitions)
    .set({
      enabled,
      nextRunAt: enabled ? getNextOccurrence(trigger, now) : null,
      updatedAt: now
    })
    .where(eq(automationDefinitions.id, id))
    .run()
  writeEvent({
    definitionId: id,
    type: enabled ? 'automation.enabled' : 'automation.disabled',
    message: enabled ? 'Automation enabled' : 'Automation disabled'
  })
  return get(id)
}

function insertRun(input: {
  definition: AutomationDefinition
  triggerType: 'manual' | 'scheduled'
  occurrenceKey?: string | null
  scheduledFor?: number | null
}): AutomationRun {
  const now = currentUnixSeconds()
  return db()
    .insert(automationRuns)
    .values({
      id: randomUUID(),
      automationDefinitionId: input.definition.id,
      workspaceId: input.definition.workspaceId,
      triggerType: input.triggerType,
      occurrenceKey: input.occurrenceKey ?? null,
      status: 'queued',
      triggerSnapshotJson: input.definition.triggerJson,
      recipeSnapshotJson: input.definition.recipeJson,
      scheduledFor: input.scheduledFor ?? null,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()
}

export function enqueueDueRuns(
  input: { now?: number; lookbackSeconds?: number; limit?: number } = {}
): AutomationRunView[] {
  const now = input.now ?? currentUnixSeconds()
  const lookbackSeconds = input.lookbackSeconds ?? 3600
  const dueDefinitions = db()
    .select()
    .from(automationDefinitions)
    .where(
      and(
        eq(automationDefinitions.enabled, true),
        or(lte(automationDefinitions.nextRunAt, now), isNull(automationDefinitions.nextRunAt))
      )
    )
    .all()

  const created: AutomationRun[] = []
  for (const definition of dueDefinitions) {
    const trigger = readJson<AutomationTrigger>(definition.triggerJson, {
      type: 'rrule',
      rrule: '',
      timezone: 'UTC'
    })
    const windowStart =
      definition.nextRunAt ?? Math.max(0, (definition.lastRunAt ?? now) - lookbackSeconds)
    const due = listDueOccurrences(trigger, {
      windowStart,
      windowEnd: now,
      limit: input.limit
    })
    for (const occurrence of due) {
      const run = insertScheduledRunIfMissing(definition, occurrence)
      if (run) {
        created.push(run)
      }
    }
    refreshDefinitionSchedule(definition.id, trigger, now)
  }

  return created.map(toRunView)
}

function insertScheduledRunIfMissing(
  definition: AutomationDefinition,
  occurrence: DueOccurrence
): AutomationRun | null {
  try {
    return insertRun({
      definition,
      triggerType: 'scheduled',
      occurrenceKey: occurrence.occurrenceKey,
      scheduledFor: occurrence.scheduledFor
    })
  } catch {
    return null
  }
}

export async function runNow(
  id: string,
  input: { occurrenceKey?: string; scheduledFor?: number } = {}
): Promise<AutomationRunView> {
  const definition = getDefinitionRow(id)
  let run: AutomationRun
  try {
    run = insertRun({
      definition,
      triggerType: input.occurrenceKey ? 'scheduled' : 'manual',
      occurrenceKey: input.occurrenceKey ?? `manual:${randomUUID()}`,
      scheduledFor: input.scheduledFor ?? null
    })
  } catch (error) {
    if (input.occurrenceKey) {
      throw new AppError({
        code: 'automation_run_exists',
        status: 409,
        message: 'Automation run already exists for this occurrence',
        details: { automationDefinitionId: id, occurrenceKey: input.occurrenceKey }
      })
    }
    throw error
  }
  return executeRun(run.id)
}

export async function executeRun(runId: string): Promise<AutomationRunView> {
  const run = getRunRow(runId)
  const recipe = readJson<AutomationRecipe>(run.recipeSnapshotJson, {
    kind: 'agent_task',
    prompt: '',
    inputs: [],
    artifactRequests: [],
    providerTargetId: ''
  })
  const now = currentUnixSeconds()
  const claimed = db()
    .update(automationRuns)
    .set({
      status: 'running',
      claimedAt: run.claimedAt ?? now,
      startedAt: now,
      updatedAt: now
    })
    .where(and(eq(automationRuns.id, run.id), eq(automationRuns.status, 'queued')))
    .run()
  if (claimed.changes === 0) {
    return getRun(run.automationDefinitionId, run.id)
  }

  let chatSessionId: string | null = null
  let backendRunId: string | null = null
  try {
    if (recipe.kind !== 'agent_task') {
      throw new Error(`Unsupported automation recipe kind: ${(recipe as { kind?: string }).kind}`)
    }
    const session = Session.create({
      workspaceId: run.workspaceId,
      title: `Automation: ${getDefinitionRow(run.automationDefinitionId).title}`,
      origin: 'automation',
      providerTargetId: recipe.providerTargetId,
      agentId: recipe.agentId,
      runtimeKind: recipe.runtimeKind
    })
    chatSessionId = session.id
    const backendRun = await ChatRuntime.createRun({
      sessionId: session.id,
      text: buildRunPrompt(recipe),
      modelId: recipe.modelId,
      thinkingEffort: recipe.thinkingEffort
    })
    backendRunId = backendRun.runId
    db()
      .update(automationRuns)
      .set({
        chatSessionId,
        backendRunId,
        updatedAt: currentUnixSeconds()
      })
      .where(eq(automationRuns.id, run.id))
      .run()

    const completed = await ChatRuntime.waitForRunCompletion(backendRun.runId)
    if (completed.status !== 'complete') {
      throw new Error(completed.errorText ?? `Backend run ended with status ${completed.status}`)
    }

    const markdown = Session.exportMarkdown(session.id)
    const artifactName = recipe.artifactRequests[0]?.name ?? 'automation-run.md'
    db()
      .insert(automationArtifacts)
      .values({
        id: randomUUID(),
        automationRunId: run.id,
        automationDefinitionId: run.automationDefinitionId,
        kind: 'markdown',
        name: artifactName,
        mimeType: 'text/markdown',
        content: markdown,
        metadataJson: JSON.stringify({ chatSessionId, backendRunId }),
        createdAt: currentUnixSeconds(),
        updatedAt: currentUnixSeconds()
      })
      .run()

    const finishedAt = currentUnixSeconds()
    db()
      .update(automationRuns)
      .set({
        status: 'complete',
        artifactCount: 1,
        errorText: null,
        finishedAt,
        updatedAt: finishedAt
      })
      .where(eq(automationRuns.id, run.id))
      .run()
    db()
      .update(automationDefinitions)
      .set({
        lastRunAt: finishedAt,
        updatedAt: finishedAt
      })
      .where(eq(automationDefinitions.id, run.automationDefinitionId))
      .run()
    writeEvent({
      definitionId: run.automationDefinitionId,
      runId: run.id,
      type: 'automation.run.completed',
      message: 'Automation run completed'
    })
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error)
    const failedAt = currentUnixSeconds()
    db()
      .update(automationRuns)
      .set({
        status: 'failed',
        chatSessionId,
        backendRunId,
        errorText,
        finishedAt: failedAt,
        updatedAt: failedAt
      })
      .where(eq(automationRuns.id, run.id))
      .run()
    writeEvent({
      definitionId: run.automationDefinitionId,
      runId: run.id,
      type: 'automation.run.failed',
      message: 'Automation run failed',
      attrs: { errorText, chatSessionId, backendRunId }
    })
  }

  return getRun(run.automationDefinitionId, run.id)
}

export function listRuns(definitionId: string): AutomationRunView[] {
  getDefinitionRow(definitionId)
  return db()
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationDefinitionId, definitionId))
    .orderBy(desc(automationRuns.createdAt))
    .all()
    .map(toRunView)
}

export function getRun(definitionId: string, runId: string): AutomationRunView {
  return toRunView(getRunRow(runId, definitionId))
}

export function listArtifacts(definitionId: string, runId?: string): AutomationArtifactView[] {
  getDefinitionRow(definitionId)
  const predicates = [eq(automationArtifacts.automationDefinitionId, definitionId)]
  if (runId) {
    getRunRow(runId, definitionId)
    predicates.push(eq(automationArtifacts.automationRunId, runId))
  }
  return db()
    .select()
    .from(automationArtifacts)
    .where(and(...predicates))
    .orderBy(desc(automationArtifacts.createdAt))
    .all()
    .map(toArtifactView)
}

export function getArtifact(definitionId: string, artifactId: string): AutomationArtifactView {
  getDefinitionRow(definitionId)
  const row = db()
    .select()
    .from(automationArtifacts)
    .where(
      and(
        eq(automationArtifacts.id, artifactId),
        eq(automationArtifacts.automationDefinitionId, definitionId)
      )
    )
    .get()
  if (!row) {
    throw new AppError({
      code: 'automation_artifact_not_found',
      status: 404,
      message: 'Automation artifact not found',
      details: { artifactId }
    })
  }
  return toArtifactView(row)
}
