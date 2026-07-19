import { Command } from 'commander'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyOpenPathSugar,
  buildOpenWorkspaceDeepLink,
  expandOpenPath,
  looksLikeOpenPathArg,
  registerOpenCommand,
  runOpenCommand,
  splitCliArgv,
} from './open'
import type { CommandContext } from '../runtime/types'

const KNOWN = new Set(['open', 'workspace', 'issue', 'session', 'man', 'help', 'javascript', 'plugin-dev'])

function createProgram(context: CommandContext): Command {
  return new Command()
    .exitOverride()
    .option('--server <url>', 'Cradle server URL', context.serverUrl)
    .hook('preAction', (root) => {
      root.setOptionValue('__context', context)
    })
}

describe('open path helpers', () => {
  it('expands ., ~, and relative segments to absolute paths', () => {
    expect(expandOpenPath('.')).toBe(process.cwd())
    expect(expandOpenPath('..')).toBe(resolve(process.cwd(), '..'))
    expect(expandOpenPath('~').startsWith('/')).toBe(true)
    expect(expandOpenPath('src')).toBe(join(process.cwd(), 'src'))
  })

  it('detects path-like args without stealing known commands', () => {
    expect(looksLikeOpenPathArg('.', KNOWN)).toBe(true)
    expect(looksLikeOpenPathArg('..', KNOWN)).toBe(true)
    expect(looksLikeOpenPathArg('/tmp', KNOWN)).toBe(true)
    expect(looksLikeOpenPathArg('~/dev', KNOWN)).toBe(true)
    expect(looksLikeOpenPathArg('issue', KNOWN)).toBe(false)
    expect(looksLikeOpenPathArg('workspace', KNOWN)).toBe(false)
    expect(looksLikeOpenPathArg('open', KNOWN)).toBe(false)
    expect(looksLikeOpenPathArg('--json', KNOWN)).toBe(false)
    // Bare names that are not directories in cwd must not become open sugar.
    expect(looksLikeOpenPathArg('definitely-not-a-cwd-directory-xyz', KNOWN)).toBe(false)
  })

  it('rewrites cradle . into cradle open .', () => {
    expect(applyOpenPathSugar(['.'], KNOWN)).toEqual(['open', '.'])
    expect(applyOpenPathSugar(['--server', 'http://x', '.'], KNOWN)).toEqual(['--server', 'http://x', 'open', '.'])
    expect(applyOpenPathSugar(['issue', 'list'], KNOWN)).toEqual(['issue', 'list'])
    expect(applyOpenPathSugar(['workspace', 'list'], KNOWN)).toEqual(['workspace', 'list'])
    expect(applyOpenPathSugar(['session', 'list'], KNOWN)).toEqual(['session', 'list'])
  })

  it('splits tsx-style process argv and strips pnpm --', () => {
    const tsxArgv = [
      '/usr/local/bin/node',
      '/repo/node_modules/tsx/dist/cli.mjs',
      '/repo/packages/cli/src/index.ts',
      '--',
      'open',
      '--help',
    ]
    expect(splitCliArgv(tsxArgv)).toEqual({
      prefix: tsxArgv.slice(0, 3),
      user: ['--', 'open', '--help'],
    })
    expect(applyOpenPathSugar(tsxArgv, KNOWN)).toEqual([
      ...tsxArgv.slice(0, 3),
      'open',
      '--help',
    ])

    const pathSugarArgv = [
      '/usr/local/bin/node',
      '/repo/node_modules/tsx/dist/cli.mjs',
      '/repo/packages/cli/src/index.ts',
      '.',
    ]
    expect(applyOpenPathSugar(pathSugarArgv, KNOWN)).toEqual([
      ...pathSugarArgv.slice(0, 3),
      'open',
      '.',
    ])
  })

  it('builds a cradle:// open deep link with encoded workspace id', () => {
    expect(buildOpenWorkspaceDeepLink('ws-1')).toBe('cradle://open/workspace?id=ws-1')
    expect(buildOpenWorkspaceDeepLink('a b')).toBe('cradle://open/workspace?id=a%20b')
  })
})

