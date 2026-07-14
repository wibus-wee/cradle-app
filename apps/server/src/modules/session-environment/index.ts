import { Elysia } from 'elysia'

import { SessionEnvironmentModel } from './model'
import * as SessionEnvironment from './service'

export const sessionEnvironment = new Elysia({
  prefix: '/sessions',
  detail: { tags: ['session-environment'] },
})
  .get('/:id/environment', ({ params }) => SessionEnvironment.getEnvironment(params.id), {
    detail: {
      'summary': 'Get the dense environment snapshot for a chat session',
      'x-cradle-cli': { command: ['chat', 'session', 'environment'], defaultChatSessionId: true },
    },
    params: SessionEnvironmentModel.sessionParams,
    response: { 200: SessionEnvironmentModel.environment },
  })
  .put('/:id/environment/notes', ({ params, body }) => SessionEnvironment.setNotes(params.id, body.notes), {
    detail: { summary: 'Update session environment notes' },
    params: SessionEnvironmentModel.sessionParams,
    body: SessionEnvironmentModel.notesBody,
    response: { 200: SessionEnvironmentModel.notesResponse },
  })
  .post('/:id/environment/pins/:messageId', ({ params }) => SessionEnvironment.addPin(params.id, params.messageId), {
    detail: { summary: 'Pin a transcript message in the session environment' },
    params: SessionEnvironmentModel.messageParams,
    response: { 200: SessionEnvironmentModel.pin },
  })
  .patch('/:id/environment/pins/:messageId', ({ params, body }) => SessionEnvironment.updatePin(params.id, params.messageId, body), {
    detail: { summary: 'Update a pinned transcript message' },
    params: SessionEnvironmentModel.messageParams,
    body: SessionEnvironmentModel.pinPatchBody,
    response: { 200: SessionEnvironmentModel.pin },
  })
  .delete('/:id/environment/pins/:messageId', ({ params }) => SessionEnvironment.removePin(params.id, params.messageId), {
    detail: { summary: 'Remove a pinned transcript message' },
    params: SessionEnvironmentModel.messageParams,
    response: { 200: SessionEnvironmentModel.ok },
  })
  .post('/:id/environment/markers', ({ params, body }) => SessionEnvironment.addMarker(params.id, body), {
    detail: { summary: 'Create a transcript text marker' },
    params: SessionEnvironmentModel.sessionParams,
    body: SessionEnvironmentModel.markerCreateBody,
    response: { 200: SessionEnvironmentModel.marker },
  })
  .patch('/:id/environment/markers/:markerId', ({ params, body }) => SessionEnvironment.updateMarker(params.id, params.markerId, body), {
    detail: { summary: 'Update a transcript text marker' },
    params: SessionEnvironmentModel.markerParams,
    body: SessionEnvironmentModel.markerPatchBody,
    response: { 200: SessionEnvironmentModel.marker },
  })
  .delete('/:id/environment/markers/:markerId', ({ params }) => SessionEnvironment.removeMarker(params.id, params.markerId), {
    detail: { summary: 'Remove a transcript text marker' },
    params: SessionEnvironmentModel.markerParams,
    response: { 200: SessionEnvironmentModel.ok },
  })
