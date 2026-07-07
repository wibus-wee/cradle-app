import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopUpdateDownload } from './update-types'

const electronMocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/unused'),
  },
}))

const childProcessMocks = vi.hoisted(() => {
  const execFile = vi.fn((
    _file: string,
    _args: string[],
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    callback(null, '1.2.3\n', '')
  })
  const promisifiedExecFile = vi.fn(async (_file: string, _args: string[]) => ({
    stdout: '1.2.3\n',
    stderr: '',
  }))
  Object.defineProperty(execFile, Symbol.for('nodejs.util.promisify.custom'), {
    configurable: true,
    value: promisifiedExecFile,
  })

  return {
    execFile,
    promisifiedExecFile,
    spawn: vi.fn(() => ({
      unref: vi.fn(),
    })),
  }
})

vi.mock('electron', () => electronMocks)
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    execFile: childProcessMocks.execFile,
    spawn: childProcessMocks.spawn,
  }
})

const tempRoots: string[] = []

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  })
}

function setExecPath(execPath: string): void {
  Object.defineProperty(process, 'execPath', {
    configurable: true,
    value: execPath,
  })
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cradle-update-installer-'))
  tempRoots.push(root)
  return root
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  }
  catch {
    return false
  }
}

function createDownload(archivePath: string): DesktopUpdateDownload {
  return {
    archivePath,
    artifact: {
      url: 'https://updates.example.com/cradle/macos/Cradle-1.2.3-universal.zip',
      size: null,
      sha256: null,
      platform: 'darwin',
      arch: 'universal',
    },
  }
}

