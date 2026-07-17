import { Command } from 'commander'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerSessionAwaitCommand } from './session-await'
import type { CommandContext } from '../runtime/types'

function createProgram(context: CommandContext): Command {
  return new Command()
    .exitOverride()
    .option('--server <url>', 'Cradle server URL', context.serverUrl)
    .hook('preAction', (root) => {
      root.setOptionValue('__context', context)
    })
}

async function runCommand(argv: string[], env: Record<string, string | undefined> = {}): Promise<ReturnType<typeof vi.fn>> {
  const request = vi.fn().mockResolvedValue({ id: 'await-1', status: 'pending' })
  const program = createProgram({ serverUrl: 'http://localhost:21423', request })
  const previousChatSessionId = process.env.CRADLE_CHAT_SESSION_ID
  const previousWorkspaceId = process.env.CRADLE_WORKSPACE_ID

  process.env.CRADLE_CHAT_SESSION_ID = env.CRADLE_CHAT_SESSION_ID
  process.env.CRADLE_WORKSPACE_ID = env.CRADLE_WORKSPACE_ID

  registerSessionAwaitCommand(program)
  vi.spyOn(console, 'log').mockImplementation(() => {})

  try {
    await program.parseAsync(argv, { from: 'user' })
    return request
  }
  finally {
    process.env.CRADLE_CHAT_SESSION_ID = previousChatSessionId
    process.env.CRADLE_WORKSPACE_ID = previousWorkspaceId
  }
}

describe('registerSessionAwaitCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'

  it('registers a GitHub CI pull request await with session context from environment variables', async () => {
    const request = await runCommand(['session', 'await', 'github-ci', 'acme/app', '--pr', '42'], {
      CRADLE_CHAT_SESSION_ID: 'session-1',
      CRADLE_WORKSPACE_ID: WORKSPACE_ID,
    })

    expect(request).toHaveBeenCalledWith({
      body: {
        chatSessionId: 'session-1',
        workspaceId: WORKSPACE_ID,
        source: 'github-ci',
        filterJson: JSON.stringify({ repo: 'acme/app', pr: 42 }),
      },
      method: 'post',
      path: {},
      query: {},
      template: '/session-awaits/',
    })
  })

  it('requires exactly one GitHub CI target', async () => {
    await expect(runCommand(['session', 'await', 'github-ci', 'acme/app', '--pr', '42', '--sha', 'abc'], {
      CRADLE_CHAT_SESSION_ID: 'session-1',
      CRADLE_WORKSPACE_ID: WORKSPACE_ID,
    })).rejects.toThrow('Pass exactly one GitHub CI target')
  })

  it('registers a GitHub review await with explicit review mode', async () => {
    const request = await runCommand([
      'session',
      'await',
      'github-review',
      'acme/app',
      '--pr',
      '42',
      '--mode',
      'approved',
      '--chat-session-id',
      'session-1',
      '--workspace',
      WORKSPACE_ID,
    ])

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        source: 'github-review',
        filterJson: JSON.stringify({ repo: 'acme/app', pr: 42, mode: 'approved' }),
      }),
    }))
  })

  it('registers a manual await with an empty filter', async () => {
    const request = await runCommand([
      'session',
      'await',
      'manual',
      '--reason',
      'Waiting for deploy approval',
      '--chat-session-id',
      'session-1',
      '--workspace',
      WORKSPACE_ID,
    ])

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        source: 'manual',
        filterJson: '{}',
        reason: 'Waiting for deploy approval',
      }),
    }))
  })

  it('registers a javascript await with an inline program', async () => {
    const request = await runCommand([
      'session',
      'await',
      'javascript',
      '--program',
      'export default async () => false',
    ], {
      CRADLE_CHAT_SESSION_ID: 'session-1',
      CRADLE_WORKSPACE_ID: WORKSPACE_ID,
    })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        source: 'javascript',
        filterJson: '{"program":"export default async () => false"}',
      }),
    }))
  })

  it('forwards a bare function expression for server-side normalization', async () => {
    const request = await runCommand([
      'session',
      'await',
      'javascript',
      '--program',
      'async () => false',
    ], {
      CRADLE_CHAT_SESSION_ID: 'session-1',
      CRADLE_WORKSPACE_ID: WORKSPACE_ID,
    })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        filterJson: '{"program":"async () => false"}',
      }),
    }))
  })

  it('reads the javascript await program from a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cradle-cli-await-'))
    const programFile = join(dir, 'cell.mjs')
    writeFileSync(programFile, 'export default async () => false\n')

    try {
      const request = await runCommand([
        'session',
        'await',
        'javascript',
        '--program-file',
        programFile,
      ], {
        CRADLE_CHAT_SESSION_ID: 'session-1',
        CRADLE_WORKSPACE_ID: WORKSPACE_ID,
      })

      expect(request).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          source: 'javascript',
          filterJson: '{"program":"export default async () => false\\n"}',
        }),
      }))
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('requires exactly one of --program and --program-file for javascript awaits', async () => {
    await expect(runCommand([
      'session',
      'await',
      'javascript',
      '--program',
      'export default async () => false',
      '--program-file',
      '/tmp/cell.mjs',
    ], {
      CRADLE_CHAT_SESSION_ID: 'session-1',
      CRADLE_WORKSPACE_ID: WORKSPACE_ID,
    })).rejects.toThrow('exactly one')
  })

  it('resolves an explicit --workspace name by listing workspaces', async () => {
    const request = vi.fn().mockImplementation(async (input: { template: string }) => {
      if (input.template === '/workspaces') {
        return [{ id: WORKSPACE_ID, locator: { path: '/repo/app' }, name: 'app' }]
      }
      return { id: 'await-1', status: 'pending' }
    })
    const program = createProgram({ serverUrl: 'http://localhost:21423', request })
    registerSessionAwaitCommand(program)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await program.parseAsync([
      'session',
      'await',
      'manual',
      '--reason',
      'Waiting for deploy approval',
      '--chat-session-id',
      'session-1',
      '--workspace',
      'app',
    ], { from: 'user' })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ workspaceId: WORKSPACE_ID }),
    }))
  })

  it('retries delivery through the retry-delivery route', async () => {
    const request = await runCommand([
      'session',
      'await',
      'retry',
      'await-1',
      '--resume-text',
      'CI passed',
    ])

    expect(request).toHaveBeenCalledWith({
      body: { resumeText: 'CI passed' },
      method: 'post',
      path: { id: 'await-1' },
      query: {},
      template: '/session-awaits/{id}/retry-delivery',
    })
  })

  it('forwards blank retry replacement text to the server for validation', async () => {
    const request = await runCommand([
      'session',
      'await',
      'retry',
      'await-1',
      '--resume-text',
      '   ',
    ])

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      body: { resumeText: '   ' },
    }))
  })
})
