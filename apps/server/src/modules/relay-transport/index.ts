import { Elysia, t } from 'elysia'

import * as HostEnrollment from './host-enrollment-service'
import { RelayHostEnrollmentModel } from './model'

/**
 * Host-side relay-transport routes.
 *
 * These run on the REMOTE (possibly headless) Cradle Server — the one that
 * initiates pairing and accepts incoming tunnels. The controller side (claim,
 * local TCP tunnel) lives under /remote-hosts.
 */
export const relayTransport = new Elysia({
  prefix: '/relay-transport',
  detail: { tags: ['relay-transport'] },
})
  .get('/host-enrollments', () => HostEnrollment.listHostEnrollments(), {
    detail: {
      'summary': 'List relay host enrollments',
      'x-cradle-cli': { command: ['relay-transport', 'host-enrollment', 'list'] },
    },
    response: { 200: t.Array(RelayHostEnrollmentModel.hostEnrollment) },
  })
  .post('/host-enrollments', ({ body }) => HostEnrollment.createHostEnrollment({
    id: body.id,
    displayName: body.displayName,
    relayUrl: body.relayUrl,
  }), {
    detail: {
      'summary': 'Create a relay host enrollment and start pairing',
      'x-cradle-cli': { command: ['relay-transport', 'host-enrollment', 'create'] },
    },
    body: RelayHostEnrollmentModel.createEnrollmentBody,
    response: { 200: RelayHostEnrollmentModel.createdEnrollment },
  })
  .get('/host-enrollments/:enrollmentId', ({ params }) => HostEnrollment.readHostEnrollment(params.enrollmentId), {
    detail: {
      'summary': 'Read a relay host enrollment',
      'x-cradle-cli': { command: ['relay-transport', 'host-enrollment', 'get'] },
    },
    params: RelayHostEnrollmentModel.enrollmentIdParams,
    response: { 200: RelayHostEnrollmentModel.hostEnrollment },
  })
  .get('/host-enrollments/:enrollmentId/pairing-string', ({ params }) => HostEnrollment.readHostEnrollmentPairingString(params.enrollmentId), {
    detail: {
      'summary': 'Re-read the pairing string for an enrollment',
      'x-cradle-cli': { command: ['relay-transport', 'host-enrollment', 'pairing-string'] },
    },
    params: RelayHostEnrollmentModel.enrollmentIdParams,
    response: { 200: RelayHostEnrollmentModel.pairingString },
  })
  .delete('/host-enrollments/:enrollmentId', async ({ params }) => {
    await HostEnrollment.deleteHostEnrollment(params.enrollmentId)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete a relay host enrollment',
      'x-cradle-cli': { command: ['relay-transport', 'host-enrollment', 'delete'] },
    },
    params: RelayHostEnrollmentModel.enrollmentIdParams,
    response: { 200: RelayHostEnrollmentModel.ok },
  })
