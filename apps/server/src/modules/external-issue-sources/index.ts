import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { ExternalIssueSourcesModel } from './model'
import * as ExternalIssueSources from './service'

export const externalIssueSources = new Elysia({
  detail: { tags: ['external-issue-sources'] },
})
  .get('/external-issue-sources', () => ExternalIssueSources.listExternalIssueSources(), {
    detail: {
      'summary': 'List external issue sources',
      'x-cradle-cli': { command: ['external-issue-source', 'list'] },
    },
    response: { 200: t.Array(ExternalIssueSourcesModel.source) },
  })
  .get('/external-issue-sources/bindings', ({ query }) => ExternalIssueSources.listExternalIssueSourceBindings(query), {
    detail: {
      'summary': 'List external issue source bindings',
      'x-cradle-cli': { command: ['external-issue-source', 'binding', 'list'] },
    },
    query: ExternalIssueSourcesModel.listBindingsQuery,
    response: { 200: t.Array(ExternalIssueSourcesModel.binding) },
  })
  .post('/external-issue-sources/:sourceKey/bindings', ({ params, body }) => {
    return ExternalIssueSources.createExternalIssueSourceBinding({
      sourceKey: params.sourceKey,
      ...body,
    })
  }, {
    detail: {
      'summary': 'Bind an external issue repository to a workspace',
      'x-cradle-cli': { command: ['external-issue-source', 'bind'] },
    },
    params: ExternalIssueSourcesModel.sourceParams,
    body: ExternalIssueSourcesModel.createBindingBody,
    response: { 200: ExternalIssueSourcesModel.binding },
  })
  .delete('/external-issue-sources/bindings/:bindingId', ({ params }) => ExternalIssueSources.deleteExternalIssueSourceBinding(params.bindingId), {
    detail: {
      'summary': 'Delete an external issue source binding',
      'x-cradle-cli': { command: ['external-issue-source', 'binding', 'delete'] },
    },
    params: ExternalIssueSourcesModel.bindingParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .patch('/external-issue-sources/bindings/:bindingId', ({ params, body }) => {
    return ExternalIssueSources.updateExternalIssueSourceBinding(params.bindingId, body)
  }, {
    detail: {
      'summary': 'Update an external issue source binding',
      'x-cradle-cli': { command: ['external-issue-source', 'binding', 'update'] },
    },
    params: ExternalIssueSourcesModel.bindingParams,
    body: ExternalIssueSourcesModel.updateBindingBody,
    response: { 200: ExternalIssueSourcesModel.binding },
  })
  .post('/external-issue-sources/bindings/:bindingId/refresh', ({ params, body }) => {
    return ExternalIssueSources.refreshExternalIssueSourceBinding(params.bindingId, body)
  }, {
    detail: {
      'summary': 'Refresh an external issue source binding',
      'x-cradle-cli': { command: ['external-issue-source', 'refresh'] },
    },
    params: ExternalIssueSourcesModel.bindingParams,
    body: ExternalIssueSourcesModel.refreshBindingBody,
    response: { 200: ExternalIssueSourcesModel.refreshResult },
  })
  .post('/external-issue-sources/:sourceKey/refresh', ({ params, body }) => {
    return ExternalIssueSources.refreshExternalIssueSource(params.sourceKey, body)
  }, {
    detail: {
      'summary': 'Refresh external issue source bindings for a workspace',
      'x-cradle-cli': { command: ['external-issue-source', 'refresh-source'] },
    },
    params: ExternalIssueSourcesModel.sourceParams,
    body: ExternalIssueSourcesModel.refreshSourceBody,
    response: { 200: t.Array(ExternalIssueSourcesModel.refreshResult) },
  })
  .get('/external-issue-sources/items', ({ query }) => ExternalIssueSources.listExternalIssueItems(query), {
    detail: {
      'summary': 'List external issue items',
      'x-cradle-cli': { command: ['external-issue-source', 'item', 'list'] },
    },
    query: ExternalIssueSourcesModel.listItemsQuery,
    response: { 200: t.Array(ExternalIssueSourcesModel.item) },
  })
  .patch('/external-issue-sources/items/:id', ({ params }) => {
    throw new AppError({
      code: 'external_issue_item_read_only',
      status: 403,
      message: 'External issue items are read-only. Move the item status instead.',
      details: { itemId: params.id },
    })
  }, {
    detail: {
      summary: 'Reject source-owned external issue item edits',
    },
    params: ExternalIssueSourcesModel.itemParams,
    body: t.Record(t.String(), t.Any()),
  })
  .patch('/external-issue-sources/items/:id/status', ({ params, body }) => {
    return ExternalIssueSources.updateExternalIssueItemStatus(params.id, body)
  }, {
    detail: {
      'summary': 'Update external issue item status',
      'x-cradle-cli': { command: ['external-issue-source', 'item', 'move'] },
    },
    params: ExternalIssueSourcesModel.itemParams,
    body: ExternalIssueSourcesModel.updateItemStatusBody,
    response: { 200: ExternalIssueSourcesModel.item },
  })
