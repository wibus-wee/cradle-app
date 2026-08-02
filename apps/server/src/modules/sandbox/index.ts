import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { registerSandboxMaintenance } from './maintenance'
import { SandboxModel } from './model'
import * as Sandbox from './service'

Sandbox.registerSandboxSessionHooks()

export const sandbox = new Elysia({
  prefix: '/sandboxes',
  detail: { tags: ['sandbox'] },
})
  .get('/profiles', () => Sandbox.listProfiles(), {
    detail: {
      'summary': 'List sandbox profiles',
      'x-cradle-cli': { command: ['sandbox', 'profiles'] },
    },
    response: { 200: t.Array(SandboxModel.profile) },
  })
  .get('/pool', async () => await Sandbox.getPoolStatus(), {
    detail: {
      'summary': 'Show sandbox pool status',
      'x-cradle-cli': { command: ['sandbox', 'pool'] },
    },
    response: { 200: SandboxModel.poolStatus },
  })
  .get('/leases', ({ query }) => Sandbox.listLeases(query), {
    detail: {
      'summary': 'List sandbox leases',
      'x-cradle-cli': { command: ['sandbox', 'leases'] },
    },
    query: SandboxModel.listLeasesQuery,
    response: { 200: t.Array(SandboxModel.lease) },
  })
  .post('/leases', async ({ body }) => await Sandbox.leaseSandbox(body), {
    detail: {
      'summary': 'Lease a sandbox from the OrbStack/Docker pool',
      'x-cradle-cli': {
        command: ['sandbox', 'lease'],
        defaultWorkspaceId: true,
      },
    },
    body: SandboxModel.leaseBody,
    response: { 200: SandboxModel.lease },
  })
  .get('/leases/:leaseId', ({ params }) => {
    const lease = Sandbox.listLeases({ includeReleased: true })
      .find(item => item.id === params.leaseId)
    if (!lease) {
      throw new AppError({
        code: 'sandbox_lease_not_found',
        status: 404,
        message: `Sandbox lease not found: ${params.leaseId}`,
      })
    }
    return lease
  }, {
    detail: {
      'summary': 'Get a sandbox lease',
      'x-cradle-cli': { command: ['sandbox', 'get'] },
    },
    params: SandboxModel.leaseIdParams,
    response: { 200: SandboxModel.lease },
  })
  .post('/leases/:leaseId/exec', async ({ params, body }) => await Sandbox.execInLease({
    leaseId: params.leaseId,
    ...body,
  }), {
    detail: {
      'summary': 'Execute a command inside a leased sandbox',
      'x-cradle-cli': { command: ['sandbox', 'exec'] },
    },
    params: SandboxModel.leaseIdParams,
    body: SandboxModel.execBody,
    response: { 200: SandboxModel.execResult },
  })
  .post('/leases/:leaseId/release', async ({ params }) => await Sandbox.releaseLease(params.leaseId), {
    detail: {
      'summary': 'Release a sandbox lease',
      'x-cradle-cli': { command: ['sandbox', 'release'] },
    },
    params: SandboxModel.leaseIdParams,
    response: { 200: SandboxModel.lease },
  })
  .post('/reconcile', async () => await Sandbox.reconcilePool(), {
    detail: {
      'summary': 'Reconcile sandbox pool against the container engine',
      'x-cradle-cli': { command: ['sandbox', 'reconcile'] },
    },
    response: { 200: SandboxModel.reconcileResult },
  })

export { registerSandboxMaintenance }
export * as Sandbox from './service'
