import { Elysia, t } from 'elysia'

import { AutomationModel } from './model'
import * as AutomationPoller from './poller'
import * as Automation from './service'

type CronJobCreate = {
  id: string
  workspaceId?: string | null
  title: string
  description?: string
  enabled?: boolean
  scheduleKind: 'rrule'
  scheduleConfig: string
  timezone: string
  prompt: string
  providerTargetId?: string
  modelId?: string
}

type CronJobUpdate = Partial<Omit<CronJobCreate, 'id' | 'workspaceId'>>

function projectCronJob(definition: Automation.AutomationDefinitionView) {
  return {
    id: definition.id,
    automationDefinitionId: definition.id,
    workspaceId: definition.workspaceId,
    title: definition.title,
    description: definition.description,
    enabled: definition.enabled,
    scheduleKind: 'rrule' as const,
    scheduleConfig: definition.trigger.rrule,
    timezone: definition.trigger.timezone,
    prompt: definition.recipe.prompt,
    providerTargetId: definition.recipe.providerTargetId ?? null,
    modelId: definition.recipe.modelId ?? null,
    nextRunAt: definition.nextRunAt,
    lastRunAt: definition.lastRunAt,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  }
}

function createCronJob(input: CronJobCreate) {
  return projectCronJob(Automation.create({
    id: input.id,
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description,
    enabled: input.enabled,
    trigger: {
      type: 'rrule',
      rrule: input.scheduleConfig,
      timezone: input.timezone,
    },
    recipe: {
      kind: 'agent_task',
      prompt: input.prompt,
      inputs: [],
      artifactRequests: [],
      providerTargetId: input.providerTargetId,
      modelId: input.modelId,
    },
    createdByKind: 'user',
  }))
}

function updateCronJob(id: string, input: CronJobUpdate) {
  const existing = Automation.get(id)
  const triggerChanged = input.scheduleConfig !== undefined || input.timezone !== undefined
  const recipeChanged = input.prompt !== undefined || input.providerTargetId !== undefined || input.modelId !== undefined
  let updated = Automation.update(id, {
    title: input.title,
    description: input.description,
    trigger: triggerChanged
      ? {
          type: 'rrule',
          rrule: input.scheduleConfig ?? existing.trigger.rrule,
          timezone: input.timezone ?? existing.trigger.timezone,
          misfirePolicy: existing.trigger.misfirePolicy,
        }
      : undefined,
    recipe: recipeChanged
      ? {
          ...existing.recipe,
          prompt: input.prompt ?? existing.recipe.prompt,
          providerTargetId: input.providerTargetId ?? existing.recipe.providerTargetId,
          modelId: input.modelId ?? existing.recipe.modelId,
        }
      : undefined,
  })

  if (input.enabled !== undefined && input.enabled !== updated.enabled) {
    updated = Automation.setEnabled(id, input.enabled)
  }

  return projectCronJob(updated)
}

