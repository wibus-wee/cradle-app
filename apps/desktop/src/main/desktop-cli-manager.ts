import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, readlink, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { app } from 'electron'

const runFile = promisify(execFile)
const MAC_COMMAND_PATH = '/usr/local/bin/cradle'

export interface DesktopCliStatus {
  supported: boolean
  installed: boolean
  linked: boolean
  requiresRepair: boolean
  commandPath: string
  sourcePath: string | null
  errorMessage: string | null
}

function readPackagedCliSourcePath(): string {
  return join(process.resourcesPath, 'bin', 'cradle')
}

function readUnsupportedStatus(errorMessage: string): DesktopCliStatus {
  return {
    supported: false,
    installed: false,
    linked: false,
    requiresRepair: false,
    commandPath: MAC_COMMAND_PATH,
    sourcePath: null,
    errorMessage,
  }
}

function readCliSourcePath(): string | null {
  if (process.platform !== 'darwin') {
    return null
  }
  if (!app.isPackaged) {
    return null
  }
  return readPackagedCliSourcePath()
}

async function readCommandLinkTarget(commandPath: string): Promise<string | null> {
  try {
    const stats = await lstat(commandPath)
    if (!stats.isSymbolicLink()) {
      return null
    }
    return await readlink(commandPath)
  }
  catch {
    return null
  }
}

async function readCommandPathConflict(commandPath: string): Promise<string | null> {
  try {
    const stats = await lstat(commandPath)
    return stats.isSymbolicLink() ? null : `${commandPath} already exists and is not a symlink.`
  }
  catch {
    return null
  }
}

export async function readDesktopCliStatus(): Promise<DesktopCliStatus> {
  const sourcePath = readCliSourcePath()
  if (!sourcePath) {
    return readUnsupportedStatus(
      process.platform === 'darwin'
        ? 'CLI PATH installation is available in packaged macOS builds.'
        : 'CLI PATH installation is currently available on macOS.',
    )
  }

  let sourceError: string | null = null
  try {
    await access(sourcePath, constants.X_OK)
  }
  catch (error) {
    sourceError = error instanceof Error ? error.message : String(error)
  }

  const linkTarget = await readCommandLinkTarget(MAC_COMMAND_PATH)
  const commandConflict = await readCommandPathConflict(MAC_COMMAND_PATH)
  const linked = linkTarget === sourcePath
  return {
    supported: true,
    installed: linked,
    linked,
    requiresRepair: Boolean(sourceError || commandConflict || (linkTarget && linkTarget !== sourcePath)),
    commandPath: MAC_COMMAND_PATH,
    sourcePath,
    errorMessage: sourceError ?? commandConflict,
  }
}

async function runMacPrivilegedScript(script: string): Promise<void> {
  await runFile('/usr/bin/osascript', [
    '-e',
    `do shell script ${JSON.stringify(script)} with administrator privileges`,
  ])
}

async function removeExistingCommandLink(commandPath: string): Promise<void> {
  try {
    const stats = await lstat(commandPath)
    if (!stats.isSymbolicLink()) {
      throw new Error(`${commandPath} already exists and is not a symlink.`)
    }
    await unlink(commandPath)
  }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }
}

async function removeExistingCommandLinkWithPrivilege(commandPath: string): Promise<void> {
  const quotedCommandPath = quoteForMacScript(commandPath)
  await runMacPrivilegedScript(
    `if [ ! -e ${quotedCommandPath} ] || [ -L ${quotedCommandPath} ]; then rm -f ${quotedCommandPath}; else exit 73; fi`,
  )
}

async function createCommandLink(sourcePath: string): Promise<void> {
  try {
    await removeExistingCommandLink(MAC_COMMAND_PATH)
  }
  catch (error) {
    if (error instanceof Error && error.message.includes('is not a symlink')) {
      throw error
    }
    await removeExistingCommandLinkWithPrivilege(MAC_COMMAND_PATH)
  }

  try {
    await symlink(sourcePath, MAC_COMMAND_PATH)
  }
  catch {
    const quotedCommandPath = quoteForMacScript(MAC_COMMAND_PATH)
    const script = [
      `if [ ! -e ${quotedCommandPath} ] || [ -L ${quotedCommandPath} ]; then rm -f ${quotedCommandPath}; else exit 73; fi`,
      `ln -s ${quoteForMacScript(sourcePath)} ${quoteForMacScript(MAC_COMMAND_PATH)}`,
    ].join(' && ')
    await runMacPrivilegedScript(script)
  }
}

function quoteForMacScript(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

export async function installDesktopCliCommand(): Promise<DesktopCliStatus> {
  const status = await readDesktopCliStatus()
  if (!status.supported || !status.sourcePath) {
    return status
  }

  try {
    await createCommandLink(status.sourcePath)
  }
  catch (error) {
    return {
      ...await readDesktopCliStatus(),
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
  return readDesktopCliStatus()
}

export async function removeDesktopCliCommand(): Promise<DesktopCliStatus> {
  const status = await readDesktopCliStatus()
  if (!status.supported || !status.sourcePath) {
    return status
  }

  const linkTarget = await readCommandLinkTarget(MAC_COMMAND_PATH)
  if (linkTarget !== status.sourcePath) {
    return status
  }

  try {
    await unlink(MAC_COMMAND_PATH)
  }
  catch (error) {
    try {
      await runMacPrivilegedScript(`rm -f ${quoteForMacScript(MAC_COMMAND_PATH)}`)
    }
    catch {
      return {
        ...await readDesktopCliStatus(),
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return readDesktopCliStatus()
}
