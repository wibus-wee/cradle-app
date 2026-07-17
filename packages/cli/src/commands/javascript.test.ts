import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerJavascriptCommand } from './javascript'
import type { CommandContext } from '../runtime/types'

function createProgram(context: CommandContext): Command {
  return new Command()
    .exitOverride()
    .option('--server <url>', 'Cradle server URL', context.serverUrl)
    .hook('preAction', (root) => {
      root.setOptionValue('__context', context)
    })
}

async function runCommand(argv: string[]): Promise<ReturnType<typeof vi.fn>> {
  const request = vi.fn().mockResolvedValue({ ok: true, result: false })
  const program = createProgram({ serverUrl: 'http://localhost:21423', request })
  registerJavascriptCommand(program)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await program.parseAsync(argv, { from: 'user' })
  return request
}

describe('registerJavascriptCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('evaluates a program file through the evaluate route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cradle-cli-js-'))
    const programFile = join(dir, 'cell.mjs')
    writeFileSync(programFile, 'export default async () => false\n')

    try {
      const request = await runCommand(['javascript', 'evaluate', '--program-file', programFile])

      expect(request).toHaveBeenCalledWith({
        body: { program: 'export default async () => false\n' },
        method: 'post',
        path: {},
        query: {},
        template: '/javascript/evaluate',
      })
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('forwards a bare function expression, cwd, and timeout', async () => {
    const request = await runCommand([
      'javascript',
      'evaluate',
      '--program',
      'async ({ tools }) => false',
      '--cwd',
      '/tmp/work',
      '--timeout-ms',
      '5000',
    ])

    expect(request).toHaveBeenCalledWith({
      body: {
        program: 'async ({ tools }) => false',
        cwd: '/tmp/work',
        timeoutMs: 5000,
      },
      method: 'post',
      path: {},
      query: {},
      template: '/javascript/evaluate',
    })
  })

  it('requires exactly one of --program and --program-file', async () => {
    await expect(runCommand([
      'javascript',
      'evaluate',
      '--program',
      'async () => false',
      '--program-file',
      '/tmp/cell.mjs',
    ])).rejects.toThrow('exactly one')
  })
})