describe('desktopUpdateInstaller', () => {
  const originalPlatform = process.platform
  const originalExecPath = process.execPath

  beforeEach(() => {
    setPlatform('darwin')
    childProcessMocks.execFile.mockClear()
    childProcessMocks.promisifiedExecFile.mockClear()
    childProcessMocks.promisifiedExecFile.mockImplementation(async (file: string, args: string[]) => {
      if (file === '/usr/bin/ditto') {
        const targetDirectory = args.at(-1)!
        const appPath = join(targetDirectory, 'Cradle.app')
        await mkdir(join(appPath, 'Contents'), { recursive: true })
        await writeFile(join(appPath, 'Contents', 'Info.plist'), '')
        await writeFile(join(appPath, 'Contents', 'update-marker.txt'), 'new')
        return { stdout: '', stderr: '' }
      }

      return {
        stdout: '1.2.3\n',
        stderr: '',
      }
    })
    childProcessMocks.spawn.mockClear()
  })

  afterEach(async () => {
    setPlatform(originalPlatform)
    setExecPath(originalExecPath)
    await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  it('prepares a staged app and detached installer script', async () => {
    const root = await createTempRoot()
    const currentAppPath = join(root, 'Applications', 'Cradle.app')
    const currentExecutablePath = join(currentAppPath, 'Contents', 'MacOS', 'Cradle')
    const archivePath = join(root, 'Cradle-1.2.3-universal.zip')
    const updatesDir = join(root, 'updates')
    await mkdir(join(currentAppPath, 'Contents', 'MacOS'), { recursive: true })
    await writeFile(currentExecutablePath, '')
    await writeFile(archivePath, 'zip-payload')
    setExecPath(currentExecutablePath)

    const { DesktopUpdateInstaller } = await import('./update-installer')
    const installer = new DesktopUpdateInstaller({ updatesDir })

    const plan = await installer.prepare(createDownload(archivePath), '1.2.3')
    const script = await readFile(plan.scriptPath, 'utf8')

    expect(childProcessMocks.promisifiedExecFile).toHaveBeenCalledWith('/usr/bin/ditto', [
      '-x',
      '-k',
      archivePath,
      plan.stagingRoot,
    ])
    expect(childProcessMocks.promisifiedExecFile).toHaveBeenCalledWith('/usr/bin/plutil', [
      '-extract',
      'CFBundleShortVersionString',
      'raw',
      '-o',
      '-',
      join(plan.stagedAppPath, 'Contents', 'Info.plist'),
    ])
    expect(plan).toMatchObject({
      version: '1.2.3',
      archivePath,
      targetAppPath: currentAppPath,
      scriptPath: join(updatesDir, 'apply-1.2.3.sh'),
      resultPath: join(updatesDir, 'last-update-result.json'),
      usesAdministratorPrivileges: false,
    })
    expect(plan.stagingRoot.startsWith(join(updatesDir, 'staging', '1.2.3-'))).toBe(true)
    expect(plan.stagedAppPath).toBe(join(plan.stagingRoot, 'Cradle.app'))
    expect(script).toContain(`TARGET_APP='${currentAppPath}'`)
    expect(script).toContain('wait_for_parent')
    expect(script).toContain('/usr/bin/open -n "$TARGET_APP"')
  })

  it('extracts into a fresh staging directory when the versioned staging path has leftover contents', async () => {
    const root = await createTempRoot()
    const currentAppPath = join(root, 'Applications', 'Cradle.app')
    const currentExecutablePath = join(currentAppPath, 'Contents', 'MacOS', 'Cradle')
    const archivePath = join(root, 'Cradle-1.2.3-universal.zip')
    const updatesDir = join(root, 'updates')
    const staleStagingRoot = join(updatesDir, 'staging', '1.2.3')
    const staleResourcePath = join(updatesDir, 'staging', '1.2.3', 'Cradle.app', 'Contents', 'Resources', 'stale.txt')
    await mkdir(join(currentAppPath, 'Contents', 'MacOS'), { recursive: true })
    await mkdir(join(staleResourcePath, '..'), { recursive: true })
    await writeFile(currentExecutablePath, '')
    await writeFile(archivePath, 'zip-payload')
    await writeFile(staleResourcePath, 'stale')
    setExecPath(currentExecutablePath)

    const { DesktopUpdateInstaller } = await import('./update-installer')
    const installer = new DesktopUpdateInstaller({ updatesDir })

    const plan = await installer.prepare(createDownload(archivePath), '1.2.3')

    expect(plan.stagingRoot).not.toBe(staleStagingRoot)
    expect(plan.stagingRoot.startsWith(join(updatesDir, 'staging', '1.2.3-'))).toBe(true)
    await expect(pathExists(staleResourcePath)).resolves.toBe(true)
    await expect(readFile(join(plan.stagedAppPath, 'Contents', 'update-marker.txt'), 'utf8')).resolves.toBe('new')
  })

  it('runs the installer script replacement path against a temporary app bundle', async () => {
    const root = await createTempRoot()
    const currentAppPath = join(root, 'Applications', 'Cradle.app')
    const currentExecutablePath = join(currentAppPath, 'Contents', 'MacOS', 'Cradle')
    const archivePath = join(root, 'Cradle-1.2.3-universal.zip')
    const updatesDir = join(root, 'updates')
    await mkdir(join(currentAppPath, 'Contents', 'MacOS'), { recursive: true })
    await writeFile(currentExecutablePath, '')
    await writeFile(join(currentAppPath, 'Contents', 'update-marker.txt'), 'old')
    await writeFile(archivePath, 'zip-payload')
    setExecPath(currentExecutablePath)

    const { execFile: realExecFile } = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    const { promisify } = await vi.importActual<typeof import('node:util')>('node:util')
    const runFile = promisify(realExecFile)
    const { DesktopUpdateInstaller } = await import('./update-installer')
    const installer = new DesktopUpdateInstaller({ updatesDir })
    const plan = await installer.prepare(createDownload(archivePath), '1.2.3')
    const script = (await readFile(plan.scriptPath, 'utf8'))
      .replace(/^PARENT_PID=\d+$/m, 'PARENT_PID=999999')
      .replace(
        '/usr/bin/open -n "$TARGET_APP" || fail_update "Updated app could not be reopened"',
        '/usr/bin/true || fail_update "Updated app could not be reopened"',
      )
    await writeFile(plan.scriptPath, script)

    await runFile('/bin/bash', [plan.scriptPath])

    await expect(readFile(join(currentAppPath, 'Contents', 'update-marker.txt'), 'utf8')).resolves.toBe('new')
    await expect(pathExists(`${currentAppPath}.previous-update`)).resolves.toBe(false)
    await expect(pathExists(plan.stagingRoot)).resolves.toBe(false)
    await expect(pathExists(archivePath)).resolves.toBe(false)
    await expect(readFile(plan.resultPath, 'utf8').then(JSON.parse)).resolves.toMatchObject({
      ok: true,
      version: '1.2.3',
      error: null,
    })
  })

  it('launches the installer script as a detached child process', async () => {
    const { DesktopUpdateInstaller } = await import('./update-installer')
    const installer = new DesktopUpdateInstaller({ updatesDir: '/unused' })

    installer.launch({
      version: '1.2.3',
      archivePath: '/tmp/Cradle-1.2.3-universal.zip',
      stagingRoot: '/tmp/staging',
      stagedAppPath: '/tmp/staging/Cradle.app',
      targetAppPath: '/Applications/Cradle.app',
      scriptPath: '/tmp/apply-1.2.3.sh',
      resultPath: '/tmp/last-update-result.json',
      usesAdministratorPrivileges: true,
    })

    expect(childProcessMocks.spawn).toHaveBeenCalledWith('/bin/bash', ['/tmp/apply-1.2.3.sh'], {
      detached: true,
      stdio: 'ignore',
    })
    expect(childProcessMocks.spawn.mock.results[0]?.value.unref).toHaveBeenCalled()
  })

  it('rejects a staged bundle with a mismatched version', async () => {
    childProcessMocks.promisifiedExecFile.mockImplementation(async (file: string, args: string[]) => {
      if (file === '/usr/bin/ditto') {
        const targetDirectory = args.at(-1)!
        const appPath = join(targetDirectory, 'Cradle.app')
        await mkdir(join(appPath, 'Contents'), { recursive: true })
        await writeFile(join(appPath, 'Contents', 'Info.plist'), '')
        return { stdout: '', stderr: '' }
      }

      return {
        stdout: '1.2.4\n',
        stderr: '',
      }
    })
    const root = await createTempRoot()
    const currentAppPath = join(root, 'Applications', 'Cradle.app')
    const currentExecutablePath = join(currentAppPath, 'Contents', 'MacOS', 'Cradle')
    const archivePath = join(root, 'Cradle-1.2.3-universal.zip')
    await mkdir(join(currentAppPath, 'Contents', 'MacOS'), { recursive: true })
    await writeFile(currentExecutablePath, '')
    await writeFile(archivePath, 'zip-payload')
    setExecPath(currentExecutablePath)

    const { DesktopUpdateInstaller } = await import('./update-installer')
    const installer = new DesktopUpdateInstaller({ updatesDir: join(root, 'updates') })

    await expect(installer.prepare(createDownload(archivePath), '1.2.3')).rejects.toThrow('does not match manifest version')
  })
})
