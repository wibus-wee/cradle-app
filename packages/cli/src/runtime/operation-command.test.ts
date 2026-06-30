import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { registerOperationCommand } from './operation-command'
import type { CommandContext } from './types'

function createProgram(context: CommandContext): Command {
  return new Command()
    .exitOverride()
    .option('--server <url>', 'Cradle server URL', context.serverUrl)
    .hook('preAction', (root) => {
      root.setOptionValue('__context', context)
    })
}

describe('registerOperationCommand', () => {
  beforeEach(() => {
    delete process.env.CRADLE_WORKSPACE_ID
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.CRADLE_WORKSPACE_ID
  })

  it('preserves true, false, and omitted boolean flags', async () => {
    const run = async (argv: string[]) => {
      const request = vi.fn().mockResolvedValue({ ok: true })
      const program = createProgram({ serverUrl: 'http://localhost:21423', request })

      registerOperationCommand(program, {
        command: ['automation', 'list'],
        flags: [{ name: 'enabled', target: 'query.enabled', type: 'boolean' }],
        method: 'get',
        path: '/automations',
      })

      await program.parseAsync(argv, { from: 'user' })
      return request
    }

    await expect(run(['automation', 'list', '--enabled'])).resolves.toHaveBeenCalledWith(expect.objectContaining({
      query: { enabled: true },
    }))
    await expect(run(['automation', 'list', '--no-enabled'])).resolves.toHaveBeenCalledWith(expect.objectContaining({
      query: { enabled: false },
    }))
    await expect(run(['automation', 'list'])).resolves.toHaveBeenCalledWith(expect.objectContaining({
      query: {},
    }))
  })

  it('parses required boolean values strictly', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true })
    const program = createProgram({ serverUrl: 'http://localhost:21423', request })

    registerOperationCommand(program, {
      command: ['feature', 'set'],
      flags: [{ name: 'enabled', required: true, target: 'body.enabled', type: 'boolean' }],
      method: 'put',
      path: '/feature',
    })

    await program.parseAsync(['feature', 'set', '--enabled', 'false'], { from: 'user' })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      body: { enabled: false },
    }))
    await expect(program.parseAsync(['feature', 'set', '--enabled', 'nope'], { from: 'user' }))
      .rejects.toThrow('Expected a boolean')
  })

  it('defaults generated workspace query flags from CRADLE_WORKSPACE_ID', async () => {
    process.env.CRADLE_WORKSPACE_ID = 'workspace-1'
    const request = vi.fn().mockResolvedValue({ ok: true })
    const program = createProgram({ serverUrl: 'http://localhost:21423', request })

    registerOperationCommand(program, {
      command: ['session', 'list'],
      flags: [{
        disableEnvDefaultFlag: 'allWorkspaces',
        envDefault: 'CRADLE_WORKSPACE_ID',
        name: 'workspaceId',
        target: 'query.workspaceId',
        type: 'string',
      }],
      method: 'get',
      path: '/sessions/',
    })

    await program.parseAsync(['session', 'list'], { from: 'user' })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      query: { workspaceId: 'workspace-1' },
    }))
  })

  it('allows generated workspace query defaults to be disabled explicitly', async () => {
    process.env.CRADLE_WORKSPACE_ID = 'workspace-1'
    const request = vi.fn().mockResolvedValue({ ok: true })
    const program = createProgram({ serverUrl: 'http://localhost:21423', request })

    registerOperationCommand(program, {
      command: ['session', 'list'],
      flags: [{
        disableEnvDefaultFlag: 'allWorkspaces',
        envDefault: 'CRADLE_WORKSPACE_ID',
        name: 'workspaceId',
        target: 'query.workspaceId',
        type: 'string',
      }],
      method: 'get',
      path: '/sessions/',
    })

    await program.parseAsync(['session', 'list', '--all-workspaces'], { from: 'user' })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      query: { workspaceId: undefined },
    }))
    await expect(program.parseAsync(['session', 'list', '--workspace-id', 'workspace-2', '--all-workspaces'], { from: 'user' }))
      .rejects.toThrow('--workspace-id cannot be used with --all-workspaces')
  })

  it('omits optional workspace query flags when no workspace context is available', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true })
    const program = createProgram({ serverUrl: 'http://localhost:21423', request })

    registerOperationCommand(program, {
      command: ['issue', 'list'],
      flags: [{
        envDefault: 'CRADLE_WORKSPACE_ID',
        name: 'workspaceId',
        target: 'query.workspaceId',
        type: 'string',
      }],
      method: 'get',
      path: '/issues/',
    })

    await program.parseAsync(['issue', 'list'], { from: 'user' })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      query: { workspaceId: undefined },
    }))
  })

  it('allows required workspace flags to be satisfied by CRADLE_WORKSPACE_ID', async () => {
    process.env.CRADLE_WORKSPACE_ID = 'workspace-1'
    const request = vi.fn().mockResolvedValue({ ok: true })
    const program = createProgram({ serverUrl: 'http://localhost:21423', request })

    registerOperationCommand(program, {
      command: ['issue', 'create'],
      flags: [{
        envDefault: 'CRADLE_WORKSPACE_ID',
        name: 'workspaceId',
        required: true,
        target: 'body.workspaceId',
        type: 'string',
      }],
      method: 'post',
      path: '/issues/',
    })

    await program.parseAsync(['issue', 'create'], { from: 'user' })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      body: { workspaceId: 'workspace-1' },
    }))
  })
})
