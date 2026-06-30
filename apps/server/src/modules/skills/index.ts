import { Elysia, t } from 'elysia'

import { SkillsModel } from './model'
import * as Skills from './service'

export const skills = new Elysia({
  prefix: '/skills',
  detail: { tags: ['skills'] },
})
  .get('', ({ query }) => Skills.list({
    workspaceId: query.workspaceId,
    agentId: query.agentId,
  }), {
    detail: {
      'summary': 'List skills',
      'x-cradle-cli': {
        command: ['skill', 'list'],
      },
    },
    query: SkillsModel.listQuery,
    response: { 200: t.Array(SkillsModel.skillInventoryEntry) },
  })
  .get('/document', ({ query }) => Skills.get({
    scope: query.scope,
    name: query.name,
    workspaceId: query.workspaceId,
    agentId: query.agentId,
  }), {
    detail: {
      'summary': 'Get skill document',
      'x-cradle-cli': {
        command: ['skill', 'document', 'get'],
      },
    },
    query: SkillsModel.lookupQuery,
    response: { 200: SkillsModel.skillDocument },
  })
  .post('', ({ body }) => Skills.create(body), {
    detail: {
      'summary': 'Create skill',
      'x-cradle-cli': {
        command: ['skill', 'create'],
      },
    },
    body: SkillsModel.createBody,
    response: { 200: SkillsModel.skillDocument },
  })
  .put('/document', ({ body }) => Skills.update(body), {
    detail: {
      'summary': 'Update skill document',
      'x-cradle-cli': {
        command: ['skill', 'document', 'update'],
      },
    },
    body: SkillsModel.updateBody,
    response: { 200: SkillsModel.skillDocument },
  })
  .delete('/document', async ({ query }) => {
    await Skills.remove({
      scope: query.scope,
      name: query.name,
      workspaceId: query.workspaceId,
      agentId: query.agentId,
    })
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete skill',
      'x-cradle-cli': {
        command: ['skill', 'document', 'delete'],
      },
    },
    query: SkillsModel.lookupQuery,
    response: { 200: SkillsModel.okResponse },
  })
  .post('/import', ({ body }) => Skills.importSkill(body), {
    detail: {
      'summary': 'Import skill',
      'x-cradle-cli': {
        command: ['skill', 'import'],
      },
    },
    body: SkillsModel.importBody,
    response: { 200: SkillsModel.skillDocument },
  })
  .post('/export', ({ body }) => Skills.exportSkill(body), {
    detail: {
      'summary': 'Export skill',
      'x-cradle-cli': {
        command: ['skill', 'export'],
      },
    },
    body: SkillsModel.exportBody,
    response: { 200: SkillsModel.exportResponse },
  })
  .post('/fetch-source', async ({ body }) => {
    const result = await Skills.fetchSource(body.source)
    return {
      sessionId: result.sessionId,
      source: result.source,
      skills: result.skills.map(s => ({ skillDir: s.skillDir, relativePath: s.relativePath, name: s.name, description: s.description })),
    }
  }, {
    detail: {
      'summary': 'Fetch skill source',
      'x-cradle-cli': {
        command: ['skill', 'source', 'fetch'],
      },
    },
    body: SkillsModel.fetchSourceBody,
    response: { 200: SkillsModel.fetchSourceResult },
  })
  .post('/import-from-fetch', ({ body }) => Skills.importFromFetch(body), {
    detail: {
      'summary': 'Import skills from fetch',
      'x-cradle-cli': {
        command: ['skill', 'source', 'import'],
      },
    },
    body: SkillsModel.importFromFetchBody,
    response: { 200: SkillsModel.importFromFetchResult },
  })
  .post('/cancel-fetch', async ({ body }) => {
    await Skills.cancelFetch(body.sessionId)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Cancel fetch',
      'x-cradle-cli': {
        command: ['skill', 'source', 'cancel-fetch'],
      },
    },
    body: SkillsModel.cancelFetchBody,
    response: { 200: SkillsModel.okResponse },
  })