describe('runOpenCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('imports the directory and opens the desktop deep link', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cradle-open-'))
    const request = vi.fn()
      .mockResolvedValueOnce({ alreadyImported: false })
      .mockResolvedValueOnce({
        id: 'workspace-1',
        name: 'proj',
        locator: { hostId: 'local', path: dir },
      })
    const openDeepLink = vi.fn().mockResolvedValue(undefined)

    const result = await runOpenCommand(
      { serverUrl: 'http://localhost:21423', request },
      dir,
      {},
      { openDeepLink },
    )

    expect(request).toHaveBeenNthCalledWith(1, {
      body: { path: dir },
      method: 'post',
      path: {},
      query: {},
      template: '/workspaces/inspect-directory',
    })
    expect(request).toHaveBeenNthCalledWith(2, {
      body: { path: dir },
      method: 'post',
      path: {},
      query: {},
      template: '/workspaces/from-directory',
    })
    expect(openDeepLink).toHaveBeenCalledWith('cradle://open/workspace?id=workspace-1')
    expect(result).toMatchObject({
      id: 'workspace-1',
      opened: true,
      created: true,
    })

    rmSync(dir, { recursive: true, force: true })
  })

  it('skips desktop open with --import-only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cradle-open-import-only-'))
    const request = vi.fn()
      .mockResolvedValueOnce({ alreadyImported: true })
      .mockResolvedValueOnce({
        id: 'workspace-2',
        name: 'proj',
        locator: { hostId: 'local', path: dir },
      })
    const openDeepLink = vi.fn()

    const result = await runOpenCommand(
      { serverUrl: 'http://localhost:21423', request },
      dir,
      { importOnly: true },
      { openDeepLink },
    )

    expect(openDeepLink).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      id: 'workspace-2',
      opened: false,
      created: false,
    })

    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a non-directory path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cradle-open-file-'))
    const filePath = join(dir, 'file.txt')
    writeFileSync(filePath, 'x')
    const request = vi.fn()

    await expect(runOpenCommand(
      { serverUrl: 'http://localhost:21423', request },
      filePath,
      {},
    )).rejects.toThrow('Path is not a directory')
    expect(request).not.toHaveBeenCalled()

    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a missing path without contacting the server', async () => {
    const request = vi.fn()
    await expect(runOpenCommand(
      { serverUrl: 'http://localhost:21423', request },
      join(tmpdir(), 'cradle-open-missing-path-definitely-absent'),
      {},
    )).rejects.toThrow('Path does not exist')
    expect(request).not.toHaveBeenCalled()
  })

  it('falls back to resolve when import returns locator-already-exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cradle-open-409-'))
    const request = vi.fn()
      .mockResolvedValueOnce({ alreadyImported: true })
      .mockRejectedValueOnce(new Error('Workspace locator already exists'))
      .mockResolvedValueOnce({
        id: 'workspace-existing',
        name: 'proj',
        locator: { hostId: 'local', path: dir },
      })
    const openDeepLink = vi.fn().mockResolvedValue(undefined)

    const result = await runOpenCommand(
      { serverUrl: 'http://localhost:21423', request },
      dir,
      {},
      { openDeepLink },
    )

    expect(request).toHaveBeenNthCalledWith(3, {
      method: 'get',
      path: {},
      query: { hostId: 'local', path: dir },
      template: '/workspaces/resolve',
    })
    expect(result).toMatchObject({
      id: 'workspace-existing',
      opened: true,
      created: false,
    })

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('registerOpenCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('wires open into commander', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cradle-open-cmd-'))
    const request = vi.fn()
      .mockResolvedValueOnce({ alreadyImported: true })
      .mockResolvedValueOnce({
        id: 'workspace-3',
        name: 'proj',
        locator: { hostId: 'local', path: dir },
      })
    const program = createProgram({ serverUrl: 'http://localhost:21423', request })
    registerOpenCommand(program)
    vi.spyOn(console, 'log').mockImplementation(() => {})

    // import-only so we do not shell out to `open`
    await program.parseAsync(['open', dir, '--import-only'], { from: 'user' })

    expect(request).toHaveBeenCalled()
    rmSync(dir, { recursive: true, force: true })
  })
})
