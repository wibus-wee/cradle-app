import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { app } from 'electron'

import type { DesktopCliCommandPlatform, DesktopCliStatus } from './desktop-cli-manager'
import { readUnsupportedDesktopCliStatus } from './desktop-cli-manager'

const runFile = promisify(execFile)
const USER_PATH_REGISTRY_KEY = 'HKCU\\Environment'
const USER_PATH_VALUE_NAME = 'Path'

function readShimDirectory(): string {
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  return join(localAppData, 'Cradle', 'bin')
}

function readCommandPath(): string {
  return join(readShimDirectory(), 'cradle.cmd')
}

export function buildShimContent(sourcePath: string): string {
  return ['@echo off', `"${sourcePath}" %*`].join('\r\n')
}

function readPackagedCliSourcePath(): string {
  return join(process.resourcesPath, 'bin', 'cradle.cmd')
}

function readCliSourcePath(): string | null {
  if (process.platform !== 'win32') {
    return null
  }
  if (!app.isPackaged) {
    return null
  }
  return readPackagedCliSourcePath()
}

function normalizePathEntry(entry: string): string {
  return entry.replaceAll('/', '\\').replace(/\\+$/g, '').trim().toLowerCase()
}

export function splitUserPathEntries(value: string | null): Array<string> {
  if (!value) {
    return []
  }
  return value.split(';').map(part => part.trim()).filter(Boolean)
}

export function userPathHasEntry(value: string | null, entry: string): boolean {
  const normalized = normalizePathEntry(entry)
  return splitUserPathEntries(value).some(part => normalizePathEntry(part) === normalized)
}

export function appendUserPathEntry(value: string | null, entry: string): string {
  const entries = splitUserPathEntries(value)
  if (userPathHasEntry(value, entry)) {
    return entries.join(';')
  }
  return [...entries, entry].join(';')
}

export function removeUserPathEntry(value: string | null, entry: string): string {
  const normalized = normalizePathEntry(entry)
  return splitUserPathEntries(value)
    .filter(part => normalizePathEntry(part) !== normalized)
    .join(';')
}

async function readUserPathValue(): Promise<string | null> {
  try {
    const { stdout } = await runFile('reg', [
      'query',
      USER_PATH_REGISTRY_KEY,
      '/v',
      USER_PATH_VALUE_NAME,
    ])
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^\s*Path\s+REG(?:_EXPAND)?_SZ\s+(.*)$/i.exec(line)
      if (match) {
        return match[1]!.trim()
      }
    }
    return null
  }
  catch {
    return null
  }
}

async function writeUserPathValue(value: string): Promise<void> {
  await runFile('reg', [
    'add',
    USER_PATH_REGISTRY_KEY,
    '/v',
    USER_PATH_VALUE_NAME,
    '/t',
    'REG_EXPAND_SZ',
    '/d',
    value,
    '/f',
  ])
}

async function broadcastEnvironmentChange(): Promise<void> {
  const script = [
    '$sig = \'[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);\'',
    'Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition $sig',
    '$result = [UIntPtr]::Zero',
    '[void][Win32.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$result)',
  ].join('; ')
  await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
}

async function writeShim(sourcePath: string): Promise<void> {
  const shimDirectory = readShimDirectory()
  await mkdir(shimDirectory, { recursive: true })
  await writeFile(readCommandPath(), `${buildShimContent(sourcePath)}\r\n`)
}

async function removeShim(): Promise<void> {
  try {
    await unlink(readCommandPath())
  }
  catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
}

async function readCommandMatchesSource(sourcePath: string): Promise<boolean | null> {
  let content: string
  try {
    content = await readFile(readCommandPath(), 'utf8')
  }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
  return content.trim() === buildShimContent(sourcePath).trim()
}

async function configureUserPath(install: boolean): Promise<boolean> {
  const currentValue = await readUserPathValue()
  const shimDirectory = readShimDirectory()
  const hasEntry = userPathHasEntry(currentValue, shimDirectory)

  if (install && hasEntry) {
    return true
  }
  if (!install && !hasEntry) {
    return false
  }

  const nextValue = install
    ? appendUserPathEntry(currentValue, shimDirectory)
    : removeUserPathEntry(currentValue, shimDirectory)

  if (nextValue.length > 0) {
    await writeUserPathValue(nextValue)
  }
  else {
    await runFile('reg', ['delete', USER_PATH_REGISTRY_KEY, '/v', USER_PATH_VALUE_NAME, '/f']).catch(() => {})
  }

  await broadcastEnvironmentChange().catch(() => {})
  return install
}

export const windowsDesktopCliCommand: DesktopCliCommandPlatform = {
  commandPath: readCommandPath(),
  async readStatus(): Promise<DesktopCliStatus> {
    const sourcePath = readCliSourcePath()
    if (!sourcePath) {
      return readUnsupportedDesktopCliStatus(
        this.commandPath,
        'CLI PATH installation is available in packaged Windows builds.',
      )
    }

    let sourceError: string | null = null
    try {
      await access(sourcePath, constants.X_OK)
    }
    catch (error) {
      sourceError = error instanceof Error ? error.message : String(error)
    }

    const commandMatches = await readCommandMatchesSource(sourcePath).catch(() => null)
    const pathConfigured = userPathHasEntry(await readUserPathValue(), readShimDirectory())

    const linked = commandMatches === true
    return {
      supported: true,
      installed: linked && pathConfigured,
      linked,
      requiresRepair: Boolean(
        sourceError || commandMatches === false || (linked && !pathConfigured),
      ),
      commandPath: this.commandPath,
      sourcePath,
      errorMessage: sourceError,
    }
  },
  async install(): Promise<DesktopCliStatus> {
    const status = await this.readStatus()
    if (!status.supported || !status.sourcePath) {
      return status
    }

    try {
      await writeShim(status.sourcePath)
      await configureUserPath(true)
    }
    catch (error) {
      return {
        ...await this.readStatus(),
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
    return this.readStatus()
  },
  async remove(): Promise<DesktopCliStatus> {
    const status = await this.readStatus()
    if (!status.supported) {
      return status
    }

    try {
      await removeShim()
      await configureUserPath(false)
    }
    catch (error) {
      return {
        ...await this.readStatus(),
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
    return this.readStatus()
  },
}