const automationRoutes = new Elysia({
  prefix: '/automations',
  detail: { tags: ['automation'] },
})
  .post('/', ({ body }) => Automation.create(body), {
    detail: {
      'summary': 'Create automation',
      'x-cradle-cli': { command: ['automation', 'create'] },
    },
    body: AutomationModel.createBody,
    response: { 200: AutomationModel.definition },
  })
  .get('/', ({ query }) => Automation.list(query), {
    detail: {
      'summary': 'List automations',
      'x-cradle-cli': { command: ['automation', 'list'] },
    },
    query: AutomationModel.listQuery,
    response: { 200: t.Array(AutomationModel.definition) },
  })
  .get('/:id', ({ params }) => Automation.get(params.id), {
    detail: {
      'summary': 'Get automation',
      'x-cradle-cli': { command: ['automation', 'get'] },
    },
    params: AutomationModel.idParams,
    response: { 200: AutomationModel.definition },
  })
  .patch('/:id', ({ params, body }) => Automation.update(params.id, body), {
    detail: {
      'summary': 'Update automation',
      'x-cradle-cli': { command: ['automation', 'update'] },
    },
    params: AutomationModel.idParams,
    body: AutomationModel.updateBody,
    response: { 200: AutomationModel.definition },
  })
  .delete('/:id', ({ params }) => {
    Automation.remove(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete automation',
      'x-cradle-cli': { command: ['automation', 'delete'] },
    },
    params: AutomationModel.idParams,
    response: { 200: AutomationModel.ok },
  })
  .post('/:id/enable', ({ params }) => Automation.setEnabled(params.id, true), {
    detail: {
      'summary': 'Enable automation',
      'x-cradle-cli': { command: ['automation', 'enable'] },
    },
    params: AutomationModel.idParams,
    response: { 200: AutomationModel.definition },
  })
  .post('/:id/disable', ({ params }) => Automation.setEnabled(params.id, false), {
    detail: {
      'summary': 'Disable automation',
      'x-cradle-cli': { command: ['automation', 'disable'] },
    },
    params: AutomationModel.idParams,
    response: { 200: AutomationModel.definition },
  })
  .post('/:id/run', ({ params, body }) => Automation.runNow(params.id, body), {
    detail: {
      'summary': 'Run automation now',
      'x-cradle-cli': { command: ['automation', 'run'] },
    },
    params: AutomationModel.idParams,
    body: AutomationModel.runNowBody,
    response: { 200: AutomationModel.run },
  })
  .get('/:id/runs', ({ params }) => Automation.listRuns(params.id), {
    detail: {
      'summary': 'List automation runs',
      'x-cradle-cli': { command: ['automation', 'runs'] },
    },
    params: AutomationModel.idParams,
    response: { 200: t.Array(AutomationModel.run) },
  })
  .get('/:id/runs/:runId', ({ params }) => Automation.getRun(params.id, params.runId), {
    detail: {
      'summary': 'Get automation run',
      'x-cradle-cli': { command: ['automation', 'run', 'get'] },
    },
    params: AutomationModel.runIdParams,
    response: { 200: AutomationModel.run },
  })
  .post('/:id/runs/:runId/stop', ({ params }) => Automation.stopRun(params.id, params.runId), {
    detail: {
      'summary': 'Stop automation run',
      'x-cradle-cli': { command: ['automation', 'run', 'stop'] },
    },
    params: AutomationModel.runIdParams,
    response: { 200: AutomationModel.run },
  })
  .patch('/:id/runs/:runId/triage', ({ params, body }) => Automation.setTriageStatus(params.id, params.runId, body.status), {
    detail: {
      'summary': 'Update automation run triage state',
      'x-cradle-cli': { command: ['automation', 'run', 'triage'] },
    },
    params: AutomationModel.runIdParams,
    body: AutomationModel.triageBody,
    response: { 200: AutomationModel.run },
  })
  .get('/:id/runs/:runId/artifacts', ({ params }) => Automation.listArtifacts(params.id, params.runId), {
    detail: {
      'summary': 'List automation run artifacts',
      'x-cradle-cli': { command: ['automation', 'artifacts'] },
    },
    params: AutomationModel.runIdParams,
    response: { 200: t.Array(AutomationModel.artifact) },
  })
  .get('/:id/artifacts', ({ params }) => Automation.listArtifacts(params.id), {
    detail: {
      'summary': 'List automation artifacts',
      'x-cradle-cli': { command: ['automation', 'artifact', 'list'] },
    },
    params: AutomationModel.idParams,
    response: { 200: t.Array(AutomationModel.artifact) },
  })
  .get('/:id/artifacts/:artifactId', ({ params }) => Automation.getArtifact(params.id, params.artifactId), {
    detail: {
      'summary': 'Get automation artifact',
      'x-cradle-cli': { command: ['automation', 'artifact', 'get'] },
    },
    params: AutomationModel.artifactIdParams,
    response: { 200: AutomationModel.artifact },
  })

const automationTriageRoutes = new Elysia({
  prefix: '/automation-triage',
  detail: { tags: ['automation'] },
}).get('/', ({ query }) => Automation.listTriage(query), {
  detail: {
    'summary': 'List automation triage inbox',
    'x-cradle-cli': { command: ['automation', 'triage', 'list'] },
  },
  query: AutomationModel.triageQuery,
  response: { 200: t.Array(AutomationModel.run) },
})

const cronRoutes = new Elysia({
  prefix: '/cron',
  detail: { tags: ['automation'] },
})
  .post('/jobs', ({ body }) => createCronJob(body), {
    detail: { summary: 'Create cron-compatible automation job' },
    body: AutomationModel.cronCreateBody,
  })
  .get('/jobs', ({ query }) => Automation.list(query).map(projectCronJob), {
    detail: { summary: 'List cron-compatible automation jobs' },
    query: AutomationModel.listQuery,
  })
  .get('/jobs/:id', ({ params }) => projectCronJob(Automation.get(params.id)), {
    detail: { summary: 'Get cron-compatible automation job' },
    params: AutomationModel.cronJobIdParams,
  })
  .put('/jobs/:id', ({ params, body }) => updateCronJob(params.id, body), {
    detail: { summary: 'Update cron-compatible automation job' },
    params: AutomationModel.cronJobIdParams,
    body: AutomationModel.cronUpdateBody,
  })
  .delete('/jobs/:id', ({ params }) => {
    Automation.remove(params.id)
    return { ok: true as const }
  }, {
    detail: { summary: 'Delete cron-compatible automation job' },
    params: AutomationModel.cronJobIdParams,
    response: { 200: AutomationModel.ok },
  })
  .get('/runs', ({ query }) => Automation.listRuns(query.jobId), {
    detail: { summary: 'List cron-compatible automation runs' },
    query: AutomationModel.cronRunsQuery,
    response: { 200: t.Array(AutomationModel.run) },
  })

export const automation = new Elysia()
  .onStart(() => { AutomationPoller.start() })
  .onStop(() => { AutomationPoller.stop() })
  .use(automationRoutes)
  .use(automationTriageRoutes)
  .use(cronRoutes)
